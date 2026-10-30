package com.lyricisland.app.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import androidx.core.graphics.scale
import androidx.core.net.toUri
import com.lyricisland.core.NowPlaying
import com.lyricisland.core.PlaybackStatus
import com.lyricisland.core.PlayerFilter
import com.lyricisland.core.Timeline
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import java.nio.ByteBuffer
import java.security.MessageDigest

// SessionTracker: MediaSessionManager + MediaController.Callback → eventos de NowPlaying / Timeline.

sealed interface MediaEvent {
    data class Track(val track: NowPlaying, val artwork: Bitmap?) : MediaEvent
    data class TimelineChanged(val timeline: Timeline) : MediaEvent
    data object Cleared : MediaEvent
}

/** Lógica pura de selección de sesión: reproduciendo y más reciente; si no, la última que reprodujo. */
object SessionSelection {
    fun <T> select(sessions: List<T>, pkg: (T) -> String, playing: (T) -> Boolean, lastPlaying: (T) -> Long, filter: PlayerFilter): T? {
        val allowed = sessions.filter { filter.allows(pkg(it)) }
        if (allowed.isEmpty()) return null
        allowed.filter(playing).maxByOrNull(lastPlaying)?.let { return it }
        allowed.filter { lastPlaying(it) > 0 }.maxByOrNull(lastPlaying)?.let { return it }
        return allowed.first()
    }
}

class SessionTracker(private val context: Context) {
    private val handler = Handler(Looper.getMainLooper())
    private val msm = context.getSystemService(MediaSessionManager::class.java)
    private val _events = MutableSharedFlow<MediaEvent>(replay = 0, extraBufferCapacity = 32, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val events: SharedFlow<MediaEvent> = _events

    private var filter = PlayerFilter(false, emptyList())
    private var active: MediaController? = null
    private val lastPlayingTick = HashMap<MediaSession2Key, Long>()
    private val wasPlaying = HashMap<MediaSession2Key, Boolean>()
    private var tick = 0L
    private var lastArtworkHash: String? = null
    private var clearedSent = false
    private var controllers: List<MediaController> = emptyList()
    private val controllerCallbacks = HashMap<MediaSession2Key, MediaController.Callback>()
    var onDetected: (String) -> Unit = {}

    private data class MediaSession2Key(val token: Any)

    private fun key(c: MediaController) = MediaSession2Key(c.sessionToken)

    private val sessionsListener = MediaSessionManager.OnActiveSessionsChangedListener { list -> onSessions(list.orEmpty()) }

    /** Requiere el acceso a notificaciones. Devuelve false si todavía no está concedido. */
    fun start(): Boolean = try {
        val component = MediaListenerService.component(context)
        msm.addOnActiveSessionsChangedListener(sessionsListener, component, handler)
        onSessions(msm.getActiveSessions(component))
        true
    } catch (_: SecurityException) {
        false
    }

    fun stop() {
        runCatching { msm.removeOnActiveSessionsChangedListener(sessionsListener) }
        controllers.forEach { c -> controllerCallbacks.remove(key(c))?.let(c::unregisterCallback) }
        controllers = emptyList()
        active = null
    }

    fun setFilter(f: PlayerFilter) {
        if (f == filter) return
        filter = f
        handler.post { reselect(force = false) }
    }

    fun requestSnapshot() = handler.post { reselect(force = true) }

    private fun onSessions(list: List<MediaController>) {
        val keys = list.map(::key).toSet()
        controllers.filter { key(it) !in keys }.forEach { c -> controllerCallbacks.remove(key(c))?.let(c::unregisterCallback) }
        for (c in list) {
            if (controllerCallbacks.containsKey(key(c))) continue
            val cb = object : MediaController.Callback() {
                override fun onMetadataChanged(metadata: MediaMetadata?) {
                    if (c.sessionToken == active?.sessionToken) emitTrack(c, force = false)
                }

                override fun onPlaybackStateChanged(state: PlaybackState?) {
                    reselect(force = false)
                    if (c.sessionToken == active?.sessionToken) emitTimeline(c)
                }

                override fun onSessionDestroyed() {
                    handler.post { onSessions(controllers.filter { it.sessionToken != c.sessionToken }) }
                }
            }
            c.registerCallback(cb, handler)
            controllerCallbacks[key(c)] = cb
        }
        controllers = list
        reselect(force = false)
    }

    private fun isPlaying(c: MediaController) = c.playbackState?.state == PlaybackState.STATE_PLAYING

    private fun reselect(force: Boolean) {
        for (c in controllers) {
            val k = key(c)
            val p = isPlaying(c)
            if (p && wasPlaying[k] != true) lastPlayingTick[k] = ++tick
            wasPlaying[k] = p
        }
        val selected = SessionSelection.select(controllers, { it.packageName }, ::isPlaying, { lastPlayingTick[key(it)] ?: 0 }, filter)
        if (selected == null) {
            active = null
            lastArtworkHash = null
            if (!clearedSent || force) {
                clearedSent = true
                _events.tryEmit(MediaEvent.Cleared)
            }
            return
        }
        if (selected.sessionToken != active?.sessionToken || force) {
            active = selected
            clearedSent = false
            onDetected(selected.packageName)
            emitTrack(selected, force = true)
            emitTimeline(selected)
        }
    }

    private fun emitTrack(c: MediaController, force: Boolean) {
        val m = c.metadata ?: return
        val art = readArtwork(m)
        val hash = art?.let(::hashBitmap)
        lastArtworkHash = hash
        val duration = m.getLong(MediaMetadata.METADATA_KEY_DURATION).takeIf { it > 0 }
        val track = NowPlaying(
            sourceAppId = c.packageName,
            title = m.getString(MediaMetadata.METADATA_KEY_TITLE)?.trim().orEmpty(),
            artist = (m.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: m.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST))?.trim().orEmpty(),
            album = m.getString(MediaMetadata.METADATA_KEY_ALBUM)?.trim()?.ifEmpty { null },
            durationMs = duration,
            artworkHash = hash,
        )
        _events.tryEmit(MediaEvent.Track(track, art))
    }

