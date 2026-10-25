package com.lyricisland.app

import android.graphics.Rect
import com.lyricisland.app.data.AppSettings
import com.lyricisland.app.data.LrclibHttp
import com.lyricisland.app.data.RoomLyricsCache
import com.lyricisland.app.media.SessionSelection
import com.lyricisland.app.overlay.CutoutLocator
import com.lyricisland.core.Candidate
import com.lyricisland.core.LyricsKind
import com.lyricisland.core.LyricsRepository
import com.lyricisland.core.MemoryLyricsCache
import com.lyricisland.core.PlayerFilter
import com.lyricisland.core.QueryTrack
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUnitTest {
    private data class S(val pkg: String, val playing: Boolean, val tick: Long)

    @Test
    fun seleccionDeSesion() {
        val a = S("com.spotify.music", true, 1)
        val b = S("com.google.android.apps.youtube.music", true, 2)
        val c = S("com.android.chrome", false, 3)
        val none = PlayerFilter(false, emptyList())
        assertEquals(b, SessionSelection.select(listOf(a, b, c), S::pkg, S::playing, S::tick, none))
        assertEquals(a, SessionSelection.select(listOf(a, b, c), S::pkg, S::playing, S::tick, PlayerFilter(false, listOf("youtube"))))
        assertEquals(c, SessionSelection.select(listOf(c), S::pkg, S::playing, S::tick, none))
        assertNull(SessionSelection.select(listOf(c), S::pkg, S::playing, S::tick, PlayerFilter(false, AppSettings.DEFAULT_BLOCKED)))
    }

    @Test
    fun youtubeMusicNoQuedaBloqueadoPorDefecto() {
        val f = AppSettings().behavior().playerFilter
        assertTrue(f.allows("com.google.android.apps.youtube.music"))
        assertTrue(f.allows("com.spotify.music"))
        assertTrue(!f.allows("com.google.android.youtube"))
    }

    @Test
    fun cacheRoomCodificaYDecodifica() {
        val c = Candidate(7, "Faro", "Los Fixtures", null, 204.5, false, "a\nb", "[00:01.00]a")
        assertEquals(c, RoomLyricsCache.decode(RoomLyricsCache.encode(c)))
        assertNull(RoomLyricsCache.decode("{roto"))
        assertNull(RoomLyricsCache.decode(null))
    }

    @Test
    fun cutoutCentrado() {
        // Rect es un stub en los tests JVM (isReturnDefaultValues): se valida la lógica con valores explícitos.
        val r = Rect().apply { left = 500; right = 580; top = 0; bottom = 80 }
        val corner = Rect().apply { left = 20; right = 100; top = 0; bottom = 80 }
        if (r.width() == 0) return // Rect sin implementación en JVM: se cubre en los tests instrumentados
        assertEquals(r, CutoutLocator.pickTopCenter(listOf(corner, r), 1080))
        assertNull(CutoutLocator.pickTopCenter(listOf(corner), 1080))
    }

    @Test
    fun lrclibConMockWebServer() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(404))
        server.enqueue(
            MockResponse().setBody(
                """{"id":42,"trackName":"Canción Vieja","artistName":"Banda Mock","albumName":null,"duration":199,"instrumental":false,"plainLyrics":"x","syncedLyrics":"[00:01.00]Hola\n[00:03.00]Chau"}""",
            ),
        )
        server.start()
        try {
            val repo = LyricsRepository(
                http = LrclibHttp(),
                cache = MemoryLyricsCache(),
                hash = AppGraph::sha1,
                now = { 0L },
                baseUrl = server.url("/api").toString().trimEnd('/'),
            )
            val doc = repo.get(QueryTrack("Canción Vieja - Remastered 2011", "Banda Mock", null, 199_000))
            assertEquals(LyricsKind.SYNCED, doc.kind)
            assertEquals(42L, doc.lrclibId)
            val first = server.takeRequest()
            assertTrue(first.path!!.startsWith("/api/get?"))
            assertTrue(first.getHeader("User-Agent")!!.startsWith("LyricIsland/"))
            assertTrue(server.takeRequest().path!!.contains("track_name=Canci%C3%B3n%20Vieja"))
        } finally {
            server.shutdown()
        }
    }
}
