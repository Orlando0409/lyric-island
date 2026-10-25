package com.lyricisland.core

// IslandStateMachine (sección 10.1). Puerto de stateMachine.ts.

enum class PauseBehavior { DIM, COMPACT, HIDE }
enum class NoLyricsBehavior { TITLE, COMPACT, HIDE }

data class PlayerFilter(val allowMode: Boolean, val apps: List<String>) {
    /** Coincidencia por subcadena sin distinguir mayúsculas. Lista vacía en modo allow = se permite todo. */
    fun allows(sourceAppId: String): Boolean {
        val hit = apps.any { it.isNotBlank() && sourceAppId.contains(it.trim(), ignoreCase = true) }
        return if (allowMode) apps.isEmpty() || hit else !hit
    }
}

data class IslandBehavior(
    val pauseBehavior: PauseBehavior = PauseBehavior.DIM,
    val pauseCompactDelayMs: Long = 10_000,
    val noLyricsBehavior: NoLyricsBehavior = NoLyricsBehavior.TITLE,
    val hideOnFullscreen: Boolean = true,
    val playerFilter: PlayerFilter = PlayerFilter(false, emptyList()),
    val experimentalPlain: Boolean = false,
    /** Adelanto global de la letra en ms (lo aplica el SyncEngine). */
    val lyricsLeadMs: Long = 0,
)

/** null = sin pista; LOADING = buscando la letra. */
enum class LyricsStatus { SYNCED, PLAIN, INSTRUMENTAL, NONE, LOADING }

data class MachineFacts(
    val track: NowPlaying?,
    val status: PlaybackStatus,
    val lyrics: LyricsStatus?,
    val fullscreen: Boolean,
    val userHidden: Boolean,
    val userCompact: Boolean,
    val pausedSinceMs: Long?,
    val isAd: Boolean,
    val now: Long,
)

data class Decision(val mode: IslandMode, val showTitle: Boolean, val recheckAtMs: Long?)

object IslandStateMachine {
    private val HIDDEN = Decision(IslandMode.HIDDEN, false, null)

    fun hasTimedLines(lyrics: LyricsStatus?, b: IslandBehavior): Boolean =
        lyrics == LyricsStatus.SYNCED || (lyrics == LyricsStatus.PLAIN && b.experimentalPlain)

    fun decide(f: MachineFacts, b: IslandBehavior): Decision {
        val track = f.track ?: return HIDDEN
        if (f.status == PlaybackStatus.STOPPED) return HIDDEN
        if (!b.playerFilter.allows(track.sourceAppId)) return HIDDEN
        if (f.userHidden) return HIDDEN
        if (f.fullscreen && b.hideOnFullscreen) return HIDDEN
        if (f.isAd) return Decision(IslandMode.COMPACT, false, null)

        val paused = f.status == PlaybackStatus.PAUSED
        if (hasTimedLines(f.lyrics, b)) {
            if (f.userCompact) return if (paused && b.pauseBehavior == PauseBehavior.HIDE) HIDDEN else Decision(IslandMode.COMPACT, true, null)
            if (!paused) return Decision(IslandMode.EXPANDED, false, null)
            return when (b.pauseBehavior) {
                PauseBehavior.HIDE -> HIDDEN
                PauseBehavior.COMPACT -> Decision(IslandMode.COMPACT, true, null)
                PauseBehavior.DIM -> {
                    val at = (f.pausedSinceMs ?: f.now) + b.pauseCompactDelayMs
                    if (f.now >= at) Decision(IslandMode.COMPACT, true, null) else Decision(IslandMode.PAUSED, false, at)
                }
            }
        }
        if (paused && b.pauseBehavior == PauseBehavior.HIDE) return HIDDEN
        if (f.lyrics == LyricsStatus.LOADING || f.lyrics == null) return Decision(IslandMode.COMPACT, true, null)
        if (b.noLyricsBehavior == NoLyricsBehavior.HIDE) return HIDDEN
        return Decision(IslandMode.COMPACT, b.noLyricsBehavior == NoLyricsBehavior.TITLE, null)
    }
}
