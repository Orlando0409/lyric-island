package com.lyricisland.core

// Tipos del núcleo (sección 7.2). Equivalentes a desktop/src/core/types.ts.

enum class PlaybackStatus(val wire: String) {
    PLAYING("playing"), PAUSED("paused"), STOPPED("stopped"), UNKNOWN("unknown");

    companion object {
        fun fromWire(s: String): PlaybackStatus = entries.firstOrNull { it.wire == s } ?: UNKNOWN
    }
}

data class NowPlaying(
    val sourceAppId: String,
    val title: String,
    val artist: String,
    val album: String?,
    val durationMs: Long?,
    val artworkHash: String?,
)

/**
 * ⚠️ Dominios de reloj: en Android `updatedAtMs` usa SystemClock.elapsedRealtime()
 * (el de PlaybackState.getLastPositionUpdateTime()); se compara siempre contra el mismo reloj.
 */
data class Timeline(
    val positionMs: Long,
    val updatedAtMs: Long,
    val rate: Float,
    val status: PlaybackStatus,
)

data class LyricWord(val text: String, val startMs: Long, val endMs: Long, val estimated: Boolean)

data class LyricLine(
    val index: Int,
    val startMs: Long,
    val endMs: Long,
    val text: String,
    val words: List<LyricWord>,
    val isInterlude: Boolean,
)

enum class LyricsKind(val wire: String) { SYNCED("synced"), PLAIN("plain"), INSTRUMENTAL("instrumental"), NONE("none") }

enum class LyricsSource(val wire: String) { LRCLIB("lrclib"), LOCAL_FILE("local-file"), CACHE("cache") }

data class LyricsDocument(
    val kind: LyricsKind,
    val lines: List<LyricLine>,
    val plainText: String?,
    val offsetMs: Long,
    val source: LyricsSource,
    val lrclibId: Long?,
)

data class Palette(
    val background: String,
    val backgroundAlt: String,
    val textPrimary: String,
    val textUpcoming: String,
    val textSecondary: String,
    val accent: String,
)

enum class IslandMode(val wire: String) { HIDDEN("hidden"), COMPACT("compact"), EXPANDED("expanded"), PAUSED("paused") }

/** Math.round de JavaScript (redondeo hacia +∞ en .5) para que TS y Kotlin den los mismos enteros. */
internal fun jsRound(x: Double): Long = Math.floor(x + 0.5).toLong()

internal fun clamp(v: Double, lo: Double, hi: Double): Double = minOf(hi, maxOf(lo, v))

/** Espacios según `\s` de JavaScript (Java `\s` solo cubre ASCII). */
internal const val JS_SPACE = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"

internal fun isJsSpace(c: Char): Boolean =
    c == '\t' || c == '\n' || c == '\u000B' || c == '\u000C' || c == '\r' || c == ' ' || c == ' ' || c == ' ' ||
        c in ' '..' ' || c == ' ' || c == ' ' || c == ' ' || c == ' ' || c == '　' || c == '﻿'

internal fun String.jsTrim(): String = trim(::isJsSpace)
internal fun String.jsTrimStart(): String = trimStart(::isJsSpace)
internal fun String.jsTrimEnd(): String = trimEnd(::isJsSpace)
