package com.lyricisland.core

import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.net.URLEncoder

// LyricsRepository (8.1, 8.2, 8.4). Puerto de lyricsRepo.ts: red, caché y hash inyectados.

data class HttpResponse(val status: Int, val body: String)

/** Debe lanzar si se agota el tiempo o falla la red. */
fun interface HttpGet {
    suspend fun get(url: String, timeoutMs: Long): HttpResponse
}

data class CacheEntry(val hit: Boolean, val storedAt: Long, val record: Candidate?)

interface LyricsCache {
    suspend fun get(key: String): CacheEntry?
    suspend fun set(key: String, entry: CacheEntry)
}

class TransientLyricsError(message: String) : Exception(message)

class LyricsRepository(
    private val http: HttpGet,
    private val cache: LyricsCache,
    private val hash: (String) -> String,
    private val now: () -> Long,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val baseUrl: String = LRCLIB_BASE,
) {
    companion object {
        const val LRCLIB_BASE = "https://lrclib.net/api"
        const val REQUEST_TIMEOUT_MS = 5000L
        const val POSITIVE_TTL_MS = 30L * 24 * 3600 * 1000
        const val NEGATIVE_TTL_MS = 24L * 3600 * 1000
        val RATE_LIMIT_BACKOFF_MS = listOf(1000L, 2000L)
        private val json = Json { ignoreUnknownKeys = true }

        private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        private fun JsonObject.num(k: String): Double? = (this[k] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull

        /** Valida una respuesta de LRCLIB sin confiar en su forma. */
        fun toCandidate(raw: JsonElement?): Candidate? {
            val o = raw as? JsonObject ?: return null
            val id = (o["id"] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull ?: return null
            val trackName = o.str("trackName") ?: o.str("name") ?: return null
            return Candidate(
                id = id,
                trackName = trackName,
                artistName = o.str("artistName") ?: "",
                albumName = o.str("albumName"),
                duration = o.num("duration"),
                instrumental = (o["instrumental"] as? JsonPrimitive)?.booleanOrNull == true,
                plainLyrics = o.str("plainLyrics"),
                syncedLyrics = o.str("syncedLyrics"),
            )
        }

        fun documentFromCandidate(c: Candidate, durationMs: Long?, source: LyricsSource): LyricsDocument =
            LrcParser.buildDocument(
                synced = c.syncedLyrics,
                plain = c.plainLyrics,
                instrumental = c.instrumental,
                durationMs = durationMs ?: c.duration?.let { jsRound(it * 1000) },
                source = source,
                lrclibId = c.id,
            )

        val NONE = LyricsDocument(LyricsKind.NONE, emptyList(), null, 0, LyricsSource.LRCLIB, null)
    }

    fun cacheKey(track: QueryTrack): String = hash(TrackMatcher.cacheKeySource(track))

    private fun encode(s: String) = URLEncoder.encode(s, Charsets.UTF_8).replace("+", "%20")

    private suspend fun request(path: String, params: List<Pair<String, Any?>>): JsonElement? {
        val qs = params.filter { (_, v) -> v != null && v != "" }.joinToString("&") { (k, v) -> "$k=${encode(v.toString())}" }
        val url = "$baseUrl$path${if (qs.isNotEmpty()) "?$qs" else ""}"
        var attempt = 0
        while (true) {
            val res = try {
                http.get(url, REQUEST_TIMEOUT_MS)
            } catch (e: Exception) {
                throw TransientLyricsError("red: $e")
            }
            when {
                res.status == 404 -> return null
                // 429 (rate limit) y 503 (sobrecarga momentánea, medido en el spike S0.5): reintento con backoff.
                res.status == 429 || res.status == 503 -> {
                    if (attempt < RATE_LIMIT_BACKOFF_MS.size) {
                        sleep(RATE_LIMIT_BACKOFF_MS[attempt++])
                        continue
                    }
                    throw TransientLyricsError("${res.status} persistente")
                }
                res.status >= 500 -> throw TransientLyricsError("HTTP ${res.status}")
                res.status != 200 -> return null
            }
            return try {
                json.parseToJsonElement(res.body)
            } catch (_: Exception) {
                null // JSON malformado: se trata como "no encontrada"
            }
        }
    }

    suspend fun getById(id: Long, durationMs: Long?): LyricsDocument =
        toCandidate(request("/get/$id", emptyList()))?.let { documentFromCandidate(it, durationMs, LyricsSource.LRCLIB) } ?: NONE

    suspend fun search(track: QueryTrack): List<Candidate> {
        val q = TrackMatcher.normalizeQuery(track)
        val data = request("/search", listOf("track_name" to q.title, "artist_name" to q.artist))
        return (data as? JsonArray)?.mapNotNull(::toCandidate) ?: emptyList()
    }

    /** Estrategia de 8.2: get exacto → get normalizado → search puntuado → caché negativa. */
    suspend fun get(track: QueryTrack): LyricsDocument {
        val key = cacheKey(track)
        val now = now()
        cache.get(key)?.let { cached ->
            val age = now - cached.storedAt
            if (cached.hit && cached.record != null && age < POSITIVE_TTL_MS) {
                return documentFromCandidate(cached.record, track.durationMs, LyricsSource.CACHE)
            }
            if (!cached.hit && age < NEGATIVE_TTL_MS) return NONE.copy(source = LyricsSource.CACHE)
        }

        val durationS = track.durationMs?.let { jsRound(it / 1000.0) }
        val q = TrackMatcher.normalizeQuery(track)
        val attempts = mutableListOf(SearchQuery(track.title.jsTrim(), track.artist.jsTrim()))
        if (q.artist != attempts[0].artist || q.title != attempts[0].title) attempts.add(q)

        var found: Candidate? = null
        for (a in attempts) {
            if (a.title.isEmpty()) continue
            found = toCandidate(
                request(
                    "/get",
                    listOf("artist_name" to a.artist, "track_name" to a.title, "album_name" to track.album, "duration" to durationS),
                ),
            )
            if (found != null) break
        }
        if (found == null && q.title.isNotEmpty()) {
            found = TrackMatcher.pickBest(q, track.durationMs, search(track), track.album)?.first
        }
        if (found == null) {
            cache.set(key, CacheEntry(false, now, null))
            return NONE
        }
        cache.set(key, CacheEntry(true, now, found))
        return documentFromCandidate(found, track.durationMs, LyricsSource.LRCLIB)
    }
}

/** Caché en memoria (tests y respaldo). La app usa Room. */
class MemoryLyricsCache : LyricsCache {
    private val map = LinkedHashMap<String, CacheEntry>(16, 0.75f, true)
    override suspend fun get(key: String) = map[key]
    override suspend fun set(key: String, entry: CacheEntry) {
        map[key] = entry
    }
    val size get() = map.size
}
