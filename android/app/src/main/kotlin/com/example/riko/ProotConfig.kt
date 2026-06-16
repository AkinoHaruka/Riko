package com.example.riko

import java.io.File

/**
 * Proot 配置类，集中管理所有 proot 相关的配置参数
 */
data class ProotConfig(
    val rootfsDir: String,
    val workingDir: String = "/root",
    val link2symlink: Boolean = true,
    val killOnExit: Boolean = true,
    val bindMounts: List<BindMount> = emptyList(),
    val enableStorageAccess: Boolean = false
) {
    data class BindMount(
        val source: String,
        val target: String
    )

    companion object {
        fun createDefault(
            filesDir: String,
            configDir: String,
            homeDir: String,
            enableStorage: Boolean = false
        ): ProotConfig {
            val rootfsDir = "$filesDir/rootfs/ubuntu"
            val procFakes = "$configDir/proc_fakes"
            val sysFakes = "$configDir/sys_fakes"

            val baseBindMounts = listOf(
                BindMount("/dev", "/dev"),
                BindMount("/dev/urandom", "/dev/random"),
                BindMount("/proc", "/proc"),
                BindMount("/proc/self/fd", "/dev/fd"),
                BindMount("/proc/self/fd/0", "/dev/stdin"),
                BindMount("/proc/self/fd/1", "/dev/stdout"),
                BindMount("/proc/self/fd/2", "/dev/stderr"),
                BindMount("/sys", "/sys"),
                BindMount("$procFakes/loadavg", "/proc/loadavg"),
                BindMount("$procFakes/stat", "/proc/stat"),
                BindMount("$procFakes/uptime", "/proc/uptime"),
                BindMount("$procFakes/version", "/proc/version"),
                BindMount("$procFakes/vmstat", "/proc/vmstat"),
                BindMount("$procFakes/cap_last_cap", "/proc/sys/kernel/cap_last_cap"),
                BindMount("$procFakes/max_user_watches", "/proc/sys/fs/inotify/max_user_watches"),
                BindMount("$procFakes/fips_enabled", "/proc/sys/crypto/fips_enabled"),
                BindMount("$rootfsDir/tmp", "/dev/shm"),
                BindMount("$sysFakes/empty", "/sys/fs/selinux"),
                BindMount("$configDir/resolv.conf", "/etc/resolv.conf"),
                BindMount(homeDir, "/root/home"),
                BindMount("$filesDir/data", "/root/data"),
            )

            val storageBindMounts = if (enableStorage) {
                listOf(
                    BindMount("/storage", "/storage"),
                    BindMount("/storage/emulated/0", "/sdcard"),
                )
            } else {
                emptyList()
            }

            return ProotConfig(
                rootfsDir = rootfsDir,
                bindMounts = baseBindMounts + storageBindMounts,
                enableStorageAccess = enableStorage,
            )
        }
    }

    fun toCommandLineArgs(): List<String> {
        val args = mutableListOf<String>()

        if (link2symlink) {
            args.addAll(listOf("--link2symlink", "-L"))
        }
        if (killOnExit) {
            args.add("--kill-on-exit")
        }

        args.add("--rootfs=$rootfsDir")
        args.add("--cwd=$workingDir")

        bindMounts.forEach { mount ->
            args.add("--bind=${mount.source}:${mount.target}")
        }

        return args
    }
}
