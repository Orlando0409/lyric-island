package com.lyricisland.core

import java.text.BreakIterator

// Segmentación y karaoke simulado. Puerto de words.ts.

object Words {
    private val PUNCT_PAUSE = setOf(",", ".", "，", "。")

    fun isCjkCodePoint(cp: Int): Boolean =
        cp in 0x3000..0x303f || cp in 0x3040..0x30ff || cp in 0x3400..0x4dbf || cp in 0x4e00..0x9fff ||
            cp in 0xf900..0xfaff || cp in 0xff00..0xffef || cp in 0x20000..0x2ffff

    /** Grafemas (BreakIterator de carácter; en JDK 20+ y en Android/ICU sigue UAX #29). */
    fun graphemes(text: String): List<String> {
        val it = BreakIterator.getCharacterInstance()
        it.setText(text)
        val out = ArrayList<String>()
        var start = it.first()
        var end = it.next()
        while (end != BreakIterator.DONE) {
            out.add(text.substring(start, end))
            start = end
            end = it.next()
        }
        return out
    }

    private fun isSpace(g: String) = g.isNotEmpty() && g.all(::isJsSpace)

    fun tokenize(text: String): List<String> {
        val tokens = ArrayList<String>()
        var cur = ""
        for (g in graphemes(text)) {
            when {
                isSpace(g) -> if (cur.isNotEmpty()) cur += g else if (tokens.isNotEmpty()) tokens[tokens.size - 1] += g
                isCjkCodePoint(g.codePointAt(0)) -> {
                    if (cur.isNotEmpty()) tokens.add(cur)
                    tokens.add(g)
                    cur = ""
                }
                cur.isNotEmpty() && isJsSpace(cur.last()) -> {
                    tokens.add(cur)
                    cur = g
                }
                else -> cur += g
            }
        }
        if (cur.isNotEmpty()) tokens.add(cur)
        return tokens
    }

    private fun isLetterOrNumber(cp: Int): Boolean = when (Character.getType(cp).toByte()) {
        Character.UPPERCASE_LETTER, Character.LOWERCASE_LETTER, Character.TITLECASE_LETTER, Character.MODIFIER_LETTER,
        Character.OTHER_LETTER, Character.DECIMAL_DIGIT_NUMBER, Character.LETTER_NUMBER, Character.OTHER_NUMBER -> true
        else -> false
    }

    // Duración de canto por unidad, medida sobre 2 031 líneas reales de LRCLIB (mediana):
    // letra latina 116 ms, carácter japonés/chino 262 ms, sílaba hangul 293 ms (ver words.ts).
    const val UNIT_MS_LATIN = 110
    const val UNIT_MS_CJK = 260
    const val UNIT_MS_HANGUL = 290

    /** Kana y Han (cada carácter ≈ una sílaba). Sin la puntuación CJK ni los caracteres de ancho completo. */
    fun isKanaOrHan(cp: Int): Boolean =
        cp in 0x3040..0x30ff || cp in 0x3400..0x4dbf || cp in 0x4e00..0x9fff || cp in 0xf900..0xfaff || cp in 0x20000..0x2ffff

    fun isHangul(cp: Int): Boolean = cp in 0xac00..0xd7af || cp in 0x1100..0x11ff || cp in 0x3130..0x318f

    private fun unitMs(cp: Int): Int = when {
        isHangul(cp) -> UNIT_MS_HANGUL
        isKanaOrHan(cp) -> UNIT_MS_CJK
        else -> UNIT_MS_LATIN
    }

    private fun isSpaceCodePoint(cp: Int) = Character.charCount(cp) == 1 && isJsSpace(cp.toChar())

    /** Tiempo de canto estimado de un texto (ms): cada carácter no blanco según su escritura. */
    fun singEstimateMs(text: String): Int {
        var ms = 0
        text.codePoints().forEach { cp -> if (!isSpaceCodePoint(cp)) ms += unitMs(cp) }
        return ms
    }

    /** Peso de una palabra = sus letras/dígitos en "letras latinas equivalentes" (+ pausa si termina en coma o punto). */
    fun wordWeight(word: String): Double {
        val trimmed = word.jsTrimEnd()
        val last = if (trimmed.isEmpty()) "" else trimmed.substring(trimmed.length - 1)
        var units = 0.0
        trimmed.codePoints().forEach { cp -> if (isLetterOrNumber(cp)) units += unitMs(cp).toDouble() / UNIT_MS_LATIN }
        return maxOf(2.0, units) + if (last in PUNCT_PAUSE) 1.5 else 0.0
    }

    // Ritmo de cada canción. Medido sobre 34 532 versos de 873 canciones de LRCLIB: la duración real de un verso
    // varía mucho con la canción (cuartiles 0.86×–1.56× de lo estimado) y casi nada con las comas. Estimar el ritmo
    // con los propios versos de la canción bajó el error al predecir la duración de un verso de 946 a 571 ms (mediana).
    /** Mediana de duración real / canto estimado en ese corpus: un ritmo 1 deja el relleno como antes. */
    const val TEMPO_REF = 1.14
    const val TEMPO_MIN = 0.75
    const val TEMPO_MAX = 1.6

    /** Con menos versos útiles no se calibra (ritmo 1). */
    const val TEMPO_MIN_LINES = 8

    /**
     * Ritmo propio de la canción (1 = promedio): canciones lentas, con notas largas o pausas (con coma o sin ella)
     * estiran el relleno; las rápidas lo aceleran. Se ignoran versos muy cortos, huecos largos y tiempos rotos.
     * `lines` en orden de tiempo (inicio, texto); cada verso dura hasta el inicio del siguiente.
     */
    fun songTempo(lines: List<Pair<Long, String>>): Double {
        val ratios = ArrayList<Double>()
        for (i in 0 until lines.size - 1) {
            val (start, text) = lines[i]
            if (text.isEmpty()) continue
            val est = singEstimateMs(text).toDouble()
            val dur = (lines[i + 1].first - start).toDouble()
            if (est < 600 || dur < 500 || dur > 15_000) continue
            val r = dur / est
            if (r < 0.6 || r > 3) continue
            ratios.add(r)
        }
        if (ratios.size < TEMPO_MIN_LINES) return 1.0
        ratios.sort()
        return (ratios[ratios.size / 2] / TEMPO_REF).coerceIn(TEMPO_MIN, TEMPO_MAX)
    }

    /** Karaoke simulado: reparte la duración de canto (ajustada al ritmo de la canción) entre las palabras según su peso. */
    fun simulateWords(text: String, t0: Long, t1: Long, tempo: Double = 1.0): List<LyricWord> {
        val tokens = tokenize(text)
        if (tokens.isEmpty()) return emptyList()
        val lineDur = maxOf(0L, t1 - t0).toDouble()
        val singDur = minOf(lineDur, maxOf(800.0, singEstimateMs(text) * tempo))
        val weights = tokens.map(::wordWeight)
        val total = weights.sum()
        var cum = 0.0
        return tokens.mapIndexed { i, tok ->
            val start = t0 + jsRound(cum / total * singDur)
            cum += weights[i]
            val end = t0 + jsRound(cum / total * singDur)
            LyricWord(tok, start, end, true)
        }
    }
}