    private fun emitTimeline(c: MediaController) {
        val s = c.playbackState ?: return
        val status = when (s.state) {
            PlaybackState.STATE_PLAYING -> PlaybackStatus.PLAYING
            PlaybackState.STATE_PAUSED -> PlaybackStatus.PAUSED
            PlaybackState.STATE_STOPPED, PlaybackState.STATE_NONE, PlaybackState.STATE_ERROR -> PlaybackStatus.STOPPED
            else -> PlaybackStatus.UNKNOWN
        }
        val playing = status == PlaybackStatus.PLAYING
        val updated = s.lastPositionUpdateTime.takeIf { it > 0 } ?: SystemClock.elapsedRealtime() // base elapsedRealtime
        _events.tryEmit(
            MediaEvent.TimelineChanged(
                Timeline(
                    positionMs = maxOf(0L, s.position),
                    updatedAtMs = updated,
                    rate = if (playing) s.playbackSpeed.takeIf { it > 0f } ?: 1f else 0f,
                    status = status,
                ),
            ),
        )
    }

    /** ALBUM_ART → ART → DISPLAY_ICON; si solo hay URI, se resuelve con ContentResolver. Reducida a ≤ 256 px. */
    private fun readArtwork(m: MediaMetadata): Bitmap? {
        val bmp = m.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
            ?: m.getBitmap(MediaMetadata.METADATA_KEY_ART)
            ?: m.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
            ?: (m.getString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI) ?: m.getString(MediaMetadata.METADATA_KEY_ART_URI))?.let(::loadUri)
        return bmp?.let(::downscale)
    }

    private fun loadUri(uri: String): Bitmap? = runCatching {
        val u = uri.toUri()
        if (Build.VERSION.SDK_INT >= 28) ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, u)) { d, _, _ -> d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE }
        else @Suppress("DEPRECATION") MediaStore.Images.Media.getBitmap(context.contentResolver, u)
    }.getOrNull()

    private fun downscale(b: Bitmap): Bitmap {
        val max = 256
        // Copia en software: los bitmaps HARDWARE no se pueden leer (hash, Palette).
        val soft = b.copy(Bitmap.Config.ARGB_8888, false) ?: b
        if (soft.width <= max && soft.height <= max) return soft
        val k = minOf(max.toFloat() / soft.width, max.toFloat() / soft.height)
        return soft.scale(maxOf(1, (soft.width * k).toInt()), maxOf(1, (soft.height * k).toInt()))
    }

    private fun hashBitmap(b: Bitmap): String {
        val buf = ByteBuffer.allocate(b.byteCount)
        b.copyPixelsToBuffer(buf)
        return MessageDigest.getInstance("SHA-1").digest(buf.array()).joinToString("") { "%02x".format(it) }
    }
}
