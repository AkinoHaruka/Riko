package com.example.riko

import android.content.Context

class BootstrapOrchestrator(
    private val context: Context,
    private val filesDir: String,
    private val nativeLibDir: String
) {
    private val steps = mutableListOf<BootstrapStep>()
    private val bootstrapManager by lazy { BootstrapManager(context, filesDir, nativeLibDir) }
    private val processManager by lazy { ProcessManager(filesDir, nativeLibDir) }

    fun addStep(step: BootstrapStep) {
        steps.add(step)
    }

    fun isBootstrapComplete(): Boolean = bootstrapManager.isBootstrapComplete()

    fun prepareEnvironment(
        onLog: (String) -> Unit,
        onError: (String) -> Unit
    ) {
        try {
            bootstrapManager.setupDirectories()
            onLog("目录就绪")
        } catch (e: Exception) {
            onError("目录创建失败: ${e.message}")
        }
        try {
            bootstrapManager.writeResolvConf()
        } catch (e: Exception) {
            onError("resolv.conf 写入失败: ${e.message}")
        }
    }

    fun execute(
        onProgress: (String) -> Unit,
        onLog: (String) -> Unit,
        onError: (String) -> Unit
    ): Boolean {
        if (isBootstrapComplete()) return true

        onLog("=== 首次初始化开始 ===")

        val arch = ArchUtils.getArch()
        val nodeArch = when (arch) { "aarch64" -> "arm64" "x86_64" -> "x64" else -> arch }
        val ubuntuArch = when (arch) { "aarch64" -> "arm64" "x86_64" -> "amd64" else -> arch }

        val ctx = BootstrapContext(
            filesDir = filesDir,
            nativeLibDir = nativeLibDir,
            assets = context.assets,
            arch = arch,
            nodeArch = nodeArch,
            ubuntuArch = ubuntuArch,
            bootstrapManager = bootstrapManager,
            processManager = processManager
        )

        for (step in steps) {
            try {
                step.execute(ctx)
                onLog("${step.name} 完成")
            } catch (e: Exception) {
                onError("${step.name} 失败: ${e.message}")
                return false
            }
        }

        onProgress("环境初始化完成")
        onLog("=== 首次初始化完成 ===")
        return true
    }
}
