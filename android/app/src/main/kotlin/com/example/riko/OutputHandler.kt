package com.example.riko

import java.io.BufferedReader
import java.io.InputStreamReader

class OutputHandler(
    private val onLog: (String) -> Unit,
    private val currentRestartCount: Int
) {
    fun handleStdout(process: Process) {
        val reader = BufferedReader(InputStreamReader(process.inputStream))
        Thread {
            try {
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    line?.let { onLog(it) }
                }
            } catch (_: Exception) {}
        }.start()
    }

    fun handleStderr(process: Process) {
        val reader = BufferedReader(InputStreamReader(process.errorStream))
        Thread {
            try {
                var line: String?
                while (reader.readLine().also { line = it } != null) {
                    val l = line ?: continue
                    if (currentRestartCount == 0 ||
                        (!l.contains("proot warning") && !l.contains("can't sanitize"))) {
                        onLog("[ERR] $l")
                    }
                }
            } catch (_: Exception) {}
        }.start()
    }
}
