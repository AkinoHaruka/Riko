package com.example.riko

import android.system.Os
import java.io.File

/**
 * Handles creation of deferred symbolic links during rootfs extraction.
 * Resolves conflicts with pre-existing files/directories at symlink targets.
 */
class SymlinkHandler {

    data class SymlinkResult(
        val successCount: Int,
        val errorCount: Int,
        val lastError: String
    )

    fun createDeferredSymlinks(
        symlinks: List<Pair<String, String>>,
        rootfsDir: File
    ): SymlinkResult {
        var successCount = 0
        var errorCount = 0
        var lastError = ""

        for ((target, path) in symlinks) {
            try {
                val file = File(path)
                handlePreExistingFile(file, target, rootfsDir)
                file.parentFile?.mkdirs()
                Os.symlink(target, path)
                successCount++
            } catch (e: Exception) {
                errorCount++
                lastError = "$path -> $target: ${e.message}"
            }
        }

        return SymlinkResult(successCount, errorCount, lastError)
    }

    private fun handlePreExistingFile(file: File, target: String, rootfsDir: File) {
        if (!file.exists()) return

        if (file.isDirectory) {
            val linkTarget = resolveRelativeTarget(target, file, rootfsDir)
            val realTargetDir = File(rootfsDir, linkTarget)
            if (realTargetDir.exists() && realTargetDir.isDirectory) {
                file.listFiles()?.forEach { child ->
                    val dest = File(realTargetDir, child.name)
                    if (!dest.exists()) child.renameTo(dest)
                }
            }
            deleteRecursively(file, rootfsDir.absolutePath)
        } else {
            file.delete()
        }
    }

    private fun resolveRelativeTarget(target: String, file: File, rootfsDir: File): String {
        return if (target.startsWith("/")) {
            target.removePrefix("/")
        } else {
            val parent = file.parentFile?.absolutePath ?: rootfsDir.absolutePath
            File(parent, target).relativeTo(File(rootfsDir.absolutePath)).path
        }
    }

    private fun deleteRecursively(file: File, allowedPrefix: String) {
        try {
            if (!file.canonicalPath.startsWith(allowedPrefix)) return
        } catch (_: Exception) {
            return
        }
        try {
            val path = file.toPath()
            if (java.nio.file.Files.isSymbolicLink(path)) {
                file.delete()
                return
            }
        } catch (_: Exception) {}
        if (file.isDirectory) {
            file.listFiles()?.forEach { deleteRecursively(it, allowedPrefix) }
        }
        file.delete()
    }
}
