package com.lyricisland.core

// Romaji (Hepburn) para letras en japonés. Puerto 1:1 de romaji.ts: el análisis morfológico (lecturas de los
// kanji) lo hace kuromoji en la app y llega aquí como tokens.

/** Token de un analizador morfológico (kuromoji, diccionario IPADIC). */
data class JaToken(val surface: String, val reading: String?, val pos: String, val posDetail: String)

object Romaji {
    private val MONO = mapOf(
        "あ" to "a", "い" to "i", "う" to "u", "え" to "e", "お" to "o",
        "か" to "ka", "き" to "ki", "く" to "ku", "け" to "ke", "こ" to "ko",
        "が" to "ga", "ぎ" to "gi", "ぐ" to "gu", "げ" to "ge", "ご" to "go",
        "さ" to "sa", "し" to "shi", "す" to "su", "せ" to "se", "そ" to "so",
        "ざ" to "za", "じ" to "ji", "ず" to "zu", "ぜ" to "ze", "ぞ" to "zo",
        "た" to "ta", "ち" to "chi", "つ" to "tsu", "て" to "te", "と" to "to",
        "だ" to "da", "ぢ" to "ji", "づ" to "zu", "で" to "de", "ど" to "do",
        "な" to "na", "に" to "ni", "ぬ" to "nu", "ね" to "ne", "の" to "no",
        "は" to "ha", "ひ" to "hi", "ふ" to "fu", "へ" to "he", "ほ" to "ho",
        "ば" to "ba", "び" to "bi", "ぶ" to "bu", "べ" to "be", "ぼ" to "bo",
        "ぱ" to "pa", "ぴ" to "pi", "ぷ" to "pu", "ぺ" to "pe", "ぽ" to "po",
        "ま" to "ma", "み" to "mi", "む" to "mu", "め" to "me", "も" to "mo",
        "や" to "ya", "ゆ" to "yu", "よ" to "yo",
        "ら" to "ra", "り" to "ri", "る" to "ru", "れ" to "re", "ろ" to "ro",
        "わ" to "wa", "ゐ" to "i", "ゑ" to "e", "を" to "o", "ん" to "n", "ゔ" to "vu",
        "ぁ" to "a", "ぃ" to "i", "ぅ" to "u", "ぇ" to "e", "ぉ" to "o", "ゃ" to "ya", "ゅ" to "yu", "ょ" to "yo", "ゎ" to "wa",
    )

    private val DI = mapOf(
        "きゃ" to "kya", "きゅ" to "kyu", "きょ" to "kyo", "ぎゃ" to "gya", "ぎゅ" to "gyu", "ぎょ" to "gyo",
        "しゃ" to "sha", "しゅ" to "shu", "しょ" to "sho", "じゃ" to "ja", "じゅ" to "ju", "じょ" to "jo",
        "ちゃ" to "cha", "ちゅ" to "chu", "ちょ" to "cho", "ぢゃ" to "ja", "ぢゅ" to "ju", "ぢょ" to "jo",
        "にゃ" to "nya", "にゅ" to "nyu", "にょ" to "nyo", "ひゃ" to "hya", "ひゅ" to "hyu", "ひょ" to "hyo",
        "びゃ" to "bya", "びゅ" to "byu", "びょ" to "byo", "ぴゃ" to "pya", "ぴゅ" to "pyu", "ぴょ" to "pyo",
        "みゃ" to "mya", "みゅ" to "myu", "みょ" to "myo", "りゃ" to "rya", "りゅ" to "ryu", "りょ" to "ryo",
        "しぇ" to "she", "じぇ" to "je", "ちぇ" to "che", "いぇ" to "ye",
        "ふぁ" to "fa", "ふぃ" to "fi", "ふぇ" to "fe", "ふぉ" to "fo", "ふゅ" to "fyu",
        "てぃ" to "ti", "でぃ" to "di", "とぅ" to "tu", "どぅ" to "du", "てゅ" to "tyu", "でゅ" to "dyu",
        "うぃ" to "wi", "うぇ" to "we", "うぉ" to "wo",
        "ゔぁ" to "va", "ゔぃ" to "vi", "ゔぇ" to "ve", "ゔぉ" to "vo",
        "つぁ" to "tsa", "つぃ" to "tsi", "つぇ" to "tse", "つぉ" to "tso",
    )

