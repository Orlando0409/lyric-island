package com.lyricisland.app

import android.app.Application
import android.content.Context
import android.util.Log
import com.lyricisland.app.data.LrclibHttp
import com.lyricisland.app.data.LyricsDatabase
import com.lyricisland.app.data.RoomLyricsCache
import com.lyricisland.app.data.SettingsRepository
import com.lyricisland.app.data.UserOffsetEntity
import com.lyricisland.core.LyricsRepository
import com.lyricisland.core.NowPlaying
import com.lyricisland.core.QueryTrack
import com.lyricisland.core.TrackMatcher
import java.security.MessageDigest
import java.time.Instant

class LyricIslandApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
    }
}

val Context.graph: AppGraph get() = (applicationContext as LyricIslandApp).graph

/** Dependencias de la app (DI manual: suficiente para este tamaño, 12.1). */
class AppGraph(context: Context) {
    val settings = SettingsRepository(context)
    val db = LyricsDatabase.create(context)
    val lyrics = LyricsRepository(
        http = LrclibHttp(),
        cache = RoomLyricsCache(db.dao()),
        hash = ::sha1,
        now = System::currentTimeMillis,
    )

    fun offsetKey(t: NowPlaying) = sha1(TrackMatcher.cacheKeySource(QueryTrack(t.title, t.artist, t.album, t.durationMs)))

    suspend fun loadOffset(t: NowPlaying): Long = db.dao().offset(offsetKey(t)) ?: 0

    suspend fun saveOffset(t: NowPlaying, ms: Long) {
        if (ms == 0L) db.dao().deleteOffset(offsetKey(t)) else db.dao().putOffset(UserOffsetEntity(offsetKey(t), ms))
    }

    companion object {
        fun sha1(s: String): String = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}

/** Logs locales en memoria. Sin telemetría: solo se exportan si el usuario lo pide. */
object AppLog {
    private const val MAX = 1000
    private val ring = ArrayDeque<String>()

    @Synchronized
    fun log(tag: String, msg: String) {
        Log.i("LyricIsland", "$tag: $msg")
        ring.addLast("${Instant.now()} $tag: $msg")
        while (ring.size > MAX) ring.removeFirst()
    }

    @Synchronized
    fun dump(): String = ring.joinToString("\n")
}
