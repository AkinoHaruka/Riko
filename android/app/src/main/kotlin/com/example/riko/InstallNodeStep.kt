package com.example.riko

import java.io.File

class InstallNodeStep(
    private val onProgress: (String) -> Unit
) : BootstrapStep {
    override val name = "InstallNode"

    override fun execute(context: BootstrapContext) {
        onProgress("正在安装 Node.js...")
        val nodeTmp = File(context.filesDir, "tmp/node.tar.xz")
        context.assets.open("rootfs/node-v22.14.0-linux-${context.nodeArch}.tar.xz").use { input ->
            java.io.FileOutputStream(nodeTmp).use { out -> input.copyTo(out) }
        }
        context.bootstrapManager.extractNodeTarball(nodeTmp.absolutePath)
    }
}
