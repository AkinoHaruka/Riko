package com.example.riko

import java.io.File
import java.security.SecureRandom

class EnvironmentBuilder(
    private val filesDir: String
) {
    fun build(): Map<String, String> {
        val dataDir = "$filesDir/data"
        val (jwtSecret, encKey) = loadOrGenerateSecrets()
        return mapOf(
            "JWT_SECRET" to jwtSecret,
            "ENCRYPTION_KEY" to encKey,
            "PORT" to "3000",
            "DB_PATH" to "$dataDir/app.db",
            "MEMORY_ROOT_DIR" to "../../data/memories",
            "SYSTEM_PROMPTS_DIR" to "$dataDir/prompts",
            "NODE_ENV" to "production",
            "DB_ENGINE" to "wasm",
        )
    }

    private fun loadOrGenerateSecrets(): Pair<String, String> {
        val dataDir = File(filesDir, "data")
        dataDir.mkdirs()
        val secretsFile = File(dataDir, ".secrets")
        if (secretsFile.exists()) {
            val lines = secretsFile.readLines()
            val jwt = lines.getOrElse(0) { generateSecret(32) }
            val enc = lines.getOrElse(1) { generateSecret(16) }
            return Pair(jwt, enc)
        } else {
            val jwt = generateSecret(32)
            val enc = generateSecret(16)
            secretsFile.writeText("$jwt\n$enc")
            secretsFile.setReadable(false, false)
            secretsFile.setWritable(false, false)
            secretsFile.setReadable(true, true)
            secretsFile.setWritable(true, true)
            return Pair(jwt, enc)
        }
    }

    private fun generateSecret(bytes: Int): String {
        val random = SecureRandom()
        val buf = ByteArray(bytes)
        random.nextBytes(buf)
        return buf.joinToString("") { "%02x".format(it) }
    }
}
