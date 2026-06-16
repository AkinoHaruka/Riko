package com.example.riko

import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader

/**
 * Manages proot process execution. Two command modes:
 *   - Install mode: for apt-get, npm install, chmod (matches proot-distro run_proot_cmd)
 *   - Gateway mode: for long-lived Node.js backend (matches proot-distro command_login)
 */
class ProcessManager(
    private val filesDir: String,
    private val nativeLibDir: String
) {
    private val rootfsDir get() = "$filesDir/rootfs/ubuntu"
    private val tmpDir get() = "$filesDir/tmp"
    private val homeDir get() = "$filesDir/home"
    private val configDir get() = "$filesDir/config"
    private val libDir get() = "$filesDir/lib"

    private val storagePermissionManager = StoragePermissionManager(rootfsDir)

    companion object {
        const val FAKE_KERNEL_RELEASE = "6.17.0-PRoot-Distro"
        const val FAKE_KERNEL_VERSION =
            "#1 SMP PREEMPT_DYNAMIC Fri, 10 Oct 2025 00:00:00 +0000"
    }

    fun getProotPath(): String = "$nativeLibDir/libproot.so"

    // ---- Host-side environment for proot binary ----
    private fun prootEnv(): Map<String, String> = mapOf(
        "PROOT_TMP_DIR" to tmpDir,
        "PROOT_LOADER" to "$nativeLibDir/libprootloader.so",
        "PROOT_LOADER_32" to "$nativeLibDir/libprootloader32.so",
        "LD_LIBRARY_PATH" to "$libDir:$nativeLibDir",
    )

    // ---- Common proot flags shared by both modes ----
    private fun ensureResolvConf() {
        val content = "nameserver 8.8.8.8\nnameserver 8.8.4.4\n"
        try {
            val resolvFile = File(configDir, "resolv.conf")
            if (!resolvFile.exists() || resolvFile.length() == 0L) {
                resolvFile.parentFile?.mkdirs()
                resolvFile.writeText(content)
            }
        } catch (_: Exception) {}
        try {
            val rootfsResolv = File(rootfsDir, "etc/resolv.conf")
            if (!rootfsResolv.exists() || rootfsResolv.length() == 0L) {
                rootfsResolv.parentFile?.mkdirs()
                rootfsResolv.writeText(content)
            }
        } catch (_: Exception) {}
    }

    private fun createProotConfig(): ProotConfig {
        File("$filesDir/data").mkdirs()
        ensureResolvConf()

        val hasStorageAccess = storagePermissionManager.hasStorageAccess()
        if (hasStorageAccess) {
            storagePermissionManager.setupStorageLinks()
        }

        return ProotConfig.createDefault(
            filesDir = filesDir,
            configDir = configDir,
            homeDir = homeDir,
            enableStorage = hasStorageAccess,
        )
    }

    private fun commonProotFlags(): List<String> {
        val config = createProotConfig()
        return listOf(getProotPath()) + config.toCommandLineArgs()
    }

    // ---- INSTALL MODE ----
    fun buildInstallCommand(command: String): List<String> {
        val flags = commonProotFlags().toMutableList()
        flags.add(1, "--root-id")
        flags.add(2, "--kernel-release=$FAKE_KERNEL_RELEASE")

        flags.addAll(listOf(
            "/usr/bin/env", "-i",
            "HOME=/root",
            "LANG=C.UTF-8",
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "TERM=xterm-256color",
            "TMPDIR=/tmp",
            "DEBIAN_FRONTEND=noninteractive",
            "npm_config_cache=/tmp/npm-cache",
            "/bin/bash", "-c",
            command,
        ))
        return flags
    }

    // ---- GATEWAY MODE ----
    fun buildGatewayCommand(command: String, extraEnv: Map<String, String> = emptyMap()): List<String> {
        val flags = commonProotFlags().toMutableList()
        val arch = ArchUtils.getArch()
        val machine = when (arch) {
            "arm" -> "armv7l"
            else -> arch
        }

        flags.add(1, "--change-id=0:0")
        flags.add(2, "--sysvipc")
        val kernelRelease = "\\Linux\\localhost\\$FAKE_KERNEL_RELEASE" +
            "\\$FAKE_KERNEL_VERSION\\$machine\\localdomain\\-1\\"
        flags.add(3, "--kernel-release=$kernelRelease")

        val nodeOptions = "--require /root/.openclaw/bionic-bypass.js"

        val envArgs = mutableListOf(
            "/usr/bin/env", "-i",
            "HOME=/root",
            "USER=root",
            "LANG=C.UTF-8",
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "TERM=xterm-256color",
            "TMPDIR=/tmp",
            "NODE_OPTIONS=$nodeOptions",
            "CHOKIDAR_USEPOLLING=true",
            "NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt",
            "UV_USE_IO_URING=0",
        )
        for ((key, value) in extraEnv) {
            envArgs.add("$key=$value")
        }
        envArgs.addAll(listOf("/bin/bash", "-c", command))
        flags.addAll(envArgs)
        return flags
    }

    fun buildProotCommand(command: String): List<String> = buildInstallCommand(command)

    // ---- Execute command in proot (install mode), return output ----
    fun runInProotSync(command: String, timeoutSeconds: Long = 900): String {
        val cmd = buildInstallCommand(command)
        val env = prootEnv()

        val pb = ProcessBuilder(cmd)
        pb.environment().clear()
        pb.environment().putAll(env)
        pb.redirectErrorStream(true)

        val process = pb.start()
        val output = StringBuilder()
        val errorLines = StringBuilder()
        val reader = BufferedReader(InputStreamReader(process.inputStream))

        var line: String?
        while (reader.readLine().also { line = it } != null) {
            val l = line ?: continue
            if (l.contains("proot warning") || l.contains("can't sanitize")) continue
            output.appendLine(l)
            if (!l.startsWith("Get:") && !l.startsWith("Fetched ") &&
                !l.startsWith("Hit:") && !l.startsWith("Ign:") &&
                !l.contains(" kB]") && !l.contains(" MB]") &&
                !l.startsWith("Reading package") && !l.startsWith("Building dependency") &&
                !l.startsWith("Reading state") && !l.startsWith("The following") &&
                !l.startsWith("Need to get") && !l.startsWith("After this") &&
                l.trim().isNotEmpty()) {
                errorLines.appendLine(l)
            }
        }

        val exited = process.waitFor(timeoutSeconds, java.util.concurrent.TimeUnit.SECONDS)
        if (!exited) {
            process.destroyForcibly()
            throw RuntimeException("Command timed out after ${timeoutSeconds}s")
        }

        val exitCode = process.exitValue()
        if (exitCode != 0) {
            val errorOutput = errorLines.toString().takeLast(3000).ifEmpty {
                output.toString().takeLast(3000)
            }
            throw RuntimeException("Command failed (exit code $exitCode): $errorOutput")
        }

        return output.toString()
    }

    // ---- Start long-lived gateway process ----
    fun startProotProcess(command: String, extraEnv: Map<String, String> = emptyMap()): Process {
        val cmd = buildGatewayCommand(command, extraEnv)
        val env = prootEnv()

        val pb = ProcessBuilder(cmd)
        pb.environment().clear()
        pb.environment().putAll(env)
        pb.redirectErrorStream(false)

        return pb.start()
    }
}