    private val PUNCT = mapOf(
        "、" to ",", "。" to ".", "！" to "!", "？" to "?", "「" to "\"", "」" to "\"", "『" to "\"", "』" to "\"", "（" to "(", "）" to ")",
        "・" to " ", "　" to " ", "～" to "~", "〜" to "~", "…" to "...", "，" to ",", "．" to ".", "：" to ":", "；" to ";",
    )

    private val PARTICLES = mapOf("は" to "wa", "へ" to "e", "を" to "o")
    private val OPENING = setOf("「", "『", "（", "(")
    private val CLOSING = setOf("」", "』", "）", ")", "、", "。", "！", "？", "!", "?", ",", ".", "…", "～", "〜", "：", "；", "，", "．")
    private const val VOWELS = "aeiou"

    private fun isKana(cp: Int) = cp in 0x3041..0x3096 || cp in 0x30a1..0x30fa || cp == 0x30fc
    private fun isHan(cp: Int) = cp in 0x3400..0x4dbf || cp in 0x4e00..0x9fff || cp in 0xf900..0xfaff || cp == 0x3005

    fun containsKana(text: String): Boolean = text.codePoints().anyMatch(::isKana)
    fun containsJapanese(text: String): Boolean = text.codePoints().anyMatch { isKana(it) || isHan(it) }

    private fun codePointStrings(text: String): List<String> = text.codePoints().toArray().map { String(Character.toChars(it)) }

    private fun toHiragana(text: String): String = buildString {
        text.codePoints().forEach { cp -> appendCodePoint(if (cp in 0x30a1..0x30f6) cp - 0x60 else cp) }
    }

    /** Kana (hiragana o katakana) → romaji Hepburn. Lo que no es kana pasa tal cual (puntuación japonesa → ASCII). */
    fun kanaToRomaji(kana: String): String {
        val chars = codePointStrings(toHiragana(kana))
        val out = StringBuilder()
        var geminate = false
        var i = 0
        while (i < chars.size) {
            val c = chars[i]
            if (c == "っ") {
                geminate = true
                i++
                continue
            }
            if (c == "ー") {
                val last = out.lastOrNull()
                if (last != null && last in VOWELS) out.append(last)
                i++
                continue
            }
            val pair = c + (chars.getOrNull(i + 1) ?: "")
            val syl: String?
            if (DI.containsKey(pair)) {
                syl = DI[pair]
                i++
            } else {
                syl = MONO[c]
            }
            if (syl == null) {
                geminate = false
                out.append(PUNCT[c] ?: c)
                i++
                continue
            }
            if (geminate) {
                out.append(if (syl.startsWith("ch")) "t" else if (syl[0] in VOWELS) "" else syl[0].toString())
                geminate = false
            }
            out.append(syl)
            i++
        }
        return out.toString()
    }

    private fun attachesToPrevious(t: JaToken): Boolean {
        if (t.pos == "助動詞") return true
        if (t.posDetail == "非自立" || t.posDetail == "接尾") return true
        return t.pos == "助詞" && t.posDetail == "接続助詞" && (t.surface == "て" || t.surface == "で" || t.surface == "ば")
    }

    /** `srcEnd`: fin (exclusivo) del grupo en el texto original. */
    private class Group(var kana: String, val japanese: Boolean, val particle: String?, val opening: Boolean, val closing: Boolean, var srcEnd: Int)

    /** `marks`: pares planos [finEnOriginal, finEnRomaji, …], crecientes: qué parte del romaji corresponde a qué parte del original. */
    data class AlignedRomaji(val romaji: String, val marks: List<Int>)

