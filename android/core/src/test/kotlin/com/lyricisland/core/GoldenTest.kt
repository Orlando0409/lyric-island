package com.lyricisland.core

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import java.io.File
import java.net.URLDecoder
import java.security.MessageDigest
import kotlin.math.abs
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Paridad TS ↔ Kotlin (sección 13.2): mismos fixtures y mismos golden files que desktop/tests/unit/golden.test.ts.
 */
class GoldenTest {
    private val fixtures = File(System.getProperty("fixtures.dir") ?: "../../shared/fixtures")
    private val expected = File(fixtures, "expected")
    private val json = Json

    private fun read(f: File): JsonElement = json.parseToJsonElement(f.readText())
    private fun r4(x: Double) = Math.floor(x * 10000 + 0.5) / 10000

    private fun probes(lines: List<LyricLine>): List<Long> {
        val set = sortedSetOf(0L)
        for (l in lines) {
            set.add(maxOf(0, l.startMs - 1))
            set.add(l.startMs)
            set.add(l.startMs + (l.endMs - l.startMs) / 2)
        }
        if (lines.isNotEmpty()) set.add(lines.last().endMs + 1000)
        return set.toList()
    }

    @TestFactory
    fun lrc(): List<DynamicTest> {
        val files = File(fixtures, "lrc").listFiles { f -> f.name.endsWith(".lrc") }!!.sortedBy { it.name }
        assertTrue(files.size >= 40)
        return files.map { f ->
            DynamicTest.dynamicTest(f.name) {
                val p = LrcParser.parse(f.readText(), if (f.name == "last-line-short.lrc") 3500 else null)
                val exp = read(File(expected, "lrc/${f.nameWithoutExtension}.json")).jsonObject
                assertEquals(exp["offsetMs"]!!.jsonPrimitive.long, p.offsetMs, "offset")
                val meta = exp["meta"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
                assertEquals(meta, p.meta, "meta")
                val expLines = exp["lines"]!!.jsonArray
                assertEquals(expLines.size, p.lines.size, "líneas")
                expLines.forEachIndexed { i, el ->
                    val e = el.jsonObject
                    val l = p.lines[i]
                    assertEquals(e["startMs"]!!.jsonPrimitive.long, l.startMs, "start $i")
                    assertEquals(e["endMs"]!!.jsonPrimitive.long, l.endMs, "end $i")
                    assertEquals(e["text"]!!.jsonPrimitive.content, l.text, "text $i")
                    assertEquals(e["isInterlude"]!!.jsonPrimitive.boolean, l.isInterlude)
                    val ew = e["words"]!!.jsonArray.map { w ->
                        val a = w.jsonArray
                        LyricWord(a[0].jsonPrimitive.content, a[1].jsonPrimitive.long, a[2].jsonPrimitive.long, a[3].jsonPrimitive.boolean)
                    }
                    assertEquals(ew, l.words, "palabras de la línea $i")
                }
                val expProbes = exp["probes"]!!.jsonArray
                val ps = probes(p.lines)
                assertEquals(expProbes.size, ps.size, "sondas")
                expProbes.forEachIndexed { i, el ->
                    val e = el.jsonObject
                    val pos = ps[i]
                    assertEquals(e["pos"]!!.jsonPrimitive.long, pos)
                    val fr = Sync.computeFrame(p.lines, pos.toDouble())
                    assertEquals(e["line"]!!.jsonPrimitive.int, fr.activeLineIndex, "línea en $pos")
                    assertEquals(e["lineProgress"]!!.jsonPrimitive.double, r4(fr.lineProgress), "progreso en $pos")
                    assertEquals(e["word"]!!.jsonPrimitive.int, fr.wordIndex, "palabra en $pos")
                    assertEquals(e["wordProgress"]!!.jsonPrimitive.double, r4(fr.wordProgress), "progreso de palabra en $pos")
                    val ei = e["interlude"]
                    if (ei == null || ei is JsonNull) assertEquals(null, fr.interlude)
                    else {
                        assertEquals(ei.jsonObject["progress"]!!.jsonPrimitive.double, r4(fr.interlude!!.progress))
                        assertEquals(ei.jsonObject["beforeFirst"]!!.jsonPrimitive.boolean, fr.interlude!!.beforeFirst)
                    }
                }
            }
        }
    }

    @Test
    fun matcher() {
        val titles = read(File(fixtures, "matcher/titles.json")).jsonArray
        val exp = read(File(expected, "matcher.json")).jsonObject
        val keys = exp["keys"]!!.jsonArray
        titles.forEachIndexed { i, el ->
            val t = el.jsonObject
            val track = QueryTrack(t["title"]!!.jsonPrimitive.content, t["artist"]!!.jsonPrimitive.content, null, 180_000L + i * 1000)
            val q = TrackMatcher.normalizeQuery(track)
            val e = keys[i].jsonObject
            assertEquals(t["expectTitle"]!!.jsonPrimitive.content, q.title, "título #$i")
            assertEquals(t["expectArtist"]!!.jsonPrimitive.content, q.artist, "artista #$i")
            assertEquals(e["cacheKeySource"]!!.jsonPrimitive.content, TrackMatcher.cacheKeySource(track), "clave #$i")
        }
        val scores = exp["scores"]!!.jsonArray
        var n = 0
        for (f in File(fixtures, "lrclib-responses").listFiles { f -> f.name.startsWith("search-") }!!.sortedBy { it.name }) {
            val fx = read(f).jsonObject
            val query = SearchQuery(fx["match"]!!.jsonObject["track_name"]!!.jsonPrimitive.content, "Los Fixtures")
            for (c in fx["body"]!!.jsonArray.mapNotNull { LyricsRepository.toCandidate(it) }) {
                val e = scores[n++].jsonObject
                assertEquals(e["id"]!!.jsonPrimitive.long, c.id)
                assertEquals(e["score"]!!.jsonPrimitive.double, r4(TrackMatcher.scoreCandidate(query, 205_000, c)), 1e-4, "${f.name} #${c.id}")
            }
        }
        assertEquals(scores.size, n)
    }

    private fun channelDiff(a: String, b: String): Int {
        val x = ColorEngine.hexToRgb(a)
        val y = ColorEngine.hexToRgb(b)
        return (0..2).maxOf { abs(x[it] - y[it]) }
    }

    @Test
    fun palettes() {
        val items = read(File(expected, "palettes.json")).jsonArray
        assertEquals(200, items.size)
        for (el in items) {
            val o = el.jsonObject
            val sw = o["swatches"]!!.jsonObject.entries.associate { (k, v) ->
                SwatchName.valueOf(k) to Swatch(v.jsonObject["hex"]!!.jsonPrimitive.content, v.jsonObject["population"]!!.jsonPrimitive.double.toInt())
            }
            val p = ColorEngine.buildPalette(sw)
            val e = o["palette"]!!.jsonObject
            val name = o["file"]!!.jsonPrimitive.content
            // Tolerancia de ±1 por canal (Math.cbrt/pow pueden diferir en 1 ulp entre V8 y la JVM).
            for ((k, v) in listOf("background" to p.background, "backgroundAlt" to p.backgroundAlt, "accent" to p.accent)) {
                assertTrue(channelDiff(e[k]!!.jsonPrimitive.content, v) <= 1, "$name $k: ${e[k]} vs $v")
            }
            assertTrue(ColorEngine.contrastRatio(p.textPrimary, p.background) >= 4.5, "$name contraste")
            assertTrue(ColorEngine.contrastRatio(p.textPrimary, p.backgroundAlt) >= 4.5, "$name contraste alt")
        }
    }

    // ---------- sesiones grabadas → estados de la isla (mismo algoritmo que replaySession en TS) ----------

    private fun fixtureHttp(): HttpGet {
        val responses = File(fixtures, "lrclib-responses").listFiles()!!.sortedBy { it.name }.map { read(it).jsonObject }
        return HttpGet { url, _ ->
            val path = url.substringAfter("/api").substringBefore('?')
            val params = url.substringAfter('?', "").split('&').filter { it.isNotEmpty() }.associate {
                val (k, v) = it.split('=', limit = 2)
                k to URLDecoder.decode(v, Charsets.UTF_8)
            }.toMutableMap()
            val route = when {
                path == "/get" -> "get"
                path == "/search" -> "search"
                path.startsWith("/get/") -> "get-id".also { params["id"] = path.removePrefix("/get/") }
                else -> return@HttpGet HttpResponse(404, "{}")
            }
            val hit = responses.firstOrNull { r ->
                r["route"]!!.jsonPrimitive.content == route && r["match"]!!.jsonObject.all { (k, v) -> params[k] == v.jsonPrimitive.content }
            }
            when {
                hit == null -> if (route == "search") HttpResponse(200, "[]") else HttpResponse(404, "{\"code\":404}")
                else -> HttpResponse(hit["status"]!!.jsonPrimitive.int, hit["rawBody"]?.jsonPrimitive?.content ?: hit["body"].toString())
            }
        }
    }

    private class FakeScheduler(val now: () -> Long) : Scheduler {
        data class T(val at: Long, val fn: () -> Unit, val id: Int)
        val timers = ArrayList<T>()
        private var next = 1
        override fun setTimeout(ms: Long, fn: () -> Unit): Any = T(now() + ms, fn, next++).also { timers.add(it) }.id
        override fun clearTimeout(handle: Any) {
            timers.removeAll { it.id == handle }
        }
    }

    private fun sha1(s: String) = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    @TestFactory
    fun sessions(): List<DynamicTest> {
        val files = File(fixtures, "sessions").listFiles { f -> f.name.endsWith(".ndjson") }!!.sortedBy { it.name }
        assertTrue(files.size >= 10)
        return files.map { f ->
            DynamicTest.dynamicTest(f.name) {
                val events = f.readLines().filter { it.isNotBlank() }.map { json.parseToJsonElement(it).jsonObject }
                val t0 = 1761340000000L
                var now = t0
                val scheduler = FakeScheduler { now }
                val repo = LyricsRepository(fixtureHttp(), MemoryLyricsCache(), ::sha1, { now }, sleep = {})
                val c = IslandController(
                    clock = { now },
                    scheduler = scheduler,
                    launch = { block -> runBlocking { block() } },
                    fetchLyrics = { t -> repo.get(QueryTrack(t.title, t.artist, t.album, t.durationMs)) },
                )
                val end = events.maxOf { it["at"]!!.jsonPrimitive.long } + 20_000
                val samples = ArrayList<JsonObject>()
                val exp = read(File(expected, "sessions/${f.nameWithoutExtension}.json")).jsonArray
                var ei = 0
                var t = 0L
                while (t <= end) {
                    now = t0 + t
                    while (ei < events.size && events[ei]["at"]!!.jsonPrimitive.long <= t) {
                        val m = events[ei++]["msg"]!!.jsonObject
                        when (m["type"]!!.jsonPrimitive.content) {
                            "track" -> c.onTrack(
                                NowPlaying(
                                    m["sourceAppId"]!!.jsonPrimitive.content,
                                    m["title"]!!.jsonPrimitive.content,
                                    m["artist"]!!.jsonPrimitive.content,
                                    (m["album"] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content,
                                    m["durationMs"]?.jsonPrimitive?.longOrNull,
                                    null,
                                ),
                            )
                            "timeline" -> c.onTimeline(
                                Timeline(
                                    m["positionMs"]!!.jsonPrimitive.long,
                                    m["updatedAtMs"]!!.jsonPrimitive.long,
                                    m["rate"]!!.jsonPrimitive.double.toFloat(),
                                    PlaybackStatus.fromWire(m["status"]!!.jsonPrimitive.content),
                                ),
                            )
                            "cleared" -> c.onCleared()
                            "fullscreen" -> c.onFullscreen(m["active"]!!.jsonPrimitive.boolean)
                        }
                    }
                    while (true) {
                        val due = scheduler.timers.filter { it.at <= now }.minByOrNull { it.at } ?: break
                        scheduler.timers.remove(due)
                        due.fn()
                    }
                    if (t % 1000 == 0L) {
                        val s = c.snapshot()
                        val e = exp[samples.size].jsonObject
                        val label = "${f.name} t=$t"
                        assertEquals(e["mode"]!!.jsonPrimitive.content, s.mode.wire, label)
                        assertEquals((e["title"] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content, s.track?.title, label)
                        assertEquals((e["kind"] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content, s.lyrics?.kind?.wire, label)
                        assertEquals(e["line"]!!.jsonPrimitive.int, s.activeLineIndex, label)
                        assertEquals(e["word"]!!.jsonPrimitive.int, s.wordIndex, label)
                        assertEquals(e["pos"]!!.jsonPrimitive.long, jsRound(s.positionMs), label)
                        samples.add(e)
                    }
                    t += 250
                }
                assertEquals(exp.size, samples.size)
                c.dispose()
            }
        }
    }

    @Suppress("unused")
    private fun JsonArray.texts() = map { it.jsonPrimitive.content }
}
