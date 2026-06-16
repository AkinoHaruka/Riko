package com.example.riko

import android.content.Context
import java.io.File

class BackendCodeRefresher(
    private val context: Context,
    private val filesDir: String,
    private val nativeLibDir: String
) {
    private val rootfsDir get() = "$filesDir/rootfs/ubuntu"
    private val backendDir get() = "$rootfsDir/root/app/ts_backend"

    fun refresh(
        onLog: (String) -> Unit,
        onProgress: (String) -> Unit
    ) {
        try {
            copyAssetDir("backend/dist", File(filesDir, "tmp/backend_assets/dist").absolutePath)
            val distDest = File("$backendDir/dist")
            if (distDest.exists()) {
                if (java.nio.file.Files.isSymbolicLink(distDest.toPath())) distDest.delete()
                else distDest.deleteRecursively()
            }
            copyDirRecursive(File(filesDir, "tmp/backend_assets/dist"), distDest)
            try {
                copyAssetDir("backend/data", File(filesDir, "tmp/backend_assets/data").absolutePath)
                val dataDest = File("$backendDir/data")
                if (dataDest.exists()) {
                    if (java.nio.file.Files.isSymbolicLink(dataDest.toPath())) dataDest.delete()
                    else dataDest.deleteRecursively()
                }
                copyDirRecursive(File(filesDir, "tmp/backend_assets/data"), dataDest)
            } catch (_: Exception) {}
            onLog("后端代码已刷新")
        } catch (e: Exception) {
            onLog("后端代码刷新失败: ${e.message}")
        }
    }

    fun repairNodeModulesIfNeeded(
        onLog: (String) -> Unit,
        onProgress: (String) -> Unit
    ) {
        val distMain = File(backendDir, "dist/main.js")
        val nodeModules = File(backendDir, "node_modules")
        if (!distMain.exists() || nodeModules.exists()) return

        onLog("node_modules 缺失，从 assets 重新部署...")
        onProgress("正在部署依赖...")
        try {
            val pm = ProcessManager(filesDir, nativeLibDir)
            val tarInRootfs = File("$rootfsDir/tmp/node_modules.tar.gz")
            tarInRootfs.parentFile?.mkdirs()
            context.assets.open("backend/node_modules.tar.gz").use { input ->
                java.io.FileOutputStream(tarInRootfs).use { out -> input.copyTo(out) }
            }
            pm.runInProotSync(
                "cd /root/app/ts_backend && tar xzf /tmp/node_modules.tar.gz && rm /tmp/node_modules.tar.gz",
                300
            )
            onLog("node_modules 重新部署完成")
        } catch (e: Exception) {
            onLog("node_modules 部署失败: ${e.message} — 继续启动")
        }
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

    private fun copyDirRecursive(src: File, dest: File) {
        dest.mkdirs()
        src.listFiles()?.forEach { file ->
            val target = File(dest, file.name)
            if (file.isDirectory) {
                copyDirRecursive(file, target)
            } else {
                file.copyTo(target, overwrite = true)
                if (file.canExecute()) target.setExecutable(true, false)
            }
        }
    }
}
