package com.lyricisland.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
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
import androidx.compose.material3.TextButton
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
import androidx.core.net.toUri
import androidx.lifecycle.lifecycleScope
import com.lyricisland.app.data.AppSettings
import com.lyricisland.app.data.BgStyle
import com.lyricisland.app.overlay.IslandOverlayService
import com.lyricisland.core.NoLyricsBehavior
import com.lyricisland.core.PauseBehavior
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Pantalla principal. "Activar isla" verifica los permisos y pide, uno por uno y con una explicación (RF-42),
 * los que falten; cuando están todos arranca la isla. Si la isla estaba activa y algún permiso se revocó,
 * se vuelven a pedir al abrir la app (o al tocar la notificación del servicio).
 */
class MainActivity : ComponentActivity() {
    companion object {
        const val EXTRA_ENABLE_ISLAND = "enableIsland"
        const val EXTRA_REQUEST_PERMISSIONS = "requestPermissions"
    }

    private val notifPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { onReturnFromRequest() }
    private var recheck by mutableIntStateOf(0)

    // Estado del flujo de permisos.
    private var flowActive = false
    private var asked: Perm? = null
    private var dialogPerm by mutableStateOf<Perm?>(null)
    private var deniedPerm by mutableStateOf<Perm?>(null)
    private var autoAsked = false

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Solo debug: la matriz de emuladores (android/tools/run-matrix.sh) activa la isla sin tocar la UI.
        if (BuildConfig.DEBUG && intent.getBooleanExtra(EXTRA_ENABLE_ISLAND, false)) {
            lifecycleScope.launch { graph.settings.update { it.copy(enabled = true) } }
        }
        if (intent.getBooleanExtra(EXTRA_REQUEST_PERMISSIONS, false)) startIslandFlow()
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFFB69DF8))) {
                Surface(Modifier.fillMaxSize()) {
                    MainScreen(
                        recheckKey = recheck,
                        deniedPerm = deniedPerm,
                        onEnable = ::startIslandFlow,
                        onDisable = ::disableIsland,
                    )
                    dialogPerm?.let { p ->
                        PermissionDialog(
                            perm = p,
                            remaining = Permissions.missing(this).size,
                            onContinue = ::confirmDialog,
                            onCancel = ::cancelFlow,
                        )
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(EXTRA_REQUEST_PERMISSIONS, false)) startIslandFlow()
    }

    override fun onResume() {
        super.onResume()
        recheck++ // al volver de una pantalla del sistema se re-evalúan los permisos
        onReturnFromRequest()
        // La isla estaba activa pero se quitó algún permiso: se vuelven a pedir (una vez por apertura).
        if (!flowActive && !autoAsked) {
            lifecycleScope.launch {
                if (graph.settings.settings.first().enabled && Permissions.missing(this@MainActivity).isNotEmpty()) {
                    autoAsked = true
                    startIslandFlow()
                }
            }
        }
    }

    private fun startIslandFlow() {
        flowActive = true
        deniedPerm = null
        nextStep()
    }

    private fun nextStep() {
        val missing = Permissions.missing(this).firstOrNull()
        if (missing == null) {
            flowActive = false
            lifecycleScope.launch {
                graph.settings.update { it.copy(enabled = true) }
                IslandOverlayService.start(this@MainActivity)
            }
            return
        }
        dialogPerm = missing
    }

    private fun confirmDialog() {
        val p = dialogPerm ?: return
        dialogPerm = null
        asked = p
        if (p == Perm.NOTIFICATIONS && Build.VERSION.SDK_INT >= 33 && !notificationsDeniedBefore()) {
            markNotificationsAsked()
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else if (!Permissions.openSettings(this, p)) {
            onReturnFromRequest()
        }
    }

    /** Al volver de la pantalla del sistema (o del diálogo): si se concedió, sigue con el próximo permiso. */
    private fun onReturnFromRequest() {
        val p = asked ?: return
        if (!flowActive) return
        asked = null
        if (Permissions.isGranted(this, p)) {
            nextStep()
        } else {
            flowActive = false
            deniedPerm = p
        }
    }

    private fun cancelFlow() {
        dialogPerm = null
        asked = null
        flowActive = false
    }

    private fun disableIsland() {
        lifecycleScope.launch {
            graph.settings.update { it.copy(enabled = false) }
            IslandOverlayService.stop(this@MainActivity)
        }
    }

    // Android solo muestra el diálogo de notificaciones un par de veces; después hay que ir a Ajustes.
    private val permPrefs get() = getSharedPreferences("permissions", MODE_PRIVATE)
    private fun markNotificationsAsked() = permPrefs.edit().putBoolean("notifAsked", true).apply()
    private fun notificationsDeniedBefore() =
        permPrefs.getBoolean("notifAsked", false) && !shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)
}

