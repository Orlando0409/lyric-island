package com.lyricisland.testplayer

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Bundle
import android.os.SystemClock
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Reproductor falso: publica una MediaSession con metadatos, posición, carátula y estado configurables.
 * No reproduce audio. Se controla con botones o por adb:
 *   adb shell am start -n com.lyricisland.testplayer/.PlayerActivity --es cmd play|pause|seek|next --el pos 60000
 */
class PlayerActivity : Activity() {
    private data class Song(val title: String, val artist: String, val album: String?, val durationMs: Long, val colors: IntArray)

    private val songs = listOf(
        Song("Bohemian Rhapsody", "Queen", "A Night at the Opera", 354_000, intArrayOf(0xFF8E2DE2.toInt(), 0xFF4A00E0.toInt())),
        Song("Isla de Luz", "Los Fixtures", "Pruebas Unitarias", 40_000, intArrayOf(0xFF11998E.toInt(), 0xFF38EF7D.toInt())),
        Song("Interludio Azul", "Cuarteto Stub", "Sin Voz", 240_000, intArrayOf(0xFF2193B0.toInt(), 0xFF6DD5ED.toInt())),
    )
    private lateinit var session: MediaSession
    private var index = 0
    private var playing = false
    private var position = 0L
    private var updatedAt = 0L
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        session = MediaSession(this, "LyricIslandTestPlayer").apply { isActive = true }
        status = TextView(this).apply { textSize = 16f }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 160, 48, 48)
            addView(status)
            listOf("play", "pause", "seek", "next").forEach { cmd ->
                addView(Button(this@PlayerActivity).apply {
                    text = cmd
                    setOnClickListener { handle(cmd, if (cmd == "seek") currentPosition() + 30_000 else null) }
                })
            }
        }
        setContentView(root)
        publishMetadata()
        handle(intent.getStringExtra("cmd") ?: "play", intent.getLongExtra("pos", -1).takeIf { it >= 0 })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent.getStringExtra("cmd") ?: return, intent.getLongExtra("pos", -1).takeIf { it >= 0 })
    }

    private fun currentPosition(): Long =
        if (playing) position + (SystemClock.elapsedRealtime() - updatedAt) else position

    private fun handle(cmd: String, pos: Long?) {
        when (cmd) {
            "play" -> {
                position = pos ?: currentPosition()
                playing = true
            }
            "pause" -> {
                position = currentPosition()
                playing = false
            }
            "seek" -> position = pos ?: (currentPosition() + 30_000)
            "next" -> {
                index = (index + 1) % songs.size
                position = 0
                publishMetadata()
            }
        }
        updatedAt = SystemClock.elapsedRealtime()
        session.setPlaybackState(
            PlaybackState.Builder()
                .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, position, if (playing) 1f else 0f, updatedAt)
                .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_SEEK_TO)
                .build(),
        )
        val s = songs[index]
        status.text = "${s.artist} — ${s.title}\n${if (playing) "▶" else "❚❚"} ${position / 1000}s"
    }

    private fun publishMetadata() {
        val s = songs[index]
        session.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, s.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, s.artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, s.album)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, s.durationMs)
                .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork(s.colors))
                .build(),
        )
    }

    private fun artwork(colors: IntArray): Bitmap {
        val b = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888)
        val p = Paint().apply { shader = LinearGradient(0f, 0f, 256f, 256f, colors[0], colors[1], Shader.TileMode.CLAMP) }
        Canvas(b).drawRect(0f, 0f, 256f, 256f, p)
        return b
    }

    override fun onDestroy() {
        session.release()
        super.onDestroy()
    }
}
