package com.lyricisland.core

import java.text.Normalizer
import kotlin.math.abs

// TrackMatcher. Puerto de matcher.ts.

data class QueryTrack(val title: String, val artist: String, val album: String?, val durationMs: Long?)

data class SearchQuery(val title: String, val artist: String)

data class Candidate(
    val id: Long,
    val trackName: String,
    val artistName: String,
    val albumName: String?,
    val duration: Double?, // segundos
    val instrumental: Boolean,
    val plainLyrics: String?,
    val syncedLyrics: String?,
    /** LRCLIB: la versión trae tiempos reales por palabra en `lyricsfile`. */
    val hasWordSync: Boolean = false,
    val lyricsfile: String? = null,
)

object TrackMatcher {
    private const val S = JS_SPACE
    private val I = setOf(RegexOption.IGNORE_CASE)

    /** No se quitan "Live", "Acoustic" ni "Remix": cambian la letra o los tiempos. */
    val TITLE_NOISE_PATTERNS = listOf(
        Regex("""[$S]*-[$S]*(\d{4}[$S]*)?remaster(ed)?([$S]*\d{4})?.*$""", I),
        Regex("""[$S]*[(\[](feat\.?|ft\.?|with)[$S]+[^)\]]+[)\]]""", I),
        Regex("""[$S]*[(\[](explicit|clean|radio edit|single version|album version)[)\]]""", I),
        Regex("""[$S]*-[$S]*(mono|stereo)([$S]+version)?$""", I),
    )
    private val ARTIST_SEPARATORS = Regex("""[$S]*(?:,[$S]|[$S]&[$S]|[$S]x[$S]|[$S]feat\.?[$S]|[$S]ft\.?[$S]|[$S]featuring[$S])""", I)
    private val SPACES = Regex("[$S]+")
    private val MARKS = Regex("\\p{M}+")
    private val SINGLE_QUOTES = Regex("[‘’‚‛′`´]")
    private val DOUBLE_QUOTES = Regex("[“”„‟″]")
    private val DASHES = Regex("[‐-―−]")
    private val NON_TOKEN = Regex("[^\\p{L}\\p{N}$S']")
    private val TOPIC = Regex(" - Topic$", RegexOption.IGNORE_CASE)
    const val ACCEPT_THRESHOLD = 0.75

    fun collapseSpaces(s: String): String = s.replace(SPACES, " ").jsTrim()

    fun normalizeForCompare(s: String): String = collapseSpaces(
        Normalizer.normalize(s, Normalizer.Form.NFD)
            .replace(MARKS, "")
            .lowercase()
            .replace(SINGLE_QUOTES, "'")
            .replace(DOUBLE_QUOTES, "\"")
            .replace(DASHES, "-"),
    )

    fun cleanTitle(title: String): String {
        var t = collapseSpaces(title)
        for (re in TITLE_NOISE_PATTERNS) t = re.replaceFirst(t, "")
        return collapseSpaces(t)
    }

    fun primaryArtist(artist: String): String {
        val a = collapseSpaces(artist)
        return collapseSpaces(a.split(ARTIST_SEPARATORS, limit = 2)[0])
    }

    fun splitYouTubeStyle(title: String, artist: String): SearchQuery {
        var a = collapseSpaces(artist)
        var t = collapseSpaces(title)
        if (TOPIC.containsMatchIn(a)) a = a.replace(TOPIC, "").jsTrim()
        val dash = t.indexOf(" - ")
        if (dash > 0) {
            val before = t.substring(0, dash).jsTrim()
            val after = t.substring(dash + 3).jsTrim()
            if (after.isNotEmpty() && normalizeForCompare(before) == normalizeForCompare(a)) {
                t = after
            } else if (after.isNotEmpty() && a.isEmpty()) {
                a = before
                t = after
            }
        }
        return SearchQuery(t, a)
    }

    fun normalizeQuery(track: QueryTrack): SearchQuery {
        val yt = splitYouTubeStyle(track.title, track.artist)
        return SearchQuery(cleanTitle(yt.title), primaryArtist(yt.artist))
    }

    fun jaroWinkler(a: String, b: String): Double {
        if (a == b) return 1.0
        val la = a.length
        val lb = b.length
        if (la == 0 || lb == 0) return 0.0
        val range = maxOf(0, maxOf(la, lb) / 2 - 1)
        val ma = BooleanArray(la)
        val mb = BooleanArray(lb)
        var matches = 0
        for (i in 0 until la) {
            val lo = maxOf(0, i - range)
            val hi = minOf(lb - 1, i + range)
            for (j in lo..hi) {
                if (!mb[j] && a[i] == b[j]) {
                    ma[i] = true
                    mb[j] = true
                    matches++
                    break
                }
            }
        }
        if (matches == 0) return 0.0
        var k = 0
        var transpositions = 0
        for (i in 0 until la) {
            if (!ma[i]) continue
            while (!mb[k]) k++
            if (a[i] != b[k]) transpositions++
            k++
        }
        val m = matches.toDouble()
        val jaro = (m / la + m / lb + (m - transpositions / 2.0) / m) / 3
        var prefix = 0
        while (prefix < minOf(4, la, lb) && a[prefix] == b[prefix]) prefix++
        return jaro + prefix * 0.1 * (1 - jaro)
    }

