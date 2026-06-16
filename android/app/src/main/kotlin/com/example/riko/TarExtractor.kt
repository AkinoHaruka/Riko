package com.example.riko

import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.util.zip.GZIPInputStream
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream

/**
 * Handles TAR archive extraction (plain tar or gzip-compressed).
 * Delegates entry-type-specific handling to [EntryHandler].
 */
class TarExtractor(
    private val bufferSize: Int = 256 * 1024
) {

    data class ExtractionResult(
        val entryCount: Int,
        val fileCount: Int,
        val symlinkCount: Int,
        val error: Exception?
    )

    interface EntryHandler {
        fun handleDirectory(entry: TarArchiveEntry, outFile: File)
        fun handleSymbolicLink(entry: TarArchiveEntry, outFile: File)
        fun handleHardLink(entry: TarArchiveEntry, outFile: File, rootfsDir: File)
        fun handleRegularFile(entry: TarArchiveEntry, outFile: File, inputStream: TarArchiveInputStream)
    }

    fun extract(tarPath: String, rootfsDir: File, handler: EntryHandler): ExtractionResult {
        val isGzip = tarPath.endsWith(".gz")
        var entryCount = 0
        var fileCount = 0
        var symlinkCount = 0
        var extractionError: Exception? = null

        try {
            FileInputStream(tarPath).use { fis ->
                BufferedInputStream(fis, bufferSize).use { bis ->
                    val rawStream: InputStream = if (isGzip) GZIPInputStream(bis) else bis
                    TarArchiveInputStream(rawStream).use { tis ->
                        var entry: TarArchiveEntry? = tis.nextEntry
                        while (entry != null) {
                            entryCount++
                            val name = entry.name
                                .removePrefix("./")
                                .removePrefix("/")

                            if (name.isEmpty() || name.startsWith("dev/") || name == "dev") {
                                entry = tis.nextEntry
                                continue
                            }

                            val targetFile = File(rootfsDir, name)
                            if (!targetFile.canonicalPath.startsWith(rootfsDir.canonicalPath + File.separator) &&
                                targetFile.canonicalPath != rootfsDir.canonicalPath) {
                                entry = tis.nextEntry
                                continue
                            }

                            when {
                                entry.isDirectory -> {
                                    handler.handleDirectory(entry, targetFile)
                                }
                                entry.isSymbolicLink -> {
                                    handler.handleSymbolicLink(entry, targetFile)
                                    symlinkCount++
                                }
                                entry.isLink -> {
                                    handler.handleHardLink(entry, targetFile, rootfsDir)
                                    fileCount++
                                }
                                else -> {
                                    handler.handleRegularFile(entry, targetFile, tis)
                                    fileCount++
                                }
                            }
                            entry = tis.nextEntry
                        }
                    }
                }
            }
        } catch (e: Exception) {
            extractionError = e
        }

        return ExtractionResult(entryCount, fileCount, symlinkCount, extractionError)
    }
}
