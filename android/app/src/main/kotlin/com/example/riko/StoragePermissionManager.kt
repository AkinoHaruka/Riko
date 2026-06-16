package com.example.riko

import android.os.Build
import android.os.Environment
import java.io.File

/**
 * 存储权限管理器，负责处理存储权限检查和符号链接创建
 */
class StoragePermissionManager(
    private val rootfsDir: String
) {
    fun hasStorageAccess(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            val sdcard = Environment.getExternalStorageDirectory()
            sdcard.exists() && sdcard.canRead()
        }
    }

    fun setupStorageLinks() {
        val storageDir = File("$rootfsDir/storage")
        storageDir.mkdirs()

        val sdcardLink = File("$rootfsDir/sdcard")
        if (!sdcardLink.exists()) {
            createSymbolicLink(sdcardLink)
        }
    }

    private fun createSymbolicLink(target: File) {
        try {
            Runtime.getRuntime().exec(
                arrayOf("ln", "-sf", "/storage/emulated/0", target.absolutePath)
            ).waitFor()
        } catch (_: Exception) {
            target.mkdirs()
        }
    }
}
