package com.lyricisland.core

import org.snakeyaml.engine.v2.api.Load
import org.snakeyaml.engine.v2.api.LoadSettings

// "lyricsfile" de LRCLIB (YAML con tiempos por línea y, si hasWordSync, por palabra). Puerto de lyricsfile.ts.
// Nunca lanza: ante un YAML inválido o sin líneas válidas devuelve null y se usa syncedLyrics.

object Lyricsfile {
    private data class RawWord(val text: String, val startMs: Long)
    private data class RawLine(val text: String, val startMs: Long, val endMs: Long?, val words: List<RawWord>, val order: Int)

    private fun toMs(v: Any?): Long? {
        val d = (v as? Number)?.toDouble() ?: return null
        return if (d.isFinite() && d >= 0) jsRound(d) else null
    }

    /** Equivalente a String(v) de JS para los escalares que puede dar el YAML. */
    private fun toText(v: Any?): String = when (v) {
        is String -> v
        is Boolean -> v.toString()
        is Int, is Long, is java.math.BigInteger -> v.toString()
        is Number -> v.toDouble().let { if (it == Math.floor(it) && !it.isInfinite()) it.toLong().toString() else it.toString() }
        else -> ""
    }

    /** Reparte el texto de la línea entre sus palabras para que concatenarlas reproduzca la línea. */
    fun alignWordTexts(lineText: String, words: List<String>): List<String> {
        var cursor = 0
        val positions = words.map { w ->
            val idx = if (w.isNotEmpty()) lineText.indexOf(w, cursor) else -1
            if (idx >= 0) cursor = idx + w.length
            idx
        }
        return words.mapIndexed { i, w ->
            val idx = positions[i]
            if (idx < 0) return@mapIndexed if (i < words.size - 1) "$w " else w
            val end = (i + 1 until words.size).firstOrNull { positions[it] >= 0 }?.let { positions[it] } ?: lineText.length
            lineText.substring(idx, end)
        }
    }

    fun parse(src: String, durationMs: Long? = null): List<LyricLine>? {
        val doc = try {
            Load(LoadSettings.builder().build()).loadFromString(src)
        } catch (_: Exception) {
            return null
        }
        val lines = (doc as? Map<*, *>)?.get("lines") as? List<*> ?: return null

        val raw = ArrayList<RawLine>()
        lines.forEachIndexed { order, l ->
            val m = l as? Map<*, *> ?: return@forEachIndexed
            val startMs = toMs(m["start_ms"]) ?: return@forEachIndexed
            val words = (m["words"] as? List<*>).orEmpty().mapNotNull { w ->
                val wm = w as? Map<*, *> ?: return@mapNotNull null
                val ws = toMs(wm["start_ms"]) ?: return@mapNotNull null
                val wt = toText(wm["text"]).jsTrim()
                if (wt.isEmpty()) null else RawWord(wt, ws)
            }
            raw.add(RawLine(toText(m["text"]).jsTrim(), startMs, toMs(m["end_ms"]), words, order))
        }
        val sorted = raw.sortedWith(compareBy<RawLine>({ it.startMs }, { it.order }))

        val result = sorted.mapIndexed { i, r ->
            val next = sorted.getOrNull(i + 1)
            var endMs: Long
            if (next != null) endMs = next.startMs
            else {
                endMs = if (r.endMs != null && r.endMs > r.startMs) r.endMs else r.startMs + LrcParser.estimateLastLineMs(r.text)
                if (durationMs != null && durationMs > r.startMs) endMs = minOf(endMs, durationMs)
            }
            val sungEnd = if (r.endMs != null && r.endMs > r.startMs) minOf(r.endMs, endMs) else endMs
            val isInterlude = r.text.isEmpty()
            val words: List<LyricWord> = when {
                isInterlude -> emptyList()
                r.words.isNotEmpty() -> {
                    val ws = r.words.sortedBy { it.startMs }
                    val texts = alignWordTexts(r.text, ws.map { it.text })
                    ws.mapIndexed { j, w ->
                        LyricWord(texts[j], w.startMs, maxOf(w.startMs, ws.getOrNull(j + 1)?.startMs ?: sungEnd), false)
                    }
                }
                else -> Words.simulateWords(r.text, r.startMs, sungEnd)
            }
            LyricLine(i, r.startMs, endMs, r.text, words, isInterlude)
        }
        return result.takeIf { lines2 -> lines2.any { !it.isInterlude } }
    }
}
