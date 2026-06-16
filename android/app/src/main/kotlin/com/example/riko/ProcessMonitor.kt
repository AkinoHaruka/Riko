package com.example.riko

class ProcessMonitor(
    private val restartStrategy: RestartStrategy,
    private val maxRestarts: Int,
    private val onLog: (String) -> Unit,
    private val isRunning: () -> Boolean,
    private val isStopping: () -> Boolean
) {
    @Volatile private var restartCount = 0

    fun getRestartCount(): Int = restartCount

    fun forceStop() {
        restartCount = maxRestarts
    }

    fun monitorAndWait(
        process: Process,
        processStartTime: Long,
        onRestartScheduled: (delayMs: Long, attempt: Int, maxRestarts: Int) -> Unit,
        onRestartRequested: () -> Unit,
        onGiveUp: () -> Unit
    ) {
        val outputHandler = OutputHandler(onLog, restartCount)
        outputHandler.handleStdout(process)
        outputHandler.handleStderr(process)

        val exitCode = process.waitFor()
        val uptimeMs = System.currentTimeMillis() - processStartTime
        val uptimeSec = uptimeMs / 1000
        onLog("后端进程退出，代码 $exitCode (运行时间: ${uptimeSec}s)")

        if (isStopping()) return

        if (restartStrategy.shouldResetCount(uptimeMs)) {
            restartCount = 0
        }

        if (isRunning() && restartStrategy.shouldRestart(uptimeMs, restartCount, maxRestarts)) {
            restartCount++
            val delayMs = restartStrategy.calculateDelay(restartCount)
            onRestartScheduled(delayMs, restartCount, maxRestarts)
            Thread.sleep(delayMs)
            if (!isStopping()) {
                onRestartRequested()
            }
        } else {
            onGiveUp()
        }
    }
}
