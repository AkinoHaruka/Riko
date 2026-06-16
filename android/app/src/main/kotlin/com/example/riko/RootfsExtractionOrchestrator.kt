package com.example.riko

import java.io.File
import java.io.FileOutputStream
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream

/**
 * Orchestrates the rootfs extraction process by coordinating
 * [TarExtractor], [SymlinkHandler], [PermissionFixer], and [ExtractionValidator].
 */
class RootfsExtractionOrchestrator(
    private val tarExtractor: TarExtractor,
    private val symlinkHandler: SymlinkHandler,
    private val permissionFixer: PermissionFixer,
    private val validator: ExtractionValidator,
    private val filesDir: String
) {

    fun extractRootfs(tarPath: String, rootfsDir: String) {
        val rootfs = File(rootfsDir)
        prepareDirectory(rootfs)

        val deferredSymlinks = mutableListOf<Pair<String, String>>()
        val entryHandler = createEntryHandler(deferredSymlinks, rootfsDir)

        val result = tarExtractor.extract(tarPath, rootfs, entryHandler)
        validator.validateExtractionResult(result)

        val symlinkResult = symlinkHandler.createDeferredSymlinks(deferredSymlinks, rootfs)
        validator.validateFinalState(rootfsDir, result, symlinkResult)

        File(tarPath).delete()
    }

    private fun prepareDirectory(rootfs: File) {
        if (rootfs.exists()) deleteRecursively(rootfs)
        rootfs.mkdirs()
    }

    private fun createEntryHandler(
        deferredSymlinks: MutableList<Pair<String, String>>,
        rootfsDir: String
    ): TarExtractor.EntryHandler {
        return object : TarExtractor.EntryHandler {
            override fun handleDirectory(entry: TarArchiveEntry, outFile: File) {
                outFile.mkdirs()
            }

            override fun handleSymbolicLink(entry: TarArchiveEntry, outFile: File) {
                deferredSymlinks.add(Pair(entry.linkName, outFile.absolutePath))
            }

            override fun handleHardLink(entry: TarArchiveEntry, outFile: File, rootfsDir: File) {
                val target = entry.linkName.removePrefix("./").removePrefix("/")
                val targetFile = File(rootfsDir, target)
                outFile.parentFile?.mkdirs()
                try {
                    if (targetFile.exists()) {
                        targetFile.copyTo(outFile, overwrite = true)
                        if (targetFile.canExecute())
                            outFile.setExecutable(true, false)
                    }
                } catch (_: Exception) {}
            }

            override fun handleRegularFile(
                entry: TarArchiveEntry,
                outFile: File,
                inputStream: TarArchiveInputStream
            ) {
                outFile.parentFile?.mkdirs()
                FileOutputStream(outFile).use { fos ->
                    val buf = ByteArray(65536)
                    var len: Int
                    while (inputStream.read(buf).also { len = it } != -1) {
                        fos.write(buf, 0, len)
                    }
                }
                permissionFixer.fixFilePermissions(outFile, entry)
            }
        }
    }

    private fun deleteRecursively(file: File) {
        try {
            if (!file.canonicalPath.startsWith(filesDir)) return
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
            file.listFiles()?.forEach { deleteRecursively(it) }
        }
        file.delete()
    }
}
