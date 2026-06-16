package com.example.riko

import android.content.res.AssetManager

interface BootstrapStep {
    val name: String
    fun execute(context: BootstrapContext)
}

class BootstrapContext(
    val filesDir: String,
    val nativeLibDir: String,
    val assets: AssetManager,
    val arch: String,
    val nodeArch: String,
    val ubuntuArch: String,
    val bootstrapManager: BootstrapManager,
    val processManager: ProcessManager
)
