package com.lyricisland.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.lifecycle.lifecycleScope
import com.lyricisland.app.data.AppSettings
import com.lyricisland.app.data.BgStyle
import com.lyricisland.app.media.MediaListenerService
import com.lyricisland.app.overlay.IslandOverlayService
import com.lyricisland.core.NoLyricsBehavior
import com.lyricisland.core.PauseBehavior
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { recheck++ }
    private var recheck by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Solo debug: la matriz de emuladores (android/tools/run-matrix.sh) activa la isla sin tocar la UI.
        if (BuildConfig.DEBUG && intent.getBooleanExtra(EXTRA_ENABLE_ISLAND, false)) {
            lifecycleScope.launch { graph.settings.update { it.copy(enabled = true) } }
        }
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFFB69DF8))) {
                Surface(Modifier.fillMaxSize()) {
                    MainScreen(recheckKey = recheck, requestNotifications = {
                        if (Build.VERSION.SDK_INT >= 33) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    })
                }
            }
        }
    }

    companion object {
        const val EXTRA_ENABLE_ISLAND = "enableIsland"
    }

    override fun onResume() {
        super.onResume()
        recheck++ // al volver de una pantalla del sistema se re-evalúan los permisos
    }
}

data class PermissionState(val overlay: Boolean, val listener: Boolean, val notifications: Boolean, val battery: Boolean) {
    val required get() = overlay && listener && notifications
}

@Composable
private fun MainScreen(recheckKey: Int, requestNotifications: () -> Unit) {
    val ctx = LocalContext.current
    val g = ctx.graph
    val scope = rememberCoroutineScope()
    val settings by g.settings.settings.collectAsState(initial = AppSettings())
    val perms = remember(recheckKey) {
        PermissionState(
            overlay = Settings.canDrawOverlays(ctx),
            listener = MediaListenerService.isEnabled(ctx),
            notifications = Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED,
            battery = ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName),
        )
    }
    fun set(transform: (AppSettings) -> AppSettings) = scope.launch { g.settings.update(transform) }

    Column(
        Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.onboarding_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.onboarding_intro), style = MaterialTheme.typography.bodyMedium)

        PermissionCard(R.string.perm_overlay, R.string.perm_overlay_why, perms.overlay) {
            ctx.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, "package:${ctx.packageName}".toUri()))
        }
        PermissionCard(R.string.perm_listener, R.string.perm_listener_why, perms.listener) {
            ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        PermissionCard(R.string.perm_notifications, R.string.perm_notifications_why, perms.notifications, requestNotifications)
        PermissionCard(R.string.perm_battery, R.string.perm_battery_why, perms.battery) {
            @SuppressLint("BatteryLife")
            val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, "package:${ctx.packageName}".toUri())
            runCatching { ctx.startActivity(i) }.onFailure { ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }

        // Si el sistema mató el servicio (reinstalación, ahorro agresivo de algunos fabricantes) pero la isla
        // estaba activa, se relanza al abrir la app (en primer plano está permitido, 12.8).
        LaunchedEffect(settings.enabled, perms) {
            if (settings.enabled && perms.required && !IslandOverlayService.running) IslandOverlayService.start(ctx)
        }
        val running = settings.enabled
        Button(
            enabled = perms.required,
            modifier = Modifier.fillMaxWidth(),
            onClick = {
                // Se guarda primero y luego se arranca/detiene: el servicio observa "enabled".
                scope.launch {
                    g.settings.update { it.copy(enabled = !running) }
                    if (running) IslandOverlayService.stop(ctx) else IslandOverlayService.start(ctx)
                }
            },
        ) { Text(stringResource(if (running) R.string.stop_island else R.string.start_island)) }

        SettingsSection(settings) { t -> set(t) }
    }
}

@Composable
private fun PermissionCard(title: Int, why: Int, granted: Boolean, onGrant: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(title), style = MaterialTheme.typography.titleSmall)
            Text(stringResource(why), style = MaterialTheme.typography.bodySmall)
            if (granted) Text(stringResource(R.string.granted), color = MaterialTheme.colorScheme.primary)
            else OutlinedButton(onClick = onGrant) { Text(stringResource(R.string.grant)) }
        }
    }
}

@Composable
private fun Header(res: Int) = Text(stringResource(res), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))

@Composable
private fun SwitchRow(label: Int, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(stringResource(label), Modifier.weight(1f))
        Switch(value, onChange)
    }
}

