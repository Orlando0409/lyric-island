package com.lyricisland.app.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.lyricisland.core.IslandBehavior
import com.lyricisland.core.NoLyricsBehavior
import com.lyricisland.core.PauseBehavior
import com.lyricisland.core.PlayerFilter
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

// Ajustes en DataStore (Preferences).

enum class BgStyle { SOLID, GRADIENT, LIVE, BLUR }

/** Isla arriba (alrededor de la cámara) o burbuja flotante que se arrastra, como las de Messenger. */
enum class OverlayStyle { ISLAND, BUBBLE }

data class AppSettings(
    val enabled: Boolean = false,
    val fontScale: Float = 1f,
    val maxOpacity: Float = 1f,
    val showNextLine: Boolean = true,
    val showArtwork: Boolean = true,
    val bgStyle: BgStyle = BgStyle.SOLID,
    /** Degradado (estilos GRADIENT y LIVE): colores elegidos por el usuario en lugar de los de la carátula, y ángulo (como en CSS). */
    val gradientCustom: Boolean = false,
    val gradientFrom: String = "#6A3DE8",
    val gradientTo: String = "#E83D84",
    val gradientAngle: Int = 135,
    val overlayStyle: OverlayStyle = OverlayStyle.ISLAND,
    /** Burbuja: lado de la pantalla, altura (fracción de la pantalla) y línea actual al lado de la burbuja. */
    val bubbleRight: Boolean = true,
    val bubbleY: Float = 0.3f,
    val bubbleShowLine: Boolean = true,
    val pauseBehavior: PauseBehavior = PauseBehavior.DIM,
    val pauseDelayMs: Long = 10_000,
    val noLyricsBehavior: NoLyricsBehavior = NoLyricsBehavior.TITLE,
    val alignCutout: Boolean = false,
    val topMarginDp: Int = 30,
    val hideInLandscape: Boolean = true,
    /** Por defecto se permiten las apps de música; navegadores y YouTube (video) quedan opcionales. */
    val blockedApps: List<String> = DEFAULT_BLOCKED,
    val detectedApps: List<String> = emptyList(),
    val experimentalPlain: Boolean = false,
    /** Adelanto global (ms): compensa la animación de entrada de cada línea. */
    val leadMs: Long = 150,
    /** Canciones en japonés: romaji debajo de la línea actual (en lugar de la siguiente). */
    val showRomaji: Boolean = true,
    val pausedUntilMs: Long = 0, // "Pausar 1 h" desde la notificación (reloj de pared)
) {
    fun behavior() = IslandBehavior(
        pauseBehavior = pauseBehavior,
        pauseCompactDelayMs = pauseDelayMs,
        noLyricsBehavior = noLyricsBehavior,
        hideOnFullscreen = false,
        playerFilter = PlayerFilter(allowMode = false, apps = blockedApps),
        experimentalPlain = experimentalPlain,
        lyricsLeadMs = leadMs,
    )

    companion object {
        val DEFAULT_BLOCKED = listOf("com.android.chrome", "org.mozilla.firefox", "com.brave.browser", "com.microsoft.emmx", "com.opera", "com.google.android.youtube")
    }
}

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class SettingsRepository(private val context: Context) {
    private object K {
        val enabled = booleanPreferencesKey("enabled")
        val fontScale = floatPreferencesKey("fontScale")
        val maxOpacity = floatPreferencesKey("maxOpacity")
        val showNextLine = booleanPreferencesKey("showNextLine")
        val showArtwork = booleanPreferencesKey("showArtwork")
        val bgStyle = stringPreferencesKey("bgStyle")
        val gradientCustom = booleanPreferencesKey("gradientCustom")
        val gradientFrom = stringPreferencesKey("gradientFrom")
        val gradientTo = stringPreferencesKey("gradientTo")
        val gradientAngle = intPreferencesKey("gradientAngle")
        val overlayStyle = stringPreferencesKey("overlayStyle")
        val bubbleRight = booleanPreferencesKey("bubbleRight")
        val bubbleY = floatPreferencesKey("bubbleY")
        val bubbleShowLine = booleanPreferencesKey("bubbleShowLine")
        val pauseBehavior = stringPreferencesKey("pauseBehavior")
        val pauseDelayMs = longPreferencesKey("pauseDelayMs")
        val noLyrics = stringPreferencesKey("noLyrics")
        val alignCutout = booleanPreferencesKey("alignCutout")
        val topMarginDp = intPreferencesKey("topMarginDp")
        val hideInLandscape = booleanPreferencesKey("hideInLandscape")
        val blocked = stringPreferencesKey("blockedApps")
        val detected = stringPreferencesKey("detectedApps")
        val experimentalPlain = booleanPreferencesKey("experimentalPlain")
        val pausedUntil = longPreferencesKey("pausedUntil")
        val leadMs = longPreferencesKey("leadMs")
        val showRomaji = booleanPreferencesKey("showRomaji")
        /** Versión de los valores por defecto guardados (2: sin alinear a la cámara y margen de 30 dp). */
        val defaultsVersion = intPreferencesKey("defaultsVersion")
    }

    private companion object {
        const val DEFAULTS_VERSION = 2
        val HEX = Regex("^#[0-9A-Fa-f]{6}$")
    }

    private inline fun <reified E : Enum<E>> enumOr(v: String?, d: E): E = v?.let { runCatching { enumValueOf<E>(it) }.getOrNull() } ?: d

    private fun list(v: String?, d: List<String>) = v?.split('\n')?.map { it.trim() }?.filter { it.isNotEmpty() } ?: d

    private fun fromPrefs(p: Preferences): AppSettings {
        val d = AppSettings()
        // Ajustes guardados con los valores por defecto viejos (alinear a la cámara, 6 dp): se toman los nuevos.
        val current = (p[K.defaultsVersion] ?: 0) >= DEFAULTS_VERSION
        return AppSettings(
            enabled = p[K.enabled] ?: d.enabled,
            fontScale = p[K.fontScale] ?: d.fontScale,
            maxOpacity = p[K.maxOpacity] ?: d.maxOpacity,
            showNextLine = p[K.showNextLine] ?: d.showNextLine,
            showArtwork = p[K.showArtwork] ?: d.showArtwork,
            bgStyle = enumOr(p[K.bgStyle], d.bgStyle),
            gradientCustom = p[K.gradientCustom] ?: d.gradientCustom,
            gradientFrom = p[K.gradientFrom]?.takeIf { HEX.matches(it) } ?: d.gradientFrom,
            gradientTo = p[K.gradientTo]?.takeIf { HEX.matches(it) } ?: d.gradientTo,
            gradientAngle = p[K.gradientAngle] ?: d.gradientAngle,
            overlayStyle = enumOr(p[K.overlayStyle], d.overlayStyle),
            bubbleRight = p[K.bubbleRight] ?: d.bubbleRight,
            bubbleY = (p[K.bubbleY] ?: d.bubbleY).coerceIn(0f, 1f),
            bubbleShowLine = p[K.bubbleShowLine] ?: d.bubbleShowLine,
            pauseBehavior = enumOr(p[K.pauseBehavior], d.pauseBehavior),
            pauseDelayMs = p[K.pauseDelayMs] ?: d.pauseDelayMs,
            noLyricsBehavior = enumOr(p[K.noLyrics], d.noLyricsBehavior),
            alignCutout = p[K.alignCutout]?.takeIf { current } ?: d.alignCutout,
            topMarginDp = p[K.topMarginDp]?.takeIf { current } ?: d.topMarginDp,
            hideInLandscape = p[K.hideInLandscape] ?: d.hideInLandscape,
            blockedApps = list(p[K.blocked], d.blockedApps),
            detectedApps = list(p[K.detected], emptyList()),
            experimentalPlain = p[K.experimentalPlain] ?: d.experimentalPlain,
            pausedUntilMs = p[K.pausedUntil] ?: 0,
            leadMs = p[K.leadMs] ?: d.leadMs,
            showRomaji = p[K.showRomaji] ?: d.showRomaji,
        )
    }

    val settings: Flow<AppSettings> = context.dataStore.data.map(::fromPrefs)

    suspend fun update(transform: (AppSettings) -> AppSettings) {
        context.dataStore.edit { p ->
            val n = transform(fromPrefs(p))
            p[K.enabled] = n.enabled
            p[K.fontScale] = n.fontScale
            p[K.maxOpacity] = n.maxOpacity
            p[K.showNextLine] = n.showNextLine
            p[K.showArtwork] = n.showArtwork
            p[K.bgStyle] = n.bgStyle.name
            p[K.gradientCustom] = n.gradientCustom
            p[K.gradientFrom] = n.gradientFrom
            p[K.gradientTo] = n.gradientTo
            p[K.gradientAngle] = n.gradientAngle
            p[K.overlayStyle] = n.overlayStyle.name
            p[K.bubbleRight] = n.bubbleRight
            p[K.bubbleY] = n.bubbleY
            p[K.bubbleShowLine] = n.bubbleShowLine
            p[K.pauseBehavior] = n.pauseBehavior.name
            p[K.pauseDelayMs] = n.pauseDelayMs
            p[K.noLyrics] = n.noLyricsBehavior.name
            p[K.alignCutout] = n.alignCutout
            p[K.topMarginDp] = n.topMarginDp
            p[K.hideInLandscape] = n.hideInLandscape
            p[K.blocked] = n.blockedApps.joinToString("\n")
            p[K.detected] = n.detectedApps.joinToString("\n")
            p[K.experimentalPlain] = n.experimentalPlain
            p[K.pausedUntil] = n.pausedUntilMs
            p[K.leadMs] = n.leadMs
            p[K.showRomaji] = n.showRomaji
            p[K.defaultsVersion] = DEFAULTS_VERSION
        }
    }

    suspend fun noteDetected(pkg: String) = update { s ->
        if (pkg in s.detectedApps) s else s.copy(detectedApps = (s.detectedApps + pkg).takeLast(30))
    }
}
