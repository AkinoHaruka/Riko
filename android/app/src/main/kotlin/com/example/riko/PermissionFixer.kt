package com.example.riko

import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import java.io.File

/**
 * Handles file permission settings during extraction and post-extraction fixes.
 */
class PermissionFixer {

    fun fixFilePermissions(file: File, entry: TarArchiveEntry) {
        file.setReadable(true, false)
        file.setWritable(true, false)

        if (shouldSetExecutable(entry.mode, entry.name)) {
            file.setExecutable(true, false)
        }
    }

    private fun shouldSetExecutable(mode: Int, path: String): Boolean {
        if (mode and 0b001_001_001 != 0) return true
        if (mode == 0) {
            val lowerPath = path.lowercase()
            return lowerPath.contains("/bin/") ||
                    lowerPath.contains("/sbin/") ||
                    lowerPath.endsWith(".sh") ||
                    lowerPath.contains("/lib/apt/methods/")
        }
        return false
    }

    fun fixBinPermissions(rootfsDir: String) {
        val recursiveExecDirs = listOf(
            "$rootfsDir/usr/bin", "$rootfsDir/usr/sbin",
            "$rootfsDir/usr/local/bin", "$rootfsDir/usr/local/sbin",
            "$rootfsDir/usr/lib/apt/methods", "$rootfsDir/usr/lib/dpkg",
            "$rootfsDir/var/lib/dpkg/info",
            "$rootfsDir/bin", "$rootfsDir/sbin",
        )
        for (dirPath in recursiveExecDirs) {
            val dir = File(dirPath)
            if (dir.exists() && dir.isDirectory) fixExecRecursive(dir)
        }
        for (dirPath in listOf("$rootfsDir/usr/lib", "$rootfsDir/lib")) {
            val dir = File(dirPath)
            if (dir.exists() && dir.isDirectory) fixSharedLibsRecursive(dir)
        }
    }

    private fun fixExecRecursive(dir: File) {
        dir.listFiles()?.forEach { file ->
            if (file.isDirectory) fixExecRecursive(file)
            else if (file.isFile) {
                file.setReadable(true, false)
                file.setExecutable(true, false)
            }
        }
    }

    private fun fixSharedLibsRecursive(dir: File) {
        dir.listFiles()?.forEach { file ->
            if (file.isDirectory) fixSharedLibsRecursive(file)
            else if (file.name.endsWith(".so") || file.name.contains(".so.")) {
                file.setReadable(true, false)
                file.setExecutable(true, false)
            }
        }
    }
}
