package com.example.riko

import java.io.File

/**
 * Validates rootfs extraction results, ensuring integrity and completeness.
 */
class ExtractionValidator {

    fun validateExtractionResult(result: TarExtractor.ExtractionResult) {
        if (result.entryCount == 0) {
            throw RuntimeException(
                "解压失败: tarball 为空或损坏。错误: ${result.error?.message ?: "无"}"
            )
        }
        if (result.error != null && result.fileCount < 100) {
            throw RuntimeException(
                "解压失败 (${result.entryCount} 条目, ${result.fileCount} 文件): ${result.error!!.message}"
            )
        }
    }

    fun validateFinalState(
        rootfsDir: String,
        extractionResult: TarExtractor.ExtractionResult,
        symlinkResult: SymlinkHandler.SymlinkResult
    ) {
        if (!File("$rootfsDir/bin/bash").exists() &&
            !File("$rootfsDir/usr/bin/bash").exists()) {
            throw RuntimeException(
                "解压失败: rootfs 中找不到 bash。处理了 ${extractionResult.entryCount} 条目, " +
                "${extractionResult.fileCount} 文件, ${extractionResult.symlinkCount} 符号链接 " +
                "(${symlinkResult.errorCount} 错误)。" +
                "最后符号链接错误: ${symlinkResult.lastError}"
            )
        }
    }
}