@Composable
private fun <T> Choice(label: Int, options: List<Pair<T, Int>>, value: T, onChange: (T) -> Unit) {
    Text(stringResource(label), style = MaterialTheme.typography.bodyMedium)
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        options.forEachIndexed { i, (v, res) ->
            SegmentedButton(selected = v == value, onClick = { onChange(v) }, shape = SegmentedButtonDefaults.itemShape(i, options.size)) {
                Text(stringResource(res), style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable
private fun SettingsSection(s: AppSettings, set: ((AppSettings) -> AppSettings) -> Unit) {
    val ctx = LocalContext.current
    val g = ctx.graph
    val scope = rememberCoroutineScope()
    var note by remember { mutableStateOf("") }
    val doneText = stringResource(R.string.done)
    val exportTitle = stringResource(R.string.export_logs)

    Header(R.string.s_appearance)
    Text("${stringResource(R.string.font_scale)}: ${(s.fontScale * 100).toInt()} %")
    Slider(s.fontScale, { v -> set { it.copy(fontScale = v) } }, valueRange = 0.8f..1.5f)
    Text("${stringResource(R.string.max_opacity)}: ${(s.maxOpacity * 100).toInt()} %")
    Slider(s.maxOpacity, { v -> set { it.copy(maxOpacity = v) } }, valueRange = 0.3f..1f)
    SwitchRow(R.string.show_next_line, s.showNextLine) { v -> set { it.copy(showNextLine = v) } }
    SwitchRow(R.string.show_artwork, s.showArtwork) { v -> set { it.copy(showArtwork = v) } }
    Choice(
        R.string.bg_style,
        listOf(BgStyle.SOLID to R.string.bg_solid, BgStyle.GRADIENT to R.string.bg_gradient, BgStyle.LIVE to R.string.bg_live, BgStyle.BLUR to R.string.bg_blur),
        s.bgStyle,
    ) { v -> set { it.copy(bgStyle = v) } }

    Header(R.string.s_behavior)
    Choice(R.string.on_pause, listOf(PauseBehavior.DIM to R.string.pause_dim, PauseBehavior.COMPACT to R.string.pause_compact, PauseBehavior.HIDE to R.string.pause_hide), s.pauseBehavior) { v ->
        set { it.copy(pauseBehavior = v) }
    }
    Choice(
        R.string.no_lyrics,
        listOf(NoLyricsBehavior.TITLE to R.string.no_lyrics_title, NoLyricsBehavior.COMPACT to R.string.no_lyrics_compact, NoLyricsBehavior.HIDE to R.string.no_lyrics_hide),
        s.noLyricsBehavior,
    ) { v -> set { it.copy(noLyricsBehavior = v) } }

    Header(R.string.s_position)
    SwitchRow(R.string.align_cutout, s.alignCutout) { v -> set { it.copy(alignCutout = v) } }
    Text("${stringResource(R.string.top_margin)}: ${s.topMarginDp}")
    Slider(s.topMarginDp.toFloat(), { v -> set { it.copy(topMarginDp = v.toInt()) } }, valueRange = 0f..120f)
    SwitchRow(R.string.hide_landscape, s.hideInLandscape) { v -> set { it.copy(hideInLandscape = v) } }

    Header(R.string.s_players)
    var blocked by remember(s.blockedApps) { mutableStateOf(s.blockedApps.joinToString("\n")) }
    OutlinedTextField(
        blocked,
        { blocked = it },
        label = { Text(stringResource(R.string.players_block)) },
        modifier = Modifier.fillMaxWidth(),
        minLines = 3,
    )
    OutlinedButton(onClick = { set { it.copy(blockedApps = blocked.lines().map(String::trim).filter(String::isNotEmpty)) } }) { Text(stringResource(R.string.done)) }
    if (s.detectedApps.isNotEmpty()) Text("${stringResource(R.string.detected)}: ${s.detectedApps.joinToString(", ")}", style = MaterialTheme.typography.bodySmall)

    Header(R.string.s_lyrics)
    SwitchRow(R.string.experimental_plain, s.experimentalPlain) { v -> set { it.copy(experimentalPlain = v) } }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { scope.launch { g.db.dao().clear(); note = doneText } }) { Text(stringResource(R.string.clear_cache)) }
        OutlinedButton(onClick = { scope.launch { g.db.dao().clearOffsets(); note = doneText } }) { Text(stringResource(R.string.clear_offsets)) }
    }

    Header(R.string.s_about)
    Text("LyricIsland ${BuildConfig.VERSION_NAME}")
    Text(stringResource(R.string.credits), style = MaterialTheme.typography.bodySmall)
    Text(stringResource(R.string.privacy), style = MaterialTheme.typography.bodySmall)
    OutlinedButton(onClick = {
        // Exportar logs (RF-44): se comparten como texto; nada sale del dispositivo sin acción del usuario.
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, AppLog.dump())
        ctx.startActivity(Intent.createChooser(send, exportTitle))
    }) { Text(stringResource(R.string.export_logs)) }
    if (note.isNotEmpty()) Text(note, color = MaterialTheme.colorScheme.primary)
    Spacer(Modifier.height(24.dp))
}
