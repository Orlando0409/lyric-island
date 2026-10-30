// Núcleo puro en Kotlin JVM: puerto de desktop/src/core (TypeScript). Sin dependencias de Android.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin {
    jvmToolchain(21)
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.snakeyaml.engine) // lyricsfile de LRCLIB (tiempos por palabra)
    testImplementation(libs.kotlin.test)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.kotlinx.coroutines.test)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // Los golden files compartidos con TypeScript.
    systemProperty("fixtures.dir", rootProject.projectDir.resolve("../shared/fixtures").canonicalPath)
    testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
