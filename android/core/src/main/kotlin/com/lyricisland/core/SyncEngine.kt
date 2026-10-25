package com.lyricisland.core

import kotlin.math.abs

// Motor de sincronización (sección 8.5). Puerto de sync.ts. Las posiciones se calculan en Double (como en JS).

fun interface Clock {
    fun now(): Long
}

object Sync {
    const val SEEK_THRESHOLD_MS = 250.0
    const val SMOOTH_CORRECTION_MS = 300.0
    const val INTERLUDE_MIN_GAP_MS = 5000L
    const val INTRO_MIN_MS = 3000L

    /** Posición cruda interpolada (sin offsets). Un updatedAtMs en el futuro no hace retroceder la posición. */
    fun interpolate(tl: Timeline, nowMs: Long): Double {
        if (tl.status != PlaybackStatus.PLAYING) return tl.positionMs.toDouble()
        return tl.positionMs + maxOf(0L, nowMs - tl.updatedAtMs) * tl.rate.toDouble()
    }

    fun findActiveLine(lines: List<LyricLine>, pos: Double, hint: Int = -1): Int {
        val n = lines.size
        if (n == 0 || pos < lines[0].startMs) return -1
        fun fits(i: Int) = i in 0 until n && lines[i].startMs <= pos && (i + 1 >= n || lines[i + 1].startMs > pos)
        if (fits(hint)) return hint
        if (fits(hint + 1)) return hint + 1
        var lo = 0
        var hi = n - 1
        while (lo < hi) {
            val mid = (lo + hi + 1) ushr 1
            if (lines[mid].startMs <= pos) lo = mid else hi = mid - 1
        }
        return lo
    }

    fun sungEndMs(line: LyricLine): Long = line.words.lastOrNull()?.endMs ?: line.startMs

    fun computeFrame(lines: List<LyricLine>, pos: Double, hint: Int = -1): SyncFrame {
        val i = findActiveLine(lines, pos, hint)
        if (i < 0) {
            val first = lines.firstOrNull()
            val interlude =
                if (first != null && first.startMs > INTRO_MIN_MS) Interlude(clamp(pos / first.startMs, 0.0, 1.0), true) else null
            return SyncFrame(pos, -1, 0.0, -1, 0.0, interlude)
        }
        val line = lines[i]
        val span = (line.endMs - line.startMs).toDouble()
        val lineProgress = if (span > 0) clamp((pos - line.startMs) / span, 0.0, 1.0) else 1.0
        var wordIndex = -1
        var wordProgress = 0.0
        for (w in line.words.indices.reversed()) {
            val word = line.words[w]
            if (word.startMs <= pos) {
                wordIndex = w
                val d = (word.endMs - word.startMs).toDouble()
                wordProgress = if (d > 0) clamp((pos - word.startMs) / d, 0.0, 1.0) else 1.0
                break
            }
        }
        var interlude: Interlude? = null
        val next = lines.getOrNull(i + 1)
        if (next != null) {
            val sungEnd = sungEndMs(line)
            val gap = next.startMs - sungEnd
            if (gap >= INTERLUDE_MIN_GAP_MS && pos >= sungEnd) interlude = Interlude(clamp((pos - sungEnd) / gap, 0.0, 1.0), false)
        }
        return SyncFrame(pos, i, lineProgress, wordIndex, wordProgress, interlude)
    }
}

data class Interlude(val progress: Double, val beforeFirst: Boolean)

data class SyncFrame(
    val positionMs: Double,
    val activeLineIndex: Int,
    val lineProgress: Double,
    val wordIndex: Int,
    val wordProgress: Double,
    val interlude: Interlude?,
)

enum class TimelineChange { INIT, DRIFT, SEEK, STATUS }

/** Sigue la posición y suaviza las correcciones pequeñas (8.5.2). */
class PositionTracker(private val clock: Clock) {
    var timeline: Timeline? = null
        private set
    private var correctionMs = 0.0
    private var correctionAt = 0L

    fun reset() {
        timeline = null
        correctionMs = 0.0
    }

    fun update(tl: Timeline): TimelineChange {
        val now = clock.now()
        val prev = timeline
        timeline = tl
        if (prev == null) {
            correctionMs = 0.0
            return TimelineChange.INIT
        }
        val before = Sync.interpolate(prev, now) + currentCorrection(now)
        val after = Sync.interpolate(tl, now)
        val delta = before - after
        if (abs(delta) > Sync.SEEK_THRESHOLD_MS) {
            correctionMs = 0.0
            return TimelineChange.SEEK
        }
        if (prev.status != tl.status || tl.status != PlaybackStatus.PLAYING) {
            correctionMs = 0.0
            return TimelineChange.STATUS
        }
        correctionMs = delta
        correctionAt = now
        return TimelineChange.DRIFT
    }

    private fun currentCorrection(now: Long): Double {
        if (correctionMs == 0.0) return 0.0
        val t = (now - correctionAt) / Sync.SMOOTH_CORRECTION_MS
        if (t >= 1) return 0.0
        return correctionMs * (1 - maxOf(0.0, t))
    }

    fun rawPosition(now: Long = clock.now()): Double {
        val tl = timeline ?: return 0.0
        return Sync.interpolate(tl, now) + currentCorrection(now)
    }
}

class SyncEngine(private val clock: Clock) {
    val tracker = PositionTracker(clock)
    private var hint = -1
    var lines: List<LyricLine> = emptyList()
        private set
    var lrcOffsetMs = 0L
    var userOffsetMs = 0L
    var durationMs: Long? = null

    fun setLyrics(lines: List<LyricLine>, lrcOffsetMs: Long) {
        this.lines = lines
        this.lrcOffsetMs = lrcOffsetMs
        hint = -1
    }

    fun resetTrack(durationMs: Long?) {
        tracker.reset()
        lines = emptyList()
        lrcOffsetMs = 0
        hint = -1
        this.durationMs = durationMs
    }

    fun update(tl: Timeline): TimelineChange {
        val change = tracker.update(tl)
        if (change == TimelineChange.SEEK) hint = -1
        return change
    }

    fun position(now: Long = clock.now()): Double {
        val pos = tracker.rawPosition(now) + lrcOffsetMs + userOffsetMs
        return clamp(pos, 0.0, durationMs?.toDouble() ?: Double.POSITIVE_INFINITY)
    }

    fun frame(now: Long = clock.now()): SyncFrame {
        val f = Sync.computeFrame(lines, position(now), hint)
        hint = f.activeLineIndex
        return f
    }
}
