package com.example.riko

import android.content.Context
import android.content.Intent
import android.os.Build
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.EventChannel

/**
 * MethodChannel bridge between Flutter and the proot-based Node.js backend.
 * Replaces the old BackendPlugin (which used nodejs-mobile via JNI).
 */
class ProotPlugin : FlutterPlugin, MethodChannel.MethodCallHandler {

    private lateinit var channel: MethodChannel
    private var appContext: Context? = null
    private var bootstrapManager: BootstrapManager? = null
    private var processManager: ProcessManager? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        appContext = binding.applicationContext
        channel = MethodChannel(binding.binaryMessenger, "com.example.riko/backend")
        channel.setMethodCallHandler(this)

        setupManagers()
    }

    private fun setupManagers() {
        val ctx = appContext ?: return
        val filesDir = ctx.filesDir.absolutePath
        val nativeLibDir = ctx.applicationInfo.nativeLibraryDir

        bootstrapManager = BootstrapManager(ctx, filesDir, nativeLibDir)
        processManager = ProcessManager(filesDir, nativeLibDir)

        // Ensure directories exist on every app start
        Thread {
            try { bootstrapManager?.setupDirectories() } catch (_: Exception) {}
            try { bootstrapManager?.writeResolvConf() } catch (_: Exception) {}
        }.start()
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        val ctx = appContext
        if (ctx == null) {
            result.error("NO_CONTEXT", "Plugin not attached", null)
            return
        }

        when (call.method) {
            "startBackend" -> {
                val intent = Intent(ctx, BackendService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
                result.success(true)
            }

            "stopBackend" -> {
                ctx.stopService(Intent(ctx, BackendService::class.java))
                result.success(true)
            }

            "isBackendRunning" -> {
                result.success(BackendService.isRunning)
            }

            "getBootstrapStatus" -> {
                result.success(bootstrapManager?.getBootstrapStatus() ?: mapOf("complete" to false))
            }

            "runInProot" -> {
                val command = call.argument<String>("command")
                if (command != null) {
                    Thread {
                        try {
                            val output = processManager?.runInProotSync(command) ?: ""
                            runOnUiThread(ctx) { result.success(output) }
                        } catch (e: Exception) {
                            runOnUiThread(ctx) { result.error("PROOT_ERROR", e.message, null) }
                        }
                    }.start()
                } else {
                    result.error("INVALID_ARGS", "command required", null)
                }
            }

            "getFilesDir" -> {
                result.success(ctx.filesDir.absolutePath)
            }

            "getArch" -> {
                result.success(ArchUtils.getArch())
            }

            else -> result.notImplemented()
        }
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
        appContext = null
        bootstrapManager = null
        processManager = null
    }

    private fun runOnUiThread(context: Context, action: () -> Unit) {
        android.os.Handler(context.mainLooper).post(action)
    }
}