@Composable
private fun PermissionDialog(perm: Perm, remaining: Int, onContinue: () -> Unit, onCancel: () -> Unit) {
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(stringResource(perm.title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(perm.why))
                if (remaining > 1) Text(stringResource(R.string.perm_remaining, remaining), style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(onClick = onContinue) { Text(stringResource(R.string.perm_continue)) } },
        dismissButton = { TextButton(onClick = onCancel) { Text(stringResource(R.string.perm_not_now)) } },
    )
}

@Composable
private fun MainScreen(recheckKey: Int, deniedPerm: Perm?, onEnable: () -> Unit, onDisable: () -> Unit) {
    val ctx = LocalContext.current
    val g = ctx.graph
    val scope = rememberCoroutineScope()
    val settings by g.settings.settings.collectAsState(initial = AppSettings())
    val missing = remember(recheckKey) { Permissions.missing(ctx) }
    fun set(transform: (AppSettings) -> AppSettings) = scope.launch { g.settings.update(transform) }

    // Si el sistema mató el servicio (reinstalación, ahorro agresivo de algunos fabricantes) pero la isla
    // estaba activa y los permisos siguen, se relanza al abrir la app (en primer plano está permitido, 12.8).
    LaunchedEffect(settings.enabled, missing) {
        if (settings.enabled && missing.isEmpty() && !IslandOverlayService.running) IslandOverlayService.start(ctx)
    }
    val active = settings.enabled && missing.isEmpty()

    Column(
        Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.onboarding_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.onboarding_intro), style = MaterialTheme.typography.bodyMedium)

        Button(modifier = Modifier.fillMaxWidth(), onClick = { if (active) onDisable() else onEnable() }) {
            Text(stringResource(if (active) R.string.stop_island else R.string.start_island))
        }
        deniedPerm?.let {
            Text(stringResource(R.string.perm_denied, stringResource(it.title)), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        SettingsSection(settings) { t -> set(t) }
    }
}

@Composable
private fun BatteryOptimizationButton() {
    val ctx = LocalContext.current
    val ignoring = remember { ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName) }
    if (ignoring) return
    Text(stringResource(R.string.perm_battery_why), style = MaterialTheme.typography.bodySmall)
    OutlinedButton(onClick = {
        @SuppressLint("BatteryLife")
        val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, "package:${ctx.packageName}".toUri())
        runCatching { ctx.startActivity(i) }.onFailure { ctx.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
    }) { Text(stringResource(R.string.perm_battery)) }
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

    BatteryOptimizationButton()

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
    Text("${stringResource(R.string.lead_ms)}: ${s.leadMs} ms")
    Slider(s.leadMs.toFloat(), { v -> set { it.copy(leadMs = (v / 25).toLong() * 25) } }, valueRange = 0f..600f)
    Text(stringResource(R.string.lead_hint), style = MaterialTheme.typography.bodySmall)
    SwitchRow(R.string.show_romaji, s.showRomaji) { v -> set { it.copy(showRomaji = v) } }
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
