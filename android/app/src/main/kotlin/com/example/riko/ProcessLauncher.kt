package com.example.riko

class ProcessLauncher(
    private val processManager: ProcessManager,
    private val environmentBuilder: EnvironmentBuilder,
    private val lock: Any
) {
    data class LaunchResult(
        val process: Process,
        val pid: Long,
        val startTime: Long
    )

    fun launch(
        command: String,
        stopping: () -> Boolean
    ): LaunchResult? {
        val env = environmentBuilder.build()

        synchronized(lock) {
            if (stopping()) return null

            val startTime = System.currentTimeMillis()
            val process = processManager.startProotProcess(command, env)
            val pid = extractPid(process)

            return LaunchResult(process, pid, startTime)
        }
    }

    private fun extractPid(process: Process): Long {
        return try {
            val pidField = Process::class.java.getDeclaredField("pid")
            pidField.isAccessible = true
            pidField.getLong(process)
        } catch (_: Exception) {
            0
        }
    }
}
