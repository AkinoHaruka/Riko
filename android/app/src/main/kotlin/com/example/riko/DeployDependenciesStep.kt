package com.example.riko

import android.content.Context
import java.io.File

class DeployDependenciesStep(
    private val context: Context,
    private val onProgress: (String) -> Unit
) : BootstrapStep {
    override val name = "DeployDependencies"

    override fun execute(ctx: BootstrapContext) {
        onProgress("正在部署依赖...")
        try {
            val tarInRootfs = File("${ctx.filesDir}/rootfs/ubuntu/tmp/node_modules.tar.gz")
            tarInRootfs.parentFile?.mkdirs()
            context.assets.open("backend/node_modules.tar.gz").use { input ->
                java.io.FileOutputStream(tarInRootfs).use { out -> input.copyTo(out) }
            }
            ctx.processManager.runInProotSync(
                "cd /root/app/ts_backend && tar xzf /tmp/node_modules.tar.gz && rm /tmp/node_modules.tar.gz",
                300
            )
        } catch (e: Exception) {
            throw RuntimeException("node_modules 部署失败: ${e.message}", e)
        }
    }
}
