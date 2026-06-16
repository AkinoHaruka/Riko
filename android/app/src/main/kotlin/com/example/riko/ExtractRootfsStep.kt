package com.example.riko

import java.io.File

class ExtractRootfsStep(
    private val onProgress: (String) -> Unit
) : BootstrapStep {
    override val name = "ExtractRootfs"

    override fun execute(context: BootstrapContext) {
        onProgress("正在解压系统环境...")
        val rootfsTmp = File(context.filesDir, "tmp/rootfs.tar")
        rootfsTmp.parentFile?.mkdirs()
        val rootfsAssetName = tryAssetName(
            context.assets,
            "rootfs/ubuntu-base-${context.ubuntuArch}.tar",
            "rootfs/ubuntu-base-${context.ubuntuArch}.tar.gz"
        )
        context.assets.open(rootfsAssetName).use { input ->
            java.io.FileOutputStream(rootfsTmp).use { out -> input.copyTo(out) }
        }
        context.bootstrapManager.extractRootfs(rootfsTmp.absolutePath)
    }

    private fun tryAssetName(assets: android.content.res.AssetManager, preferred: String, fallback: String): String {
        return try {
            assets.open(preferred).close()
            preferred
        } catch (_: Exception) {
            fallback
        }
    }
}
