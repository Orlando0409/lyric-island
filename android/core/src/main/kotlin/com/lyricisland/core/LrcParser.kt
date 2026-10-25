package com.lyricisland.core

// Parser LRC (sección 8.3). Puerto de lrc.ts. Nunca lanza excepciones.

data class ParsedLrc(
    val lines: List<LyricLine>,
    val offsetMs: Long,
    val meta: Map<String, String>,
    val warnings: List<String>,
)

object LrcParser {
    private val TIME_TAG = Regex("""^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?]""")
    private val META_TAG = Regex("""^\[([a-zA-Z#]+):([^\]]*)][$JS_SPACE]*$""")
    private val WORD_TAG = Regex("""<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>""")
    private val INT_PREFIX = Regex("""^[$JS_SPACE]*([-+]?\d+)""")
    private val KNOWN_META = setOf("ar", "ti", "al", "au", "by", "length", "re", "ve", "offset", "#")

    fun fractionToMs(frac: String?): Long = when {
        frac.isNullOrEmpty() -> 0
        frac.length == 1 -> frac.toLong() * 100
        frac.length == 2 -> frac.toLong() * 10
        else -> frac.toLong()
    }

    private fun tagToMs(min: String, sec: String, frac: String?): Long? {
        val s = sec.toLong()
        if (s >= 60) return null
        return min.toLong() * 60_000 + s * 1000 + fractionToMs(frac)
    }

    fun estimateLastLineMs(text: String): Long = minOf(6000, maxOf(2000, Words.nonSpaceCount(text) * 90L))

    private data class RawWord(val text: String, val startMs: Long)
    private data class RawLine(val startMs: Long, val text: String, val words: List<RawWord>?, val endTag: Long?, val order: Int)
    private data class Enhanced(val text: String, val words: List<RawWord>?, val endTag: Long?)

    private fun parseEnhanced(rest: String, lineStart: Long): Enhanced {
        val matches = WORD_TAG.findAll(rest).toList()
        if (matches.isEmpty()) return Enhanced(rest, null, null)
        val words = ArrayList<RawWord>()
        var endTag: Long? = null
        var lastIndex = 0
        var pendingStart: Long? = null
        fun flush(segment: String, start: Long) {
            if (segment.isNotEmpty()) words.add(RawWord(segment, start))
        }
        for (m in matches) {
            val segment = rest.substring(lastIndex, m.range.first)
            if (pendingStart != null) flush(segment, pendingStart) else if (segment.jsTrim().isNotEmpty()) flush(segment, lineStart)
            val t = tagToMs(m.groupValues[1], m.groupValues[2], m.groups[3]?.value)
            pendingStart = t ?: pendingStart ?: lineStart
            lastIndex = m.range.last + 1
        }
        val tail = rest.substring(lastIndex)
        if (tail.isNotEmpty()) flush(tail, pendingStart ?: lineStart) else endTag = pendingStart
        return Enhanced(words.joinToString("") { it.text }, words.ifEmpty { null }, endTag)
    }

