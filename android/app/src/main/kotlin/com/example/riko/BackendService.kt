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
import java.io.File
import java.lang.ref.WeakReference
import java.net.InetSocketAddress
import java.net.Socket

class BackendService : Service() {
    companion object {
        const val CHANNEL_ID = "riko_backend"
        const val NOTIFICATION_ID = 1001
        private const val BACKEND_PORT = 3000

        @Volatile
        var isRunning = false
            private set

        private var instance: WeakReference<BackendService>? = null
        private val mainHandler = Handler(Looper.getMainLooper())

        fun isProcessAlive(): Boolean {
            val inst = instance?.get() ?: return false
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
    private var startTime: Long = 0
    private var processStartTime: Long = 0
    private var backendThread: Thread? = null
    private var uptimeThread: Thread? = null
    private var watchdogThread: Thread? = null
    private val lock = Object()
    @Volatile private var stopping = false

    private val maxRestarts = 5
    private val processMonitor by lazy {
        ProcessMonitor(
            restartStrategy = ExponentialBackoffStrategy(),
            maxRestarts = maxRestarts,
            onLog = ::log,
            isRunning = { isRunning },
            isStopping = { stopping }
        )
    }

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
            instance = WeakReference(this)
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

                val filesDir = applicationContext.filesDir.absolutePath
                val nativeLibDir = applicationContext.applicationInfo.nativeLibraryDir

                if (!prepareAndBootstrap(filesDir, nativeLibDir)) {
                    return@Thread
                }

                if (stopping) return@Thread

                val codeRefresher = BackendCodeRefresher(applicationContext, filesDir, nativeLibDir)
                codeRefresher.refresh(::log, ::updateNotification)
                codeRefresher.repairNodeModulesIfNeeded(::log, ::updateNotification)

                if (isPortInUse()) {
                    log("后端已在端口 $BACKEND_PORT 运行，跳过启动")
                    updateNotificationRunning()
                    startUptimeTicker()
                    startWatchdog()
                    return@Thread
                }

                val launchResult = launchProcess(filesDir, nativeLibDir)
                if (launchResult == null) {
                    log("进程启动取消")
                    isRunning = false
                    return@Thread
                }

                synchronized(lock) {
                    backendProcess = launchResult.process
                    backendPid = launchResult.pid
                    processStartTime = launchResult.startTime
                }
                updateNotificationRunning()
                log("后端进程已启动 (PID: $backendPid)")
                startUptimeTicker()
                startWatchdog()

                processMonitor.monitorAndWait(
                    process = launchResult.process,
                    processStartTime = launchResult.startTime,
                    onRestartScheduled = { delayMs, attempt, max ->
                        log("${delayMs / 1000}s 后自动重启 (尝试 $attempt/$max)...")
                        updateNotification("${delayMs / 1000}s 后重启 (尝试 $attempt)...")
                    },
                    onRestartRequested = {
                        startTime = System.currentTimeMillis()
                        startBackend()
                    },
                    onGiveUp = {
                        log("已达到最大重启次数，后端已停止")
                        updateNotification("后端已停止 (崩溃)")
                        isRunning = false
                    }
                )
            } catch (e: Exception) {
                if (!stopping) {
                    log("后端错误: ${e.message}")
                    isRunning = false
                    updateNotification("后端错误")
                }
            }
        }.also { it.start() }
    }

    private fun prepareAndBootstrap(filesDir: String, nativeLibDir: String): Boolean {
        log("正在准备环境...")
        val orchestrator = createBootstrapOrchestrator(filesDir, nativeLibDir)

        orchestrator.prepareEnvironment(
            onLog = ::log,
            onError = { msg -> log(msg) }
        )

        if (stopping) return false

        if (!orchestrator.isBootstrapComplete()) {
            val success = orchestrator.execute(
                onProgress = ::updateNotification,
                onLog = ::log,
                onError = { error ->
                    log("首次初始化失败: $error")
                    updateNotification("初始化失败: $error")
                    isRunning = false
                }
            )
            if (!success) return false
        }

        return true
    }

    private fun createBootstrapOrchestrator(filesDir: String, nativeLibDir: String): BootstrapOrchestrator {
        val orchestrator = BootstrapOrchestrator(applicationContext, filesDir, nativeLibDir)
        orchestrator.addStep(ExtractRootfsStep(::updateNotification))
        orchestrator.addStep(InstallNodeStep(::updateNotification))
        orchestrator.addStep(InstallBionicBypassStep())
        orchestrator.addStep(DeployBackendStep(applicationContext, ::updateNotification))
        orchestrator.addStep(DeployDependenciesStep(applicationContext, ::updateNotification))
        return orchestrator
    }

    private fun launchProcess(filesDir: String, nativeLibDir: String): ProcessLauncher.LaunchResult? {
        val launcher = ProcessLauncher(
            processManager = ProcessManager(filesDir, nativeLibDir),
            environmentBuilder = EnvironmentBuilder(filesDir),
            lock = lock
        )
        val command = "cd /root/app/ts_backend && node dist/main.js"
        log("正在启动 proot 进程...")
        return launcher.launch(command) { stopping }
    }

    private fun stopBackend() {
        val procToStop: Process?
        synchronized(lock) {
            stopping = true
            processMonitor.forceStop()
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
                    proc.destroy()
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

    private fun killOrphanedProcesses() {
        if (backendPid > 0) {
            try {
                android.os.Process.killProcess(backendPid.toInt())
                Thread.sleep(100)
            } catch (_: Exception) {}
        }

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

                    val cmdline = File(dir, "cmdline").readText().replace('\u0000', ' ').trim()
                    if (cmdline.contains("proot") || cmdline.contains("node") || cmdline.contains("libproot")) {
                        try { Runtime.getRuntime().exec(arrayOf("kill", "-9", pid.toString())).waitFor() }
                        catch (_: Exception) {}
                    }
                } catch (_: Exception) {}
            }
        } catch (_: Exception) {}
        backendPid = 0
    }
}
