// App auxiliar (15.4): crea una MediaSession controlable para probar la isla sin depender de Spotify.
plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.lyricisland.testplayer"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }
    defaultConfig {
        applicationId = "com.lyricisland.testplayer"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
