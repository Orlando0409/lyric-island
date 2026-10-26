package com.lyricisland.app.overlay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import androidx.palette.graphics.Palette
import com.lyricisland.app.AppLog
import com.lyricisland.app.MainActivity
import com.lyricisland.app.Romanizer
import com.lyricisland.app.R
import com.lyricisland.app.data.AppSettings
import com.lyricisland.app.graph
import com.lyricisland.app.media.MediaEvent
import com.lyricisland.app.media.MediaListenerService
import com.lyricisland.app.media.SessionTracker
import com.lyricisland.app.ui.island.IslandGeometry
import com.lyricisland.app.ui.island.IslandOverlay
import com.lyricisland.core.ColorEngine
import com.lyricisland.core.IslandController
import com.lyricisland.core.QueryTrack
import com.lyricisland.core.Scheduler
import com.lyricisland.core.Swatch
import com.lyricisland.core.SwatchName
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Foreground service (tipo specialUse) que mantiene viva la isla (12.8): crea la ventana overlay,
 * conecta SessionTracker → IslandController y publica la notificación persistente con acciones.
 */
class IslandOverlayService : LifecycleService() {
    companion object {
        const val CHANNEL = "island"
        const val NOTIF_ID = 1
        const val CHANNEL_PERMS = "permissions"
        const val NOTIF_PERMS_ID = 2
        const val ACTION_TOGGLE_HIDE = "com.lyricisland.TOGGLE_HIDE"
        const val ACTION_PAUSE_1H = "com.lyricisland.PAUSE_1H"
        const val ACTION_STOP = "com.lyricisland.STOP"
        private const val HOUR_MS = 3_600_000L

        @Volatile var running = false
            private set

        /** Android 15+: se inicia desde la app en primer plano y la ventana se crea de inmediato. */
        fun start(context: Context) = context.startForegroundService(Intent(context, IslandOverlayService::class.java))

        fun stop(context: Context) = context.startService(Intent(context, IslandOverlayService::class.java).setAction(ACTION_STOP))
    }

