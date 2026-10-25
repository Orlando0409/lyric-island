package com.lyricisland.core

import java.text.BreakIterator

// Segmentación y karaoke simulado (sección 8.5.4). Puerto de words.ts.

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

    /** Letras y dígitos (\p{L}\p{N}) por punto de código. */
    fun letterCount(word: String): Int = word.codePoints().filter(::isLetterOrNumber).count().toInt()

    fun nonSpaceCount(text: String): Int =
        text.codePoints().filter { cp -> !(Character.charCount(cp) == 1 && isJsSpace(cp.toChar())) }.count().toInt()

    fun wordWeight(word: String): Double {
        val trimmed = word.jsTrimEnd()
        val last = if (trimmed.isEmpty()) "" else trimmed.substring(trimmed.length - 1)
        return maxOf(2, letterCount(trimmed)).toDouble() + if (last in PUNCT_PAUSE) 1.5 else 0.0
    }

    fun simulateWords(text: String, t0: Long, t1: Long): List<LyricWord> {
        val tokens = tokenize(text)
        if (tokens.isEmpty()) return emptyList()
        val lineDur = maxOf(0L, t1 - t0).toDouble()
        val singDur = minOf(lineDur, maxOf(800.0, nonSpaceCount(text) * 110.0))
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
