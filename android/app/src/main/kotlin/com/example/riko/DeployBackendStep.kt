package com.example.riko

import android.content.Context
import java.io.File

class DeployBackendStep(
    private val context: Context,
    private val onProgress: (String) -> Unit
) : BootstrapStep {
    override val name = "DeployBackend"

    override fun execute(ctx: BootstrapContext) {
        onProgress("正在部署后端...")
        copyAssetDir("backend", File(ctx.filesDir, "tmp/backend_assets").absolutePath)
        ctx.bootstrapManager.copyBackend(File(ctx.filesDir, "tmp/backend_assets").absolutePath)
    }

    private fun copyAssetDir(assetPath: String, destPath: String) {
        val assets = context.assets
        val entries = assets.list(assetPath) ?: return
        for (entry in entries) {
            val subPath = "$assetPath/$entry"
            val subDest = "$destPath/$entry"
            if (assets.list(subPath)?.isNotEmpty() == true) {
                File(subDest).mkdirs()
                copyAssetDir(subPath, subDest)
            } else {
                File(destPath).mkdirs()
                assets.open(subPath).use { input ->
                    File(subDest).outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
            }
        }
    }
}
