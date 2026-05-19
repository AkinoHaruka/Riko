package com.example.riko

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.InetSocketAddress
import java.net.Socket
import java.security.SecureRandom

/**
 * Foreground Service that runs the Node.js backend inside proot.
 * Replaces the old NodeService (which used nodejs-mobile via JNI).
 */
class BackendService : Service() {
    companion object {
        const val CHANNEL_ID = "riko_backend"
        const val NOTIFICATION_ID = 1001
        private const val BACKEND_PORT = 3000

        @Volatile
        var isRunning = false
            private set

        private var instance: BackendService? = null
        private val mainHandler = Handler(Looper.getMainLooper())

        fun isProcessAlive(): Boolean {
            val inst = instance ?: return false
            if (!isRunning) return false
            val proc = inst.backendProcess
            if (proc != null) return proc.isAlive
            val thread = inst.backendThread
            if (thread != null && thread.isAlive) return true
            val elapsed = System.currentTimeMillis() - inst.startTime
            return elapsed < 120_000
        }

        fun start(context: Context) {
            val intent = Intent(context, BackendService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, BackendService::class.java))
        }
    }

    private var backendProcess: Process? = null
    private var backendPid: Long = 0
    private var wakeLock: PowerManager.WakeLock? = null
    private var restartCount = 0
    private val maxRestarts = 5
    private var startTime: Long = 0
    private var processStartTime: Long = 0
    private var backendThread: Thread? = null
    private var uptimeThread: Thread? = null
    private var watchdogThread: Thread? = null
    private val lock = Object()
    @Volatile private var stopping = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification("正在启动 AI 后端..."))
        if (isRunning) {
            updateNotificationRunning()
            return START_STICKY
        }
        stopping = false
        acquireWakeLock()
        startBackend()
        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        instance = null
        uptimeThread?.interrupt()
        uptimeThread = null
        watchdogThread?.interrupt()
        watchdogThread = null
        stopBackend()
        // Force-kill any orphaned proot/node processes
        killOrphanedProcesses()
        releaseWakeLock()
        super.onDestroy()
    }

    private fun isPortInUse(port: Int = BACKEND_PORT): Boolean {
        return try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress("127.0.0.1", port), 1000)
                true
            }
        } catch (_: Exception) {
            false
        }
    }

    private fun startBackend() {
        synchronized(lock) {
            if (stopping) return
            if (backendProcess?.isAlive == true) return
            isRunning = true
            instance = this
            startTime = System.currentTimeMillis()
        }

        backendThread = Thread {
            try {
                if (isPortInUse()) {
                    log("后端已在端口 $BACKEND_PORT 运行")
                    updateNotificationRunning()
                    startUptimeTicker()
                    startWatchdog()
                    return@Thread
                }

                log("正在准备环境...")
                val filesDir = applicationContext.filesDir.absolutePath
                val nativeLibDir = applicationContext.applicationInfo.nativeLibraryDir
                val pm = ProcessManager(filesDir, nativeLibDir)

                val bootstrapManager = BootstrapManager(applicationContext, filesDir, nativeLibDir)
                try {
                    bootstrapManager.setupDirectories()
                    log("目录就绪")
                } catch (e: Exception) {
                    log("目录创建失败: ${e.message}")
                }
                try {
                    bootstrapManager.writeResolvConf()
                } catch (e: Exception) {
                    log("resolv.conf 写入失败: ${e.message}")
                }

                if (stopping) return@Thread

                // ---- First-launch bootstrap ----
                if (!bootstrapManager.isBootstrapComplete()) {
                    log("=== 首次初始化开始 ===")
                    try {
                        val arch = ArchUtils.getArch()
                        val abiDir = ArchUtils.getAbiDir()

                        // Map arch to filename suffix
                        val nodeArch = when (arch) { "aarch64" -> "arm64" "x86_64" -> "x64" else -> arch }
                        val ubuntuArch = when (arch) { "aarch64" -> "arm64" "x86_64" -> "amd64" else -> arch }

                        // 1. Extract rootfs from assets
                        updateNotification("正在解压系统环境...")
                        val rootfsTmp = File(filesDir, "tmp/rootfs.tar")
                        rootfsTmp.parentFile?.mkdirs()
                        // Flutter/aapt may strip .gz extension — try both
                        val rootfsAssetName = tryAssetName("rootfs/ubuntu-base-${ubuntuArch}.tar", "rootfs/ubuntu-base-${ubuntuArch}.tar.gz")
                        applicationContext.assets.open(rootfsAssetName).use { input ->
                            java.io.FileOutputStream(rootfsTmp).use { out -> input.copyTo(out) }
                        }
                        bootstrapManager.extractRootfs(rootfsTmp.absolutePath)
                        log("rootfs 解压完成")

                        // 2. Extract Node.js from assets
                        updateNotification("正在安装 Node.js...")
                        val nodeTmp = File(filesDir, "tmp/node.tar.xz")
                        applicationContext.assets.open("rootfs/node-v22.14.0-linux-${nodeArch}.tar.xz").use { input ->
                            java.io.FileOutputStream(nodeTmp).use { out -> input.copyTo(out) }
                        }
                        bootstrapManager.extractNodeTarball(nodeTmp.absolutePath)
                        log("Node.js 安装完成")

                        // 3. Install bionic bypass
                        bootstrapManager.installBionicBypass()
                        log("bionic bypass 安装完成")

                        // 4. Copy backend from assets
                        updateNotification("正在部署后端...")
                        copyAssetDir("backend", File(filesDir, "tmp/backend_assets").absolutePath)
                        bootstrapManager.copyBackend(File(filesDir, "tmp/backend_assets").absolutePath)
                        log("后端部署完成")

                        // 5. Extract pre-built node_modules from APK (no npm needed)
                        updateNotification("正在部署依赖...")
                        try {
                            // Copy tar to rootfs tmp so proot can access it
                            val tarInRootfs = File("$filesDir/rootfs/ubuntu/tmp/node_modules.tar.gz")
                            tarInRootfs.parentFile?.mkdirs()
                            applicationContext.assets.open("backend/node_modules.tar.gz").use { input ->
                                java.io.FileOutputStream(tarInRootfs).use { out -> input.copyTo(out) }
                            }
                            pm.runInProotSync(
                                "cd /root/app/ts_backend && tar xzf /tmp/node_modules.tar.gz && rm /tmp/node_modules.tar.gz",
                                300
                            )
                            log("node_modules 部署完成")
                        } catch (e: Exception) {
                            log("node_modules 部署失败: ${e.message} — 继续启动")
                        }

                        updateNotification("环境初始化完成")
                        log("=== 首次初始化完成 ===")
                    } catch (e: Exception) {
                        log("首次初始化失败: ${e.message}")
                        updateNotification("初始化失败: ${e.message}")
                        isRunning = false
                        return@Thread
                    }
                }

                if (stopping) return@Thread

                // Always refresh backend dist/ and prompts from APK assets on every launch
                try {
                    copyAssetDir("backend/dist", File(filesDir, "tmp/backend_assets/dist").absolutePath)
                    val distDest = File("$filesDir/rootfs/ubuntu/root/app/ts_backend/dist")
                    if (distDest.exists()) distDest.deleteRecursively()
                    copyDirRecursive(File(filesDir, "tmp/backend_assets/dist"), distDest)
                    try {
                        copyAssetDir("backend/data", File(filesDir, "tmp/backend_assets/data").absolutePath)
                        val dataDest = File("$filesDir/rootfs/ubuntu/root/app/ts_backend/data")
                        if (dataDest.exists()) dataDest.deleteRecursively()
                        copyDirRecursive(File(filesDir, "tmp/backend_assets/data"), dataDest)
                    } catch (_: Exception) {}
                    log("后端代码已刷新")
                } catch (e: Exception) {
                    log("后端代码刷新失败: ${e.message}")
                }

                // Bootstrap is complete except node_modules — just install deps
                val backendRootfsDir = "$filesDir/rootfs/ubuntu"
                val backendDir = File("$backendRootfsDir/root/app/ts_backend")
                val distMain = File(backendDir, "dist/main.js")
                val nodeModules = File(backendDir, "node_modules")
                if (distMain.exists() && !nodeModules.exists()) {
                    log("node_modules 缺失，从 assets 重新部署...")
                    updateNotification("正在部署依赖...")
                    try {
                        val tarInRootfs = File("$filesDir/rootfs/ubuntu/tmp/node_modules.tar.gz")
                        tarInRootfs.parentFile?.mkdirs()
                        applicationContext.assets.open("backend/node_modules.tar.gz").use { input ->
                            java.io.FileOutputStream(tarInRootfs).use { out -> input.copyTo(out) }
                        }
                        pm.runInProotSync(
                            "cd /root/app/ts_backend && tar xzf /tmp/node_modules.tar.gz && rm /tmp/node_modules.tar.gz",
                            300
                        )
                        log("node_modules 重新部署完成")
                    } catch (e: Exception) {
                        log("node_modules 部署失败: ${e.message} — 继续启动")
                    }
                }

                if (isPortInUse()) {
                    log("后端已在端口 $BACKEND_PORT 运行，跳过启动")
                    updateNotificationRunning()
                    startUptimeTicker()
                    startWatchdog()
                    return@Thread
                }

                // Build environment for the backend
                val backendEnv = buildBackendEnv(filesDir)

                // 仅启动 Node.js 后端，TTS 依赖在后台异步安装
                val prootCommand = "cd /root/app/ts_backend && node dist/main.js"

                log("正在启动 proot 进程...")
                synchronized(lock) {
                    if (stopping) return@Thread
                    processStartTime = System.currentTimeMillis()
                    backendProcess = pm.startProotProcess(prootCommand, backendEnv)
                    // Get PID via reflection (Process.pid() is Java 9+)
                    try {
                        val pidField = Process::class.java.getDeclaredField("pid")
                        pidField.isAccessible = true
                        backendPid = pidField.getLong(backendProcess)
                    } catch (_: Exception) {
                        backendPid = 0
                    }
                }
                updateNotificationRunning()
                log("后端进程已启动 (PID: $backendPid)")
                startUptimeTicker()
                startWatchdog()

                // Read stdout
                val proc = backendProcess!!
                val stdoutReader = BufferedReader(InputStreamReader(proc.inputStream))
                Thread {
                    try {
                        var line: String?
                        while (stdoutReader.readLine().also { line = it } != null) {
                            val l = line ?: continue
                            log(l)
                        }
                    } catch (_: Exception) {}
                }.start()

                // Read stderr
                val stderrReader = BufferedReader(InputStreamReader(proc.errorStream))
                val currentRestartCount = restartCount
                Thread {
                    try {
                        var line: String?
                        while (stderrReader.readLine().also { line = it } != null) {
                            val l = line ?: continue
                            if (currentRestartCount == 0 ||
                                (!l.contains("proot warning") && !l.contains("can't sanitize"))) {
                                log("[ERR] $l")
                            }
                        }
                    } catch (_: Exception) {}
                }.start()

                val exitCode = proc.waitFor()
                val uptimeMs = System.currentTimeMillis() - processStartTime
                val uptimeSec = uptimeMs / 1000
                log("后端进程退出，代码 $exitCode (运行时间: ${uptimeSec}s)")

                if (stopping) return@Thread

                if (uptimeMs > 60_000) {
                    restartCount = 0
                }

                if (isRunning && restartCount < maxRestarts) {
                    restartCount++
                    val delayMs = minOf(2000L * (1 shl (restartCount - 1)), 16000L)
                    log("${delayMs / 1000}s 后自动重启 (尝试 $restartCount/$maxRestarts)...")
                    updateNotification("${delayMs / 1000}s 后重启 (尝试 $restartCount)...")
                    Thread.sleep(delayMs)
                    if (!stopping) {
                        startTime = System.currentTimeMillis()
                        startBackend()
                    }
                } else if (restartCount >= maxRestarts) {
                    log("已达到最大重启次数，后端已停止")
                    updateNotification("后端已停止 (崩溃)")
                    isRunning = false
                }
            } catch (e: Exception) {
                if (!stopping) {
                    log("后端错误: ${e.message}")
                    isRunning = false
                    updateNotification("后端错误")
                }
            }
        }.also { it.start() }
    }

    private fun stopBackend() {
        val procToStop: Process?
        synchronized(lock) {
            stopping = true
            restartCount = maxRestarts
            uptimeThread?.interrupt()
            uptimeThread = null
            watchdogThread?.interrupt()
            watchdogThread = null
            backendThread?.interrupt()
            backendThread = null
            procToStop = backendProcess
            backendProcess = null
        }
        log("用户停止后端")
        procToStop?.let { proc ->
            Thread({
                try {
                    proc.destroy() // SIGTERM
                    if (!proc.waitFor(3, java.util.concurrent.TimeUnit.SECONDS)) {
                        proc.destroyForcibly()
                    }
                } catch (_: Exception) {
                    try { proc.destroyForcibly() } catch (_: Exception) {}
                }
            }, "backend-stop").apply { isDaemon = true }.start()
        }
    }

    private fun startWatchdog() {
        watchdogThread?.interrupt()
        watchdogThread = Thread {
            try {
                Thread.sleep(45_000)
                while (!Thread.interrupted() && isRunning && !stopping) {
                    val proc = backendProcess
                    if (proc != null && !proc.isAlive) {
                        log("[WARN] Watchdog: 后端进程不存活")
                        break
                    }
                    if (proc != null && !isPortInUse()) {
                        log("[WARN] Watchdog: 端口 $BACKEND_PORT 无响应")
                    }
                    Thread.sleep(15_000)
                }
            } catch (_: InterruptedException) {}
        }.apply { isDaemon = true; start() }
    }

    private fun startUptimeTicker() {
        uptimeThread?.interrupt()
        uptimeThread = Thread {
            try {
                while (!Thread.interrupted() && isRunning) {
                    Thread.sleep(60_000)
                    if (isRunning) updateNotificationRunning()
                }
            } catch (_: InterruptedException) {}
        }.apply { isDaemon = true; start() }
    }

    private fun formatUptime(): String {
        val elapsed = System.currentTimeMillis() - startTime
        val seconds = elapsed / 1000
        val minutes = seconds / 60
        val hours = minutes / 60
        return when {
            hours > 0 -> "${hours}h ${minutes % 60}m"
            minutes > 0 -> "${minutes}m"
            else -> "${seconds}s"
        }
    }

    private fun updateNotificationRunning() {
        updateNotification("AI 后端运行中 :3000 • ${formatUptime()}")
    }

    private fun log(message: String) {
        try {
            val ts = java.time.Instant.now().toString()
            android.util.Log.i("BackendService", "$ts $message")
        } catch (_: Exception) {}
    }

    private fun acquireWakeLock() {
        releaseWakeLock()
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "Riko::BackendWakeLock"
        )
        wakeLock?.acquire(24 * 60 * 60 * 1000L)
    }

    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) it.release()
        }
        wakeLock = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "AI 后端服务",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "保持 AI 后端在后台运行"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        builder.setContentTitle("RIKO AI 后端")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)

        if (isRunning && startTime > 0) {
            builder.setWhen(startTime)
            builder.setShowWhen(true)
            builder.setUsesChronometer(true)
        }

        return builder.build()
    }

    private fun updateNotification(text: String) {
        try {
            val manager = getSystemService(NotificationManager::class.java)
            manager.notify(NOTIFICATION_ID, buildNotification(text))
        } catch (_: Exception) {}
    }

    /** Try to find an asset file; fall back to alternative name if the first doesn't exist. */
    private fun tryAssetName(preferred: String, fallback: String): String {
        return try {
            applicationContext.assets.open(preferred).close()
            preferred
        } catch (_: Exception) {
            fallback
        }
    }

    /** Generate a random hex string of the given byte length. */
    private fun generateSecret(bytes: Int): String {
        val random = SecureRandom()
        val buf = ByteArray(bytes)
        random.nextBytes(buf)
        return buf.joinToString("") { "%02x".format(it) }
    }

    /** Load or generate persistent secrets for JWT and encryption. */
    private fun loadOrGenerateSecrets(filesDir: String): Pair<String, String> {
        val dataDir = File(filesDir, "data")
        dataDir.mkdirs()
        val secretsFile = File(dataDir, ".secrets")
        if (secretsFile.exists()) {
            val lines = secretsFile.readLines()
            val jwt = lines.getOrElse(0) { generateSecret(32) }
            val enc = lines.getOrElse(1) { generateSecret(16) }
            return Pair(jwt, enc)
        } else {
            val jwt = generateSecret(32)
            val enc = generateSecret(16)
            secretsFile.writeText("$jwt\n$enc")
            return Pair(jwt, enc)
        }
    }

    /** Build environment variables for the Node.js backend. */
    private fun buildBackendEnv(filesDir: String): Map<String, String> {
        val dataDir = "$filesDir/data"
        val (jwtSecret, encKey) = loadOrGenerateSecrets(filesDir)
        return mapOf(
            "JWT_SECRET" to jwtSecret,
            "ENCRYPTION_KEY" to encKey,
            "PORT" to "3000",
            "DB_PATH" to "$dataDir/app.db",
            "MEMORY_ROOT_DIR" to "../../data/memories",
            "SYSTEM_PROMPTS_DIR" to "$dataDir/prompts",
            "NODE_ENV" to "production",
            "DB_ENGINE" to "wasm",
        )
    }

    /** Kill any surviving proot or node processes from our UID.
     *  This handles cases where force-stop or uninstall didn't clean up
     *  native child processes spawned via ProcessBuilder. */
    private fun killOrphanedProcesses() {
        // 1. Kill our tracked proot PID
        if (backendPid > 0) {
            try {
                android.os.Process.killProcess(backendPid.toInt())
                Thread.sleep(100)
            } catch (_: Exception) {}
        }

        // 2. Scan /proc for any remaining proot/node processes with our UID
        try {
            val myUid = android.os.Process.myUid()
            val procDir = File("/proc")
            procDir.listFiles()?.forEach { dir ->
                try {
                    val pid = dir.name.toIntOrNull() ?: return@forEach
                    val statusFile = File(dir, "status")
                    if (!statusFile.exists()) return@forEach
                    val uidLine = statusFile.readLines().find { it.startsWith("Uid:") }
                    val uid = uidLine?.split("\t")?.get(1)?.trim()?.toIntOrNull() ?: return@forEach
                    if (uid != myUid) return@forEach

                    val cmdline = File(dir, "cmdline").readText().replace(' ', ' ').trim()
                    if (cmdline.contains("proot") || cmdline.contains("node") || cmdline.contains("libproot")) {
                        try { Runtime.getRuntime().exec(arrayOf("kill", "-9", pid.toString())).waitFor() }
                        catch (_: Exception) {}
                    }
                } catch (_: Exception) {}
            }
        } catch (_: Exception) {}
        backendPid = 0
    }

    /** Copy a single asset file to the filesystem. */
    private fun copyAsset(assetPath: String, destPath: String) {
        val dest = File(destPath)
        dest.parentFile?.mkdirs()
        applicationContext.assets.open(assetPath).use { input ->
            java.io.FileOutputStream(dest).use { out -> input.copyTo(out) }
        }
    }

    /** Copy a directory tree recursively. */
    private fun copyDirRecursive(src: File, dest: File) {
        dest.mkdirs()
        src.listFiles()?.forEach { file ->
            val target = File(dest, file.name)
            if (file.isDirectory) {
                copyDirRecursive(file, target)
            } else {
                file.copyTo(target, overwrite = true)
                if (file.canExecute()) target.setExecutable(true, false)
            }
        }
    }

    /** Copy an asset directory recursively to the filesystem. */
    private fun copyAssetDir(assetPath: String, destPath: String) {
        val assets = applicationContext.assets
        val entries = assets.list(assetPath) ?: return
        for (entry in entries) {
            val subPath = "$assetPath/$entry"
            val subDest = "$destPath/$entry"
            if (assets.list(subPath)?.isNotEmpty() == true) {
                File(subDest).mkdirs()
                copyAssetDir(subPath, subDest)
            } else {
                File(destPath).mkdirs()
                assets.open(subPath).use { input ->
                    File(subDest).outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
            }
        }
    }
}
