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

// Ajustes (sección 10.7) en DataStore (Preferences).

enum class BgStyle { SOLID, GRADIENT, LIVE, BLUR }

data class AppSettings(
    val enabled: Boolean = false,
    val fontScale: Float = 1f,
    val maxOpacity: Float = 1f,
    val showNextLine: Boolean = true,
    val showArtwork: Boolean = true,
    val bgStyle: BgStyle = BgStyle.SOLID,
    val pauseBehavior: PauseBehavior = PauseBehavior.DIM,
    val pauseDelayMs: Long = 10_000,
    val noLyricsBehavior: NoLyricsBehavior = NoLyricsBehavior.TITLE,
    val alignCutout: Boolean = true,
    val topMarginDp: Int = 6,
    val hideInLandscape: Boolean = true,
    /** Por defecto se permiten las apps de música; navegadores y YouTube (video) quedan opcionales (R12, HU-09). */
    val blockedApps: List<String> = DEFAULT_BLOCKED,
    val detectedApps: List<String> = emptyList(),
    val experimentalPlain: Boolean = false,
    /** Adelanto global (ms): compensa la animación de entrada de cada línea. */
    val leadMs: Long = 150,
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
    }

    private inline fun <reified E : Enum<E>> enumOr(v: String?, d: E): E = v?.let { runCatching { enumValueOf<E>(it) }.getOrNull() } ?: d

    private fun list(v: String?, d: List<String>) = v?.split('\n')?.map { it.trim() }?.filter { it.isNotEmpty() } ?: d

    private fun fromPrefs(p: Preferences): AppSettings {
        val d = AppSettings()
        return AppSettings(
            enabled = p[K.enabled] ?: d.enabled,
            fontScale = p[K.fontScale] ?: d.fontScale,
            maxOpacity = p[K.maxOpacity] ?: d.maxOpacity,
            showNextLine = p[K.showNextLine] ?: d.showNextLine,
            showArtwork = p[K.showArtwork] ?: d.showArtwork,
            bgStyle = enumOr(p[K.bgStyle], d.bgStyle),
            pauseBehavior = enumOr(p[K.pauseBehavior], d.pauseBehavior),
            pauseDelayMs = p[K.pauseDelayMs] ?: d.pauseDelayMs,
            noLyricsBehavior = enumOr(p[K.noLyrics], d.noLyricsBehavior),
            alignCutout = p[K.alignCutout] ?: d.alignCutout,
            topMarginDp = p[K.topMarginDp] ?: d.topMarginDp,
            hideInLandscape = p[K.hideInLandscape] ?: d.hideInLandscape,
            blockedApps = list(p[K.blocked], d.blockedApps),
            detectedApps = list(p[K.detected], emptyList()),
            experimentalPlain = p[K.experimentalPlain] ?: d.experimentalPlain,
            pausedUntilMs = p[K.pausedUntil] ?: 0,
            leadMs = p[K.leadMs] ?: d.leadMs,
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
        }
    }

    suspend fun noteDetected(pkg: String) = update { s ->
        if (pkg in s.detectedApps) s else s.copy(detectedApps = (s.detectedApps + pkg).takeLast(30))
    }
}