    /** Tokens de una línea → romaji legible, con espacios entre palabras, alineado con el texto original. */
    fun alignRomaji(text: String, tokens: List<JaToken>): AlignedRomaji {
        val groups = ArrayList<Group>()
        var cursor = 0
        for (t in tokens) {
            val at = text.indexOf(t.surface, cursor)
            cursor = if (at >= 0) at + t.surface.length else minOf(text.length, cursor + t.surface.length)
            if (t.surface.jsTrim().isEmpty()) continue
            val japanese = containsJapanese(t.surface)
            val reading = t.reading?.takeIf { it != "*" }
            val kana = if (japanese) reading ?: t.surface else t.surface
            val particle = if (t.pos == "助詞") PARTICLES[t.surface] else null
            val opening = t.surface in OPENING
            val closing = t.surface in CLOSING
            val prev = groups.lastOrNull()
            if (prev != null && particle == null && !opening && !closing && !prev.opening && !prev.closing && prev.japanese == japanese && attachesToPrevious(t)) {
                prev.kana += kana
                prev.srcEnd = cursor
                continue
            }
            groups.add(Group(kana, japanese, particle, opening, closing, cursor))
        }
        val out = StringBuilder()
        val marks = ArrayList<Int>()
        var prev: Group? = null
        for (g in groups) {
            val piece = (g.particle ?: kanaToRomaji(g.kana)).replace(Regex("[$JS_SPACE]+"), " ").jsTrim()
            if (piece.isEmpty()) continue
            val space = out.isNotEmpty() && !g.closing && prev?.opening != true
            if (space) out.append(' ')
            out.append(piece)
            marks.add(g.srcEnd)
            marks.add(out.length)
            prev = g
        }
        return AlignedRomaji(out.toString(), marks)
    }

    fun tokensToRomaji(tokens: List<JaToken>): String = alignRomaji(tokens.joinToString("") { it.surface }, tokens).romaji

    /** Caracteres del texto original ya cantados según la palabra actual y su avance. */
    fun sungChars(line: LyricLine, wordIndex: Int, wordProgress: Double): Double {
        if (wordIndex < 0 || line.words.isEmpty()) return 0.0
        if (wordIndex >= line.words.size) return line.text.length.toDouble()
        var n = 0.0
        for (i in 0 until wordIndex) n += line.words[i].text.length
        n += line.words[wordIndex].text.jsTrimEnd().length * wordProgress.coerceIn(0.0, 1.0)
        return minOf(line.text.length.toDouble(), n)
    }

    /**
     * Relleno (0..1) del romaji que acompaña a la letra original: avanza al mismo punto que lo ya cantado
     * del original (a la mitad de 光る, a la mitad de "hikaru"), interpolando entre las marcas de alineación.
     */
    fun romajiFill(line: LyricLine, wordIndex: Int, wordProgress: Double): Double {
        val total = line.romaji?.length ?: 0
        if (total == 0 || line.text.isEmpty()) return 0.0
        val s = sungChars(line, wordIndex, wordProgress)
        val marks = line.romajiMarks ?: emptyList()
        var s0 = 0.0
        var o0 = 0.0
        var i = 0
        while (i + 1 < marks.size) {
            val s1 = marks[i].toDouble()
            val o1 = marks[i + 1].toDouble()
            if (s <= s1) return (if (s1 > s0) o0 + (s - s0) / (s1 - s0) * (o1 - o0) else o1) / total
            s0 = s1
            o0 = o1
            i += 2
        }
        val s1 = line.text.length.toDouble()
        return (if (s1 > s0) o0 + (s - s0) / (s1 - s0) * (total - o0) else total.toDouble()) / total
    }

    /** Una canción se trata como japonesa si al menos el 30 % de sus líneas con CJK tienen kana (así no se romaniza chino). */
    fun isJapaneseLyrics(texts: List<String>): Boolean {
        var cjk = 0
        var kana = 0
        for (t in texts) {
            if (!containsJapanese(t)) continue
            cjk++
            if (containsKana(t)) kana++
        }
        return kana > 0 && kana.toDouble() / cjk >= 0.3
    }

    /** Agrega `romaji` a las líneas japonesas del documento. `analyze` es el analizador de la plataforma. */
    fun romanizeDocument(doc: LyricsDocument, analyze: (String) -> List<JaToken>): LyricsDocument {
        if (doc.kind != LyricsKind.SYNCED || !isJapaneseLyrics(doc.lines.map { it.text })) return doc
        return doc.copy(
            lines = doc.lines.map { l ->
                if (!containsJapanese(l.text)) return@map l
                val a = alignRomaji(l.text, analyze(l.text))
                l.copy(romaji = a.romaji, romajiMarks = a.marks)
            },
        )
    }
}