    private val handler = Handler(Looper.getMainLooper())
    private lateinit var controller: IslandController
    private lateinit var tracker: SessionTracker
    private lateinit var window: OverlayWindowController
    private val owner = OverlayLifecycleOwner()
    private val settingsState = mutableStateOf(AppSettings())
    private val artworkState = mutableStateOf<ImageBitmap?>(null)
    private val geometryState = mutableStateOf(IslandGeometry())
    private val screenOn = mutableStateOf(true)
    private var hiddenUntilNextTrack = false
    private var lastTrackKey: String? = null
    private var userHiddenByNotif = false

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            screenOn.value = intent.action != Intent.ACTION_SCREEN_OFF
            if (screenOn.value) tracker.requestSnapshot()
        }
    }

    override fun onCreate() {
        super.onCreate()
        running = true
        startInForeground()
        // Se quitó un permiso (o arrancó tras reiniciar sin ellos): se avisa y se detiene; la app los vuelve a pedir.
        if (!Settings.canDrawOverlays(this) || !MediaListenerService.isEnabled(this)) {
            AppLog.log("service", "faltan permisos: se detiene y avisa")
            notifyPermissionsNeeded()
            stopSelf()
            return
        }
        val g = graph
        controller = IslandController(
            clock = { SystemClock.elapsedRealtime() }, // mismo reloj que PlaybackState.lastPositionUpdateTime
            scheduler = object : Scheduler {
                override fun setTimeout(ms: Long, fn: () -> Unit): Any = Runnable(fn).also { handler.postDelayed(it, ms) }
                override fun clearTimeout(handle: Any) = handler.removeCallbacks(handle as Runnable)
            },
            launch = { block -> lifecycleScope.launch { block() } },
            fetchLyrics = { t ->
                val doc = g.lyrics.get(QueryTrack(t.title, t.artist, t.album, t.durationMs))
                withContext(Dispatchers.Default) { Romanizer.addRomaji(doc) } // canciones en japonés
            },
            loadUserOffset = { t -> g.loadOffset(t) },
            saveUserOffset = { t, ms -> lifecycleScope.launch { g.saveOffset(t, ms) } },
        )
        tracker = SessionTracker(this).apply { onDetected = { pkg -> lifecycleScope.launch { g.settings.noteDetected(pkg) } } }
        window = OverlayWindowController(this)

        val view = ComposeView(this).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnDetachedFromWindow)
            setContent {
                IslandOverlay(
                    controller = controller,
                    settings = settingsState.value,
                    artwork = artworkState.value,
                    geometry = geometryState.value,
                    screenOn = screenOn.value,
                    powerSave = getSystemService(PowerManager::class.java).isPowerSaveMode,
                    reducedMotion = Settings.Global.getFloat(contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f,
                    onTap = { controller.toggleCompact() },
                    onSwipeUp = {
                        hiddenUntilNextTrack = true
                        controller.setHidden(true)
                    },
                    onOffset = { steps -> controller.adjustOffset(steps * IslandController.OFFSET_STEP_MS) },
                    onHide = { controller.setHidden(true); hiddenUntilNextTrack = true },
                    onOpenSettings = { startActivity(Intent(this@IslandOverlayService, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) },
                )
            }
        }
        owner.attach(view)
        owner.resume()
        updateGeometry()
        window.show(view)

        registerReceiver(screenReceiver, IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
        })

        lifecycleScope.launch {
            tracker.events.collect { e ->
                when (e) {
                    is MediaEvent.Track -> onTrack(e)
                    is MediaEvent.TimelineChanged -> controller.onTimeline(e.timeline)
                    MediaEvent.Cleared -> {
                        artworkState.value = null
                        controller.onCleared()
                    }
                }
            }
        }
        lifecycleScope.launch {
            g.settings.settings.collect { s ->
                settingsState.value = s
                controller.setBehavior(s.behavior().copy(hideOnFullscreen = true))
                tracker.setFilter(s.behavior().playerFilter)
                val pausedNow = s.pausedUntilMs > System.currentTimeMillis()
                if (pausedNow != userHiddenByNotif) {
                    userHiddenByNotif = pausedNow
                    controller.setHidden(pausedNow)
                    if (pausedNow) handler.postDelayed({ lifecycleScope.launch { g.settings.update { it.copy(pausedUntilMs = 0) } } }, s.pausedUntilMs - System.currentTimeMillis())
                }
                updateGeometry()
            }
        }
        lifecycleScope.launch {
            // Solo la transición activa → inactiva detiene el servicio (el valor inicial puede llegar antes de guardarse).
            var wasEnabled = false
            g.settings.settings.map { it.enabled }.distinctUntilChanged().collect { enabled ->
                if (wasEnabled && !enabled) stopSelf()
                wasEnabled = enabled
            }
        }
        startTracker()
    }

    private fun startTracker() {
        if (tracker.start()) {
            AppLog.log("service", "SessionTracker iniciado")
            return
        }
        // Sin acceso a notificaciones todavía: se reintenta cuando el listener se conecte.
        AppLog.log("service", "esperando acceso a notificaciones")
        MediaListenerService.onConnectedListeners.add { handler.post { tracker.start() } }
    }

    private fun onTrack(e: MediaEvent.Track) {
        val key = IslandController.trackKey(e.track)
        if (key != lastTrackKey) {
            lastTrackKey = key
            if (hiddenUntilNextTrack && !userHiddenByNotif) {
                hiddenUntilNextTrack = false
                controller.setHidden(false)
            }
        }
        controller.onTrack(e.track)
        artworkState.value = e.artwork?.asImageBitmap()
        val art = e.artwork
        lifecycleScope.launch {
            val palette = if (art == null) ColorEngine.NEUTRAL_PALETTE else withContext(Dispatchers.Default) { paletteOf(art) }
            if (IslandController.trackKey(e.track) == lastTrackKey) controller.setPalette(palette)
        }
    }

    private fun paletteOf(b: Bitmap): com.lyricisland.core.Palette = runCatching {
        val p = Palette.from(b).maximumColorCount(16).generate()
        fun sw(s: Palette.Swatch?) = s?.let { Swatch(String.format("#%06X", 0xFFFFFF and it.rgb), it.population) }
        ColorEngine.buildPalette(
            mapOf(
                SwatchName.Vibrant to sw(p.vibrantSwatch),
                SwatchName.DarkVibrant to sw(p.darkVibrantSwatch),
                SwatchName.Muted to sw(p.mutedSwatch),
                SwatchName.DarkMuted to sw(p.darkMutedSwatch),
                SwatchName.LightVibrant to sw(p.lightVibrantSwatch),
                SwatchName.LightMuted to sw(p.lightMutedSwatch),
                SwatchName.Dominant to sw(p.dominantSwatch),
            ),
        )
    }.getOrDefault(ColorEngine.NEUTRAL_PALETTE)

    private fun updateGeometry() {
        val s = settingsState.value
        val dm = resources.displayMetrics
        val density = dm.density
        val landscape = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        val cutout = if (s.alignCutout && !landscape) CutoutLocator.locate(this) else null
        geometryState.value = IslandGeometry(
            screenWidthDp = dm.widthPixels / density,
            cutoutWidthDp = cutout?.rect?.width()?.div(density),
            cutoutHeightDp = cutout?.rect?.height()?.div(density),
        )
        val topPx = cutout?.let { maxOf(0, it.rect.top - (4 * density).toInt()) } ?: (s.topMarginDp * density).toInt()
        window.setTopOffset(topPx)
        // En horizontal la isla se oculta por defecto (suele coincidir con video o juegos).
        controller.onFullscreen(landscape && s.hideInLandscape)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        updateGeometry()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (!::controller.isInitialized) return START_NOT_STICKY // detenido por falta de permisos
        when (intent?.action) {
            ACTION_TOGGLE_HIDE -> {
                hiddenUntilNextTrack = false
                controller.toggleHidden()
            }
            ACTION_PAUSE_1H -> lifecycleScope.launch { graph.settings.update { it.copy(pausedUntilMs = System.currentTimeMillis() + HOUR_MS) } }
            ACTION_STOP -> lifecycleScope.launch {
                graph.settings.update { it.copy(enabled = false) }
                stopSelf()
            }
        }
        return START_STICKY
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
        fun pi(action: String, code: Int) = PendingIntent.getService(this, code, Intent(this, IslandOverlayService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(this, 10, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_island)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text))
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(open)
            .addAction(0, getString(R.string.action_hide), pi(ACTION_TOGGLE_HIDE, 1))
            .addAction(0, getString(R.string.action_pause_1h), pi(ACTION_PAUSE_1H, 2))
            .addAction(0, getString(R.string.action_settings), open)
            .build()
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, NOTIF_ID, n, type)
    }

    private fun notifyPermissionsNeeded() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL_PERMS, getString(R.string.perm_channel), NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(
            this,
            11,
            Intent(this, MainActivity::class.java).putExtra(MainActivity.EXTRA_REQUEST_PERMISSIONS, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(this, CHANNEL_PERMS)
            .setSmallIcon(R.drawable.ic_stat_island)
            .setContentTitle(getString(R.string.perm_needed_title))
            .setContentText(getString(R.string.perm_needed_text))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { nm.notify(NOTIF_PERMS_ID, n) } // sin permiso de notificaciones no se muestra; la app los pide al abrirse
    }

    override fun onDestroy() {
        running = false
        if (!::controller.isInitialized) { // se detuvo por falta de permisos antes de inicializar
            super.onDestroy()
            return
        }
        runCatching { unregisterReceiver(screenReceiver) }
        tracker.stop()
        controller.dispose()
        owner.pause()
        window.remove()
        owner.destroy()
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        // Opcional: solo si el usuario la tenía activa y los permisos siguen concedidos.
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val enabled = context.graph.settings.settings.first().enabled
                if (enabled && Settings.canDrawOverlays(context)) runCatching { IslandOverlayService.start(context) }
            } finally {
                pending.finish()
            }
        }
    }
}