    private fun tokens(s: String): List<String> =
        normalizeForCompare(s).replace(NON_TOKEN, " ").split(' ').filter { it.isNotEmpty() }

    fun tokenSetRatio(a: String, b: String): Double {
        val ta = tokens(a).distinct().sorted()
        val tb = tokens(b).distinct().sorted()
        if (ta.isEmpty() && tb.isEmpty()) return 1.0
        if (ta.isEmpty() || tb.isEmpty()) return 0.0
        val setB = tb.toSet()
        val setA = ta.toSet()
        val inter = ta.filter { it in setB }
        val onlyA = ta.filter { it !in setB }
        val onlyB = tb.filter { it !in setA }
        val i = inter.joinToString(" ")
        val s1 = listOf(i, onlyA.joinToString(" ")).filter { it.isNotEmpty() }.joinToString(" ")
        val s2 = listOf(i, onlyB.joinToString(" ")).filter { it.isNotEmpty() }.joinToString(" ")
        if (inter.isNotEmpty() && (onlyA.isEmpty() || onlyB.isEmpty())) return 1.0
        return maxOf(jaroWinkler(i, s1), jaroWinkler(i, s2), jaroWinkler(s1, s2))
    }

    fun textSimilarity(a: String, b: String): Double =
        maxOf(jaroWinkler(normalizeForCompare(a), normalizeForCompare(b)), tokenSetRatio(a, b))

    fun durationSimilarity(aMs: Long?, bMs: Long?): Double {
        if (aMs == null || bMs == null) return 0.5
        val d = abs(aMs - bMs) / 1000.0
        if (d <= 2) return 1.0
        if (d >= 10) return 0.0
        return 1 - (d - 2) / 8
    }

    fun scoreCandidate(query: SearchQuery, durationMs: Long?, c: Candidate, album: String? = null): Double {
        val candDurMs = c.duration?.let { jsRound(it * 1000) }
        val simTitle = maxOf(textSimilarity(query.title, c.trackName), textSimilarity(query.title, cleanTitle(c.trackName)))
        // Spotify desktop (Store) publica en SMTC el artista vacío. Sin artista, ese peso lo toma
        // la similitud de álbum; sin álbum tampoco, un 0.5 neutro.
        val simArtist = when {
            query.artist.jsTrim().isNotEmpty() ->
                maxOf(textSimilarity(query.artist, c.artistName), textSimilarity(query.artist, primaryArtist(c.artistName)))
            !album.isNullOrEmpty() && !c.albumName.isNullOrEmpty() -> textSimilarity(album, c.albumName)
            else -> 0.5
        }
        var score = 0.45 * simTitle + 0.3 * simArtist + 0.2 * durationSimilarity(durationMs, candDurMs) + 0.05 * (if (c.syncedLyrics != null) 1 else 0) + 0.03 * (if (c.hasWordSync) 1 else 0) // se prefieren tiempos por palabra
        if (durationMs != null && candDurMs != null && abs(durationMs - candDurMs) > 15_000) score -= 0.3
        return score
    }

    fun pickBest(query: SearchQuery, durationMs: Long?, candidates: List<Candidate>, album: String? = null): Pair<Candidate, Double>? {
        var best: Pair<Candidate, Double>? = null
        for (c in candidates) {
            val s = scoreCandidate(query, durationMs, c, album)
            if (best == null || s > best.second) best = c to s
        }
        return best?.takeIf { it.second >= ACCEPT_THRESHOLD }
    }

    fun cacheKeySource(track: QueryTrack): String {
        val q = normalizeQuery(track)
        val bucket = track.durationMs?.let { jsRound(it / 2000.0).toString() } ?: "na"
        return "${normalizeForCompare(q.artist)}|${normalizeForCompare(q.title)}|$bucket"
    }

    fun looksLikeAd(track: NowPlaying): Boolean {
        val t = normalizeForCompare(track.title)
        val a = normalizeForCompare(track.artist)
        if (t == "advertisement" || t == "spotify" || a == "spotify" || t == "anuncio") return true
        val isSpotify = track.sourceAppId.contains("spotify", ignoreCase = true)
        val d = track.durationMs
        return isSpotify && track.album.isNullOrEmpty() && d != null && d in 15_000..31_000
    }
}
