package com.example.riko

interface RestartStrategy {
    fun shouldRestart(uptimeMs: Long, restartCount: Int, maxRestarts: Int): Boolean
    fun calculateDelay(restartCount: Int): Long
    fun shouldResetCount(uptimeMs: Long): Boolean
}

class ExponentialBackoffStrategy(
    private val baseDelayMs: Long = 2000L,
    private val maxDelayMs: Long = 16000L,
    private val stableUptimeThresholdMs: Long = 60_000L
) : RestartStrategy {
    override fun shouldRestart(uptimeMs: Long, restartCount: Int, maxRestarts: Int): Boolean {
        return restartCount < maxRestarts
    }

    override fun calculateDelay(restartCount: Int): Long {
        return minOf(baseDelayMs * (1 shl (restartCount - 1)), maxDelayMs)
    }

    override fun shouldResetCount(uptimeMs: Long): Boolean {
        return uptimeMs > stableUptimeThresholdMs
    }
}
