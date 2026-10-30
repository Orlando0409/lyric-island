package com.lyricisland.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.lyricisland.app.data.AppSettings
import com.lyricisland.app.ui.island.BubbleControls
import com.lyricisland.app.ui.island.BubbleView
import com.lyricisland.app.ui.island.IslandGeometry
import com.lyricisland.app.ui.island.IslandView
import com.lyricisland.core.ColorEngine
import com.lyricisland.core.IslandMode
import com.lyricisland.core.IslandSnapshot
import com.lyricisland.core.LrcParser
import com.lyricisland.core.LyricsSource
import com.lyricisland.core.NowPlaying
import com.lyricisland.core.PlaybackStatus
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Tests instrumentados de la isla: cada estado (expandida, pausada, compacta, oculta) y la burbuja, en un dispositivo real. */
@RunWith(AndroidJUnit4::class)
class IslandViewTest {
    @get:Rule val rule = createComposeRule()

    private val track = NowPlaying("com.lyricisland.testplayer", "Isla de Luz", "Los Fixtures", "Pruebas", 60_000, null)
    private val doc = LrcParser.buildDocument(
        "[00:01.00]Se enciende la isla sobre la ciudad\n[00:05.00]Cada palabra brilla en su lugar\n[00:09.00]Fin",
        null, false, 60_000, LyricsSource.LRCLIB, 1,
    )

    private fun snap(mode: IslandMode, line: Int = 0, word: Int = 2, showTitle: Boolean = false, flash: String? = null) = IslandSnapshot(
        mode = mode, showTitle = showTitle, track = track, lyrics = doc, activeLineIndex = line, lineProgress = 0.4,
        wordIndex = word, wordProgress = 0.5, interlude = null, positionMs = 2000.0, palette = ColorEngine.NEUTRAL_PALETTE,
        lyricsLoading = false, userOffsetMs = 0, offsetFlash = flash, status = PlaybackStatus.PLAYING, estimatedLines = false,
    )

    @Test
    fun expandida_muestraLineaActualYSiguiente() {
        rule.setContent { IslandView(snap(IslandMode.EXPANDED), AppSettings(), null, IslandGeometry(), reducedMotion = true) }
        rule.onNodeWithTag("island").assertIsDisplayed()
        rule.onNodeWithTag("current-line").assertIsDisplayed()
        rule.onNodeWithTag("next-line").assertIsDisplayed()
        rule.onNodeWithText("Cada palabra brilla en su lugar").assertIsDisplayed()
    }

    @Test
    fun pausada_muestraIndicador() {
        rule.setContent { IslandView(snap(IslandMode.PAUSED), AppSettings(), null, IslandGeometry(), reducedMotion = true) }
        rule.onNodeWithText("❚❚").assertIsDisplayed()
    }

    @Test
    fun compacta_muestraTitulo() {
        rule.setContent { IslandView(snap(IslandMode.COMPACT, showTitle = true), AppSettings(), null, IslandGeometry(), reducedMotion = true) }
        rule.onNodeWithTag("title").assertIsDisplayed()
    }

    @Test
    fun antesDeLaPrimeraLinea_conInterludio_laSiguienteEsLaPrimera() {
        val s = snap(IslandMode.EXPANDED, line = -1, word = -1).copy(interlude = com.lyricisland.core.Interlude(0.5, true))
        rule.setContent { IslandView(s, AppSettings(), null, IslandGeometry(), reducedMotion = true) }
        rule.onNodeWithTag("interlude").assertIsDisplayed()
        rule.onNodeWithText("Se enciende la isla sobre la ciudad").assertIsDisplayed()
    }

    @Test
    fun avisoDeOffset_yTocarAlterna() {
        var taps = 0
        rule.setContent { IslandView(snap(IslandMode.EXPANDED, flash = "+200 ms"), AppSettings(), null, IslandGeometry(), reducedMotion = true, onTap = { taps++ }) }
        rule.onNodeWithText("+200 ms").assertIsDisplayed()
        rule.onNodeWithTag("island").performClick()
        rule.waitForIdle()
        assertEquals(1, taps)
    }

    @Test
    fun lineaLarga_seParteEnDosRenglones() {
        val long = LrcParser.buildDocument(
            "[00:01.00]Esta línea es bastante larga y no entra entera en un solo renglón de la isla\n[00:09.00]Fin",
            null, false, 60_000, LyricsSource.LRCLIB, 1,
        )
        rule.setContent {
            IslandView(snap(IslandMode.EXPANDED).copy(lyrics = long), AppSettings(), null, IslandGeometry(screenWidthDp = 360f), reducedMotion = true)
        }
        rule.onNodeWithTag("WRAP", useUnmergedTree = true).assertExists()
    }

    private fun bubble(open: Boolean, toggles: () -> Unit = {}) = BubbleControls(open, onRight = true, dragging = false, {}, { _, _ -> }, {}, toggles)

    @Test
    fun burbuja_muestraLaLineaActualAlLado_yTocarAbreLaTarjeta() {
        var toggles = 0
        rule.setContent { BubbleView(snap(IslandMode.EXPANDED), AppSettings(), null, reducedMotion = true, controls = bubble(open = false) { toggles++ }) }
        rule.onNodeWithTag("bubble").assertIsDisplayed()
        rule.onNodeWithTag("bubble-line", useUnmergedTree = true).assertExists()
        rule.onNodeWithTag("bubble").performClick()
        rule.waitForIdle()
        assertEquals(1, toggles)
    }

    @Test
    fun burbujaAbierta_esUnaVentanaFlotanteConTodaLaLetra() {
        var toggles = 0
        rule.setContent { BubbleView(snap(IslandMode.EXPANDED), AppSettings(), null, reducedMotion = true, controls = bubble(open = true) { toggles++ }) }
        rule.onNodeWithTag("bubble-panel").assertIsDisplayed()
        rule.onNodeWithText("Isla de Luz").assertIsDisplayed()
        rule.onNodeWithTag("current-line", useUnmergedTree = true).assertExists()
        rule.onNodeWithText("Cada palabra brilla en su lugar").assertExists() // también las líneas que vienen
        rule.onNodeWithTag("bubble-line", useUnmergedTree = true).assertDoesNotExist()
        rule.onNodeWithTag("bubble-minimize").performClick()
        rule.waitForIdle()
        assertEquals(1, toggles)
    }

    @Test
    fun ventanaFlotante_romajiDeLaLineaActualConRelleno() {
        val ja = doc.copy(lines = doc.lines.mapIndexed { i, l -> if (i == 0) l.copy(romaji = "yozora ni hikaru shima", romajiMarks = listOf(2, 6)) else l })
        rule.setContent { BubbleView(snap(IslandMode.EXPANDED).copy(lyrics = ja), AppSettings(), null, reducedMotion = true, controls = bubble(open = true)) }
        // La línea actual usa el mismo romaji con relleno que la isla (no un texto fijo).
        rule.onNodeWithTag("romaji-line", useUnmergedTree = true).assertExists()
    }

    @Test
    fun oculta_noDibujaLaIsla() {
        rule.setContent { IslandView(snap(IslandMode.HIDDEN), AppSettings(), null, IslandGeometry(), reducedMotion = true) }
        rule.waitForIdle()
        rule.onNodeWithTag("island").assertDoesNotExist()
    }
}
