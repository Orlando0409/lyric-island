package com.lyricisland.app

import com.atilika.kuromoji.ipadic.Tokenizer
import com.lyricisland.core.JaToken
import com.lyricisland.core.LyricsDocument
import com.lyricisland.core.LyricsKind
import com.lyricisland.core.Romaji

/**
 * Romaji en Android: kuromoji (diccionario IPADIC incluido en el APK) da las lecturas de los kanji y el núcleo
 * (Romaji.kt) las convierte a Hepburn. El analizador se construye una sola vez, la primera vez que suena una
 * canción en japonés. Llamar fuera del hilo principal.
 */
object Romanizer {
    private val tokenizer by lazy { Tokenizer() }

    fun addRomaji(doc: LyricsDocument): LyricsDocument {
        if (doc.kind != LyricsKind.SYNCED || !Romaji.isJapaneseLyrics(doc.lines.map { it.text })) return doc
        return runCatching {
            Romaji.romanizeDocument(doc) { text ->
                tokenizer.tokenize(text).map { t ->
                    JaToken(t.surface, t.reading?.takeIf { it != "*" }, t.partOfSpeechLevel1, t.partOfSpeechLevel2)
                }
            }
        }.getOrElse {
            AppLog.log("romaji", "sin romaji: $it")
            doc
        }
    }
}
