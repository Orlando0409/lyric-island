package com.lyricisland.core

import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CoreUnitTest {
    private val track = NowPlaying("com.spotify.music", "Isla de Luz", "Los Fixtures", "Pruebas", 60_000, null)
    private val synced = LrcParser.buildDocument("[00:01.00]Uno dos tres\n[00:05.00]Cuatro cinco\n[00:09.00]Seis", "x", false, 60_000, LyricsSource.LRCLIB, 1)

    private class Time {
        var t = 1_000_000L
        data class T(val at: Long, val fn: () -> Unit, val id: Int)
        val timers = ArrayList<T>()
        var next = 1
        val scheduler = object : Scheduler {
            override fun setTimeout(ms: Long, fn: () -> Unit): Any = T(t + ms, fn, next++).also { timers.add(it) }.id
            override fun clearTimeout(handle: Any) {
                timers.removeAll { it.id == handle }
            }
        }
        fun advance(ms: Long) {
            val end = t + ms
            while (true) {
                val due = timers.filter { it.at <= end }.minByOrNull { it.at } ?: break
                timers.remove(due)
                t = due.at
                due.fn()
            }
            t = end
        }
    }

    private fun controller(time: Time, fetch: suspend (NowPlaying) -> LyricsDocument = { synced }) = IslandController(
        clock = { time.t },
        scheduler = time.scheduler,
        launch = { b -> runBlocking { b() } },
        fetchLyrics = fetch,
    )

    @Test
    fun flujoCompletoYPausa() {
        val time = Time()
        val c = controller(time)
        assertEquals(IslandMode.HIDDEN, c.snapshot().mode)
        c.onTrack(track)
        c.onTimeline(Timeline(0, time.t, 1f, PlaybackStatus.PLAYING))
        assertEquals(IslandMode.COMPACT, c.snapshot().mode)
        time.advance(IslandController.TRACK_DEBOUNCE_MS)
        assertEquals(IslandMode.EXPANDED, c.snapshot().mode)
        time.advance(1600)
        assertEquals(0, c.snapshot().activeLineIndex)
        c.onTimeline(Timeline(1600, time.t, 0f, PlaybackStatus.PAUSED))
        assertEquals(IslandMode.PAUSED, c.snapshot().mode)
        time.advance(10_000)
        assertEquals(IslandMode.COMPACT, c.snapshot().mode)
        c.adjustOffset(200)
        assertEquals("+200 ms", c.snapshot().offsetFlash)
        c.onCleared()
        assertEquals(IslandMode.HIDDEN, c.snapshot().mode)
    }

    @Test
    fun errorDeRedReintentaUnaVez() {
        val time = Time()
        var calls = 0
        val c = controller(time) { calls++; if (calls == 1) throw TransientLyricsError("timeout") else synced }
        c.onTrack(track)
        c.onTimeline(Timeline(0, time.t, 1f, PlaybackStatus.PLAYING))
        time.advance(IslandController.TRACK_DEBOUNCE_MS)
        assertEquals(IslandMode.COMPACT, c.snapshot().mode)
        time.advance(IslandController.LYRICS_RETRY_MS)
        assertEquals(2, calls)
        assertEquals(IslandMode.EXPANDED, c.snapshot().mode)
    }

    @Test
    fun maquinaDeEstados() {
        val f = MachineFacts(track, PlaybackStatus.PLAYING, LyricsStatus.SYNCED, false, false, false, null, false, 0)
        val b = IslandBehavior()
        assertEquals(IslandMode.EXPANDED, IslandStateMachine.decide(f, b).mode)
        assertEquals(IslandMode.HIDDEN, IslandStateMachine.decide(f.copy(fullscreen = true), b).mode)
        assertEquals(IslandMode.HIDDEN, IslandStateMachine.decide(f, b.copy(playerFilter = PlayerFilter(false, listOf("spotify")))).mode)
        assertEquals(Decision(IslandMode.PAUSED, false, 10_000), IslandStateMachine.decide(f.copy(status = PlaybackStatus.PAUSED, pausedSinceMs = 0), b))
        assertEquals(IslandMode.COMPACT, IslandStateMachine.decide(f.copy(lyrics = LyricsStatus.NONE), b).mode)
        assertEquals(IslandMode.HIDDEN, IslandStateMachine.decide(f.copy(lyrics = LyricsStatus.NONE), b.copy(noLyricsBehavior = NoLyricsBehavior.HIDE)).mode)
        assertEquals(IslandMode.EXPANDED, IslandStateMachine.decide(f.copy(lyrics = LyricsStatus.PLAIN), b.copy(experimentalPlain = true)).mode)
        assertTrue(PlayerFilter(true, emptyList()).allows("x"))
    }

    @Test
    fun matcherSinArtista() {
        val c = Candidate(9, "Faro", "Los Fixtures", "Costa", 205.0, false, "x", "[00:01.00]x")
        val q = SearchQuery("Faro", "")
        assertTrue(TrackMatcher.scoreCandidate(q, 205_000, c) >= TrackMatcher.ACCEPT_THRESHOLD)
        assertEquals(1.0, TrackMatcher.scoreCandidate(q, 205_000, c, "Costa"), 1e-9)
        assertEquals(9L, TrackMatcher.pickBest(q, 205_000, listOf(c), "Costa")?.first?.id)
    }

    @Test
    fun parserNoLanzaConBasura() {
        val s = buildString { for (i in 0 until 4000) append(((i * 7919) % 65536).toChar()) }
        assertEquals(emptyList(), LrcParser.parse(s).lines)
        assertEquals(LyricsKind.NONE, LrcParser.buildDocument(null, " ", false, null, LyricsSource.LRCLIB, null).kind)
    }

    @Test
    fun karaokeYTokens() {
        assertEquals(listOf("夜", "空", "に"), Words.tokenize("夜空に"))
        assertEquals(listOf("밤하늘 ", "섬"), Words.tokenize("밤하늘 섬"))
        assertEquals(990, Words.simulateWords("Hola mundo", 0, 12_000).last().endMs)
        assertEquals(5.5, Words.wordWeight("hola,"))
    }

    @Test
    fun karaokeJaponesYCoreanoPorSilaba() {
        // Regresión: con 110 ms por carácter el relleno CJK terminaba al ~40 % de la línea.
        val ja = Words.simulateWords("その一言で全てが分かった", 0, 4000)
        assertEquals(12, ja.size)
        assertEquals(3120L, ja.last().endMs)
        assertEquals(2320L, Words.simulateWords("밤하늘 위의 작은 섬", 0, 4000).last().endMs)
        val (en, ko) = Words.simulateWords("World 거듭해서", 0, 10_000)
        assertTrue(ko.endMs - ko.startMs > en.endMs - en.startMs)
        assertEquals(2553L, LrcParser.estimateLastLineMs("その一言で全てが分かった"))
    }

    @Test
    fun sincronia() {
        var now = 0L
        val s = SyncEngine { now }
        s.setLyrics(synced.lines, 0)
        assertEquals(TimelineChange.INIT, s.update(Timeline(0, 0, 1f, PlaybackStatus.PLAYING)))
        now = 10_000
        assertEquals(TimelineChange.DRIFT, s.update(Timeline(10_120, 10_000, 1f, PlaybackStatus.PLAYING)))
        assertEquals(10_000.0, s.position())
        assertEquals(TimelineChange.SEEK, s.update(Timeline(30_000, 10_000, 1f, PlaybackStatus.PLAYING)))
        assertEquals(2, s.frame().activeLineIndex)
        assertEquals(15_000.0, Sync.interpolate(Timeline(0, 0, 1.5f, PlaybackStatus.PLAYING), 10_000))
    }

    @Test
    fun colorYContraste() {
        assertEquals(ColorEngine.NEUTRAL_PALETTE, ColorEngine.buildPalette(null))
        assertEquals(21.0, ColorEngine.contrastRatio("#FFFFFF", "#000000"), 1e-9)
        assertEquals("#FF0000", ColorEngine.oklchToHex(ColorEngine.hexToOklch("#FF0000")))
        assertEquals(0xFFFFFFFF, ColorEngine.toArgb("#FFFFFF"))
        assertEquals(0x73FFFFFF, ColorEngine.toArgb("#FFFFFF73"))
        assertThrows<IllegalArgumentException> { ColorEngine.hexToRgb("rojo") }
    }

    @Test
    fun repositorioErroresTransitorios() = runBlocking {
        var n = 0
        val r = LyricsRepository({ _, _ -> n++; HttpResponse(429, "") }, MemoryLyricsCache(), { it }, { 0 }, sleep = {})
        assertThrows<TransientLyricsError> { runBlocking { r.get(QueryTrack("a", "b", null, null)) } }
        assertEquals(3, n)
        val down = LyricsRepository({ _, _ -> throw java.io.IOException("x") }, MemoryLyricsCache(), { it }, { 0 })
        assertThrows<TransientLyricsError> { runBlocking { down.get(QueryTrack("a", "b", null, null)) } }
        assertNull(LyricsRepository.toCandidate(null))
    }
}