    fun parse(input: String, durationMs: Long? = null): ParsedLrc {
        val meta = LinkedHashMap<String, String>()
        val warnings = ArrayList<String>()
        var offsetMs = 0L
        val lines = try {
            val text = input.removePrefix("﻿").replace("\r\n", "\n").replace('\r', '\n')
            val raw = ArrayList<RawLine>()
            var order = 0
            for (sourceLine in text.split('\n')) {
                var rest = sourceLine.jsTrim()
                if (rest.isEmpty()) continue
                val times = ArrayList<Long>()
                while (true) {
                    val m = TIME_TAG.find(rest) ?: break
                    val t = tagToMs(m.groupValues[1], m.groupValues[2], m.groups[3]?.value)
                    if (t == null) {
                        times.clear()
                        warnings.add("marca inválida: ${sourceLine.take(40)}")
                        rest = ""
                        break
                    }
                    times.add(t)
                    rest = rest.substring(m.value.length).jsTrimStart()
                }
                if (times.isEmpty()) {
                    val m = META_TAG.find(sourceLine.jsTrim())
                    if (m != null) {
                        val key = m.groupValues[1].lowercase()
                        val value = m.groupValues[2].jsTrim()
                        if (key in KNOWN_META) {
                            meta[key] = value
                            if (key == "offset") INT_PREFIX.find(value.removePrefix("+"))?.let { offsetMs = it.groupValues[1].removePrefix("+").toLong() }
                        } else {
                            warnings.add("etiqueta desconocida: [${m.groupValues[1]}:]")
                        }
                    } else if (rest.startsWith("[")) {
                        warnings.add("marca inválida: ${sourceLine.take(40)}")
                    }
                    continue
                }
                val first = times[0]
                val enhanced = parseEnhanced(rest, first)
                for (t in times) {
                    val delta = t - first
                    raw.add(
                        RawLine(
                            startMs = t,
                            text = enhanced.text.jsTrim(),
                            words = enhanced.words?.map { RawWord(it.text, it.startMs + delta) },
                            endTag = enhanced.endTag?.let { it + delta },
                            order = order++,
                        ),
                    )
                }
            }
            val sorted = raw.sortedWith(compareBy<RawLine>({ it.startMs }, { it.order }))
            sorted.mapIndexed { i, r ->
                val next = sorted.getOrNull(i + 1)
                var endMs: Long
                if (next != null) endMs = next.startMs
                else {
                    endMs = r.startMs + estimateLastLineMs(r.text)
                    if (durationMs != null && durationMs > r.startMs) endMs = minOf(endMs, durationMs)
                }
                val isInterlude = r.text.isEmpty()
                val words: List<LyricWord> = when {
                    isInterlude -> emptyList()
                    r.words != null -> {
                        val wordEnd = if (r.endTag != null) minOf(r.endTag, endMs) else endMs
                        r.words.mapIndexed { j, w ->
                            val nextWord = r.words.getOrNull(j + 1)
                            LyricWord(
                                text = if (j == 0) w.text.jsTrimStart() else w.text,
                                startMs = w.startMs,
                                endMs = maxOf(w.startMs, nextWord?.startMs ?: wordEnd),
                                estimated = false,
                            )
                        }
                    }
                    else -> Words.simulateWords(r.text, r.startMs, endMs)
                }
                LyricLine(i, r.startMs, endMs, r.text, words, isInterlude)
            }
        } catch (e: Exception) {
            warnings.add("error de parseo: $e")
            emptyList()
        }
        return ParsedLrc(lines, offsetMs, meta, warnings)
    }

    fun buildDocument(
        synced: String?,
        plain: String?,
        instrumental: Boolean,
        durationMs: Long?,
        source: LyricsSource,
        lrclibId: Long?,
    ): LyricsDocument {
        if (instrumental) return LyricsDocument(LyricsKind.INSTRUMENTAL, emptyList(), null, 0, source, lrclibId)
        if (synced != null && synced.jsTrim().isNotEmpty()) {
            val parsed = parse(synced, durationMs)
            if (parsed.lines.any { !it.isInterlude }) return LyricsDocument(LyricsKind.SYNCED, parsed.lines, plain, parsed.offsetMs, source, lrclibId)
        }
        if (plain != null && plain.jsTrim().isNotEmpty()) return LyricsDocument(LyricsKind.PLAIN, emptyList(), plain, 0, source, lrclibId)
        return LyricsDocument(LyricsKind.NONE, emptyList(), null, 0, source, lrclibId)
    }

    /** Modo experimental de letra plana (8.5.6 B): líneas repartidas entre el 8 % y el 95 %. */
    fun estimatePlainLines(plainText: String, durationMs: Long): List<LyricLine> {
        val texts = plainText.replace("\r\n", "\n").replace('\r', '\n').split('\n').map { it.jsTrim() }.filter { it.isNotEmpty() }
        if (texts.isEmpty() || durationMs <= 0) return emptyList()
        val from = durationMs * 0.08
        val span = durationMs * 0.95 - from
        val step = span / texts.size
        return texts.mapIndexed { i, text ->
            val start = jsRound(from + i * step)
            val end = jsRound(from + (i + 1) * step)
            LyricLine(i, start, end, text, Words.simulateWords(text, start, end), false)
        }
    }
}
