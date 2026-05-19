import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.example.riko"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "com.example.riko"
        minSdk = 29 // proot requires API 29+
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // TTS 模型文件不压缩，避免 >1MB 压缩 assets 读取失败
    aaptOptions {
        noCompress += listOf("onnx", "onnx_data", "json", "wav")
    }

    packagingOptions {
        jniLibs {
            useLegacyPackaging = true
        }
    }

    signingConfigs {
        create("release") {
            val propsFile = rootProject.file("key.properties")
            if (propsFile.exists()) {
                val props = Properties()
                props.load(propsFile.inputStream())
                storeFile = file(props.getProperty("storeFile", ""))
                storePassword = props.getProperty("storePassword", "")
                keyAlias = props.getProperty("keyAlias", "")
                keyPassword = props.getProperty("keyPassword", "")
            }
        }
    }

    buildTypes {
        release {
            val propsFile = rootProject.file("key.properties")
            if (propsFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            } else {
                signingConfig = signingConfigs.getByName("debug")
            }
        }
    }
}

dependencies {
    // Pure Java archive extraction (tar.gz, tar.xz, tar.zst) for rootfs bootstrap
    implementation("org.apache.commons:commons-compress:1.26.0")
    implementation("org.tukaani:xz:1.9")
    implementation("com.github.luben:zstd-jni:1.5.7-6@aar")
}

flutter {
    source = "../.."
}
