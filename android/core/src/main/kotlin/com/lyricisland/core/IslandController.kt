package com.lyricisland.core

// Orquestador (sección 6.3). Puerto de controller.ts. Puro: reloj, temporizadores y lanzamiento de corrutinas inyectados.

interface Scheduler {
    fun setTimeout(ms: Long, fn: () -> Unit): Any
    fun clearTimeout(handle: Any)
}

data class IslandSnapshot(
    val mode: IslandMode,
    val showTitle: Boolean,
    val track: NowPlaying?,
    val lyrics: LyricsDocument?,
    val activeLineIndex: Int,
    val lineProgress: Double,
    val wordIndex: Int,
    val wordProgress: Double,
    val interlude: Interlude?,
    val positionMs: Double,
    val palette: Palette,
    val lyricsLoading: Boolean,
    val userOffsetMs: Long,
    val offsetFlash: String?,
    val status: PlaybackStatus,
    val estimatedLines: Boolean,
)

class IslandController(
    private val clock: Clock,
    private val scheduler: Scheduler,
    /** Lanza un trabajo asíncrono (en la app: scope.launch; en los tests: síncrono). */
    private val launch: (suspend () -> Unit) -> Unit,
    private val fetchLyrics: suspend (NowPlaying) -> LyricsDocument,
    private val loadUserOffset: suspend (NowPlaying) -> Long = { 0 },
    private val saveUserOffset: (NowPlaying, Long) -> Unit = { _, _ -> },
    behavior: IslandBehavior = IslandBehavior(),
) {
    companion object {
        const val TRACK_DEBOUNCE_MS = 400L
        const val OFFSET_STEP_MS = 100L
        const val OFFSET_FLASH_MS = 1500L
        const val LYRICS_RETRY_MS = 10_000L

        fun trackKey(t: NowPlaying) = listOf(t.sourceAppId, t.title, t.artist, t.album ?: "", t.durationMs?.toString() ?: "").joinToString("␟")

        fun formatOffset(ms: Long) = "${if (ms > 0) "+" else if (ms < 0) "−" else "±"}${kotlin.math.abs(ms)} ms"
    }

    private var track: NowPlaying? = null
    private var key: String? = null
    private var lyrics: LyricsDocument? = null
    private var lines: List<LyricLine> = emptyList()
    private var loading = false
    private var status = PlaybackStatus.UNKNOWN
    private var pausedSince: Long? = null
    private var fullscreen = false
    private var userHidden = false
    private var userCompact = false
    private var userOffset = 0L
    private var flashUntil = 0L
    private var palette = ColorEngine.NEUTRAL_PALETTE
    var behavior: IslandBehavior = behavior
        private set
    private var debounce: Any? = null
    private var recheck: Any? = null
    private var generation = 0
    private val listeners = LinkedHashSet<() -> Unit>()
    val sync = SyncEngine(clock)

    fun subscribe(fn: () -> Unit): () -> Unit {
        listeners.add(fn)
        return { listeners.remove(fn) }
    }

    private fun emit() {
        scheduleRecheck()
        listeners.toList().forEach { it() }
    }

    private fun scheduleRecheck() {
        recheck?.let(scheduler::clearTimeout)
        recheck = null
        val at = decision().recheckAtMs ?: return
        recheck = scheduler.setTimeout(maxOf(0, at - clock.now())) {
            recheck = null
            emit()
        }
    }

    fun setBehavior(b: IslandBehavior) {
        behavior = b
        rebuildLines()
        emit()
    }

    fun setPalette(p: Palette) {
        palette = p
        emit()
    }

    fun onTrack(t: NowPlaying) {
        val k = trackKey(t)
        if (k == key) {
            track = t
            emit()
            return
        }
        track = t
        key = k
        lyrics = null
        lines = emptyList()
        loading = true
        userOffset = 0
        sync.resetTrack(t.durationMs)
        sync.userOffsetMs = 0
        val gen = ++generation
        debounce?.let(scheduler::clearTimeout)
        debounce = scheduler.setTimeout(TRACK_DEBOUNCE_MS) {
            debounce = null
            launch { load(t, gen, 0) }
        }
        emit()
    }

    private suspend fun load(t: NowPlaying, gen: Int, attempt: Int) {
        var failed = false
        var offset = 0L
        val doc = try {
            val d = fetchLyrics(t)
            offset = loadUserOffset(t)
            d
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            failed = true
            LyricsRepository.NONE
        }
        if (gen != generation) return
        if (failed && attempt == 0) {
            scheduler.setTimeout(LYRICS_RETRY_MS) { if (gen == generation) launch { load(t, gen, 1) } }
        }
        lyrics = doc
        loading = false
        userOffset = offset
        sync.userOffsetMs = offset
        rebuildLines()
        emit()
    }

    private fun rebuildLines() {
        val doc = lyrics
        val dur = track?.durationMs
        lines = when {
            doc == null -> emptyList()
            doc.kind == LyricsKind.SYNCED -> doc.lines
            doc.kind == LyricsKind.PLAIN && behavior.experimentalPlain && doc.plainText != null && dur != null && dur > 0 ->
                LrcParser.estimatePlainLines(doc.plainText, dur)
            else -> emptyList()
        }
        sync.setLyrics(lines, if (doc?.kind == LyricsKind.SYNCED) doc.offsetMs else 0)
    }

    fun onTimeline(tl: Timeline) {
        val prev = status
        status = tl.status
        if (tl.status == PlaybackStatus.PAUSED && prev != PlaybackStatus.PAUSED) pausedSince = clock.now()
        if (tl.status != PlaybackStatus.PAUSED) pausedSince = null
        sync.update(tl)
        emit()
    }

    fun onCleared() {
        generation++
        debounce?.let(scheduler::clearTimeout)
        debounce = null
        track = null
        key = null
        lyrics = null
        lines = emptyList()
        loading = false
        status = PlaybackStatus.STOPPED
        pausedSince = null
        sync.resetTrack(null)
        palette = ColorEngine.NEUTRAL_PALETTE
        emit()
    }

    fun onFullscreen(active: Boolean) {
        fullscreen = active
        emit()
    }

    fun toggleHidden() = setHidden(!userHidden)

    fun setHidden(hidden: Boolean) {
        userHidden = hidden
        emit()
    }

    fun toggleCompact() {
        userCompact = !userCompact
        emit()
    }

    fun adjustOffset(deltaMs: Long) = setOffset(userOffset + deltaMs)

    fun resetOffset() = setOffset(0)

    private fun setOffset(ms: Long) {
        userOffset = ms
        sync.userOffsetMs = ms
        flashUntil = clock.now() + OFFSET_FLASH_MS
        track?.let { saveUserOffset(it, ms) }
        emit()
        scheduler.setTimeout(OFFSET_FLASH_MS + 10) { emit() }
    }

    private fun lyricsStatus(): LyricsStatus? = when {
        loading -> LyricsStatus.LOADING
        else -> when (lyrics?.kind) {
            LyricsKind.SYNCED -> LyricsStatus.SYNCED
            LyricsKind.PLAIN -> LyricsStatus.PLAIN
            LyricsKind.INSTRUMENTAL -> LyricsStatus.INSTRUMENTAL
            LyricsKind.NONE -> LyricsStatus.NONE
            null -> null
        }
    }

    private fun decision(now: Long = clock.now()): Decision {
        val t = track
        return IslandStateMachine.decide(
            MachineFacts(
                track = t,
                status = if (t != null) status else PlaybackStatus.STOPPED,
                lyrics = lyricsStatus(),
                fullscreen = fullscreen,
                userHidden = userHidden,
                userCompact = userCompact,
                pausedSinceMs = pausedSince,
                isAd = t != null && TrackMatcher.looksLikeAd(t),
                now = now,
            ),
            behavior,
        )
    }

    fun snapshot(now: Long = clock.now()): IslandSnapshot {
        val d = decision(now)
        val timed = IslandStateMachine.hasTimedLines(lyricsStatus(), behavior) && lines.isNotEmpty()
        val f = if (timed) sync.frame(now) else null
        return IslandSnapshot(
            mode = d.mode,
            showTitle = d.showTitle,
            track = track,
            lyrics = lyrics?.copy(lines = lines),
            activeLineIndex = f?.activeLineIndex ?: -1,
            lineProgress = f?.lineProgress ?: 0.0,
            wordIndex = f?.wordIndex ?: -1,
            wordProgress = f?.wordProgress ?: 0.0,
            interlude = f?.interlude,
            positionMs = f?.positionMs ?: sync.position(now),
            palette = palette,
            lyricsLoading = loading,
            userOffsetMs = userOffset,
            offsetFlash = if (now < flashUntil) formatOffset(userOffset) else null,
            status = if (track != null) status else PlaybackStatus.STOPPED,
            estimatedLines = timed && lyrics?.kind == LyricsKind.PLAIN,
        )
    }

    /** ¿Hace falta animar por frame? Solo reproduciendo y visible. */
    fun needsAnimation(now: Long = clock.now()): Boolean {
        val m = decision(now).mode
        return status == PlaybackStatus.PLAYING && (m == IslandMode.EXPANDED || m == IslandMode.COMPACT)
    }

    fun dispose() {
        debounce?.let(scheduler::clearTimeout)
        recheck?.let(scheduler::clearTimeout)
        listeners.clear()
    }
}
