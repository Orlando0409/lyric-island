package com.lyricisland.app.ui.island

import android.os.SystemClock
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import com.lyricisland.app.R
import com.lyricisland.core.LyricsKind
import kotlinx.coroutines.delay
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.lyricisland.app.data.AppSettings
import com.lyricisland.core.IslandMode
import com.lyricisland.core.IslandSnapshot
import com.lyricisland.core.PlaybackStatus

/**
 * Burbuja (como las de Messenger): el servicio mueve la ventana; aquí solo se dibuja y se reportan los gestos.
 * `open`: ventana flotante con la letra abierta; `onRight`: lado de la pantalla; `dragging`: se está arrastrando.
 * `panelWidthDp`/`panelHeightDp`: tamaño de la ventana flotante (lo calcula el servicio para ubicarla en pantalla).
 */
class BubbleControls(
    val open: Boolean,
    val onRight: Boolean,
    val dragging: Boolean,
    val onDragStart: () -> Unit,
    val onDrag: (dx: Float, dy: Float) -> Unit,
    val onDragEnd: () -> Unit,
    val onToggleOpen: () -> Unit,
    val panelWidthDp: Float = 340f,
    val panelHeightDp: Float = 420f,
    val onPanelDrag: (dx: Float, dy: Float) -> Unit = { _, _ -> },
)

private val HEAD = 56.dp

/** Ancho FIJO de la línea al lado de la burbuja: la forma no cambia con cada línea (el texto largo se desplaza). */
private val PILL_WIDTH = 200.dp

@Composable
fun BubbleView(snap: IslandSnapshot, settings: AppSettings, artwork: ImageBitmap?, reducedMotion: Boolean, controls: BubbleControls) {
    val density = LocalDensity.current
    val cappedFont = minOf(density.fontScale, 1.3f)
    fun sp(base: Float): TextUnit = (base * settings.fontScale * cappedFont / density.fontScale).sp

    val colors = rememberIslandColors(snap, settings)
    val hidden = snap.mode == IslandMode.HIDDEN
    val alpha by animateFloatAsState(if (hidden) 0f else settings.maxOpacity, tween(200), label = "a")
    if (hidden && alpha == 0f) {
        Box(Modifier.size(1.dp)) // ventana mínima mientras está oculta
        return
    }
    val live = rememberUpdatedState(snap)
    if (controls.open) {
        FloatingLyricsPanel(snap, settings, artwork, reducedMotion, colors, live, controls, ::sp, Modifier.alpha(alpha).padding(8.dp))
        return
    }
    val lines = snap.lyrics?.lines.orEmpty()
    val current = lines.getOrNull(snap.activeLineIndex)?.takeIf { !it.isInterlude }
    val showPill = !controls.dragging && settings.bubbleShowLine && current != null && snap.mode == IslandMode.EXPANDED

    Row(
        Modifier.alpha(alpha).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (!controls.onRight) BubbleHead(snap, artwork, colors, controls)
        if (showPill && current != null) {
            // Línea actual al lado de la burbuja, con karaoke; tocarla abre la ventana flotante.
            Box(
                Modifier
                    .width(PILL_WIDTH)
                    .shadow(4.dp, RoundedCornerShape(18.dp))
                    .clip(RoundedCornerShape(18.dp))
                    .islandBackground(settings.bgStyle, colors.gradFrom, colors.gradTo, settings.gradientAngle, artwork, reducedMotion)
                    .pointerInput(Unit) { detectTapGestures(onTap = { controls.onToggleOpen() }) }
                    .padding(horizontal = 14.dp, vertical = 8.dp)
                    .testTag("bubble-line"),
            ) {
                KaraokeLine(current, live, reducedMotion, colors.sung, colors.upcoming, sp(14f), compact = true)
            }
        }
        if (controls.onRight) BubbleHead(snap, artwork, colors, controls)
    }
}

/**
 * Ventana flotante (como una app en ventana): encabezado para moverla y minimizarla, y toda la letra debajo,
 * con la línea actual en karaoke y desplazamiento automático (se pausa unos segundos si la desplazás a mano).
 */
@Composable
private fun FloatingLyricsPanel(
    snap: IslandSnapshot,
    settings: AppSettings,
    artwork: ImageBitmap?,
    reduced: Boolean,
    colors: IslandColors,
    live: State<IslandSnapshot>,
    controls: BubbleControls,
    sp: (Float) -> TextUnit,
    modifier: Modifier,
) {
    val shape = RoundedCornerShape(24.dp)
    Column(
        modifier
            .size(controls.panelWidthDp.dp, controls.panelHeightDp.dp)
            .shadow(12.dp, shape)
            .clip(shape)
            .islandBackground(settings.bgStyle, colors.gradFrom, colors.gradTo, settings.gradientAngle, artwork, reduced)
            .testTag("bubble-panel"),
    ) {
        // Encabezado: arrastrarlo mueve la ventana; "—" la vuelve burbuja.
        Row(
            Modifier
                .fillMaxWidth()
                .background(Color.Black.copy(alpha = 0.18f))
                .pointerInput(Unit) {
                    detectDragGestures { change, drag ->
                        change.consume()
                        controls.onPanelDrag(drag.x, drag.y)
                    }
                }
                .padding(start = 12.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(Modifier.requiredSize(40.dp).clip(RoundedCornerShape(8.dp))) {
                Artwork(artwork, 40.dp, show = true, accent = colors.accent)
            }
            Column(Modifier.weight(1f)) {
                Text(snap.track?.title.orEmpty(), color = colors.sung, fontSize = sp(15f), fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(snap.track?.artist.orEmpty(), color = colors.secondary, fontSize = sp(12f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Box(
                Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .pointerInput(Unit) { detectTapGestures(onTap = { controls.onToggleOpen() }) }
                    .testTag("bubble-minimize"),
                contentAlignment = Alignment.Center,
            ) {
                Text("—", color = colors.sung, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
        }
        PanelLyrics(snap, settings, reduced, colors, live, sp, Modifier.weight(1f).fillMaxWidth())
    }
}

/** Tras desplazar la letra a mano, vuelve sola a la línea actual pasado este tiempo. */
private const val FOLLOW_RESUME_MS = 4000L

@Composable
private fun PanelLyrics(
    snap: IslandSnapshot,
    settings: AppSettings,
    reduced: Boolean,
    colors: IslandColors,
    live: State<IslandSnapshot>,
    sp: (Float) -> TextUnit,
    modifier: Modifier,
) {
    val doc = snap.lyrics
    val lines = if (doc?.kind == LyricsKind.SYNCED) doc.lines else emptyList()
    val message = when {
        snap.track == null -> null
        snap.lyricsLoading && doc == null -> stringResource(R.string.panel_loading)
        doc?.kind == LyricsKind.PLAIN && !doc.plainText.isNullOrBlank() -> null
        lines.isEmpty() -> stringResource(R.string.panel_no_lyrics)
        else -> null
    }
    if (message != null) {
        Box(modifier.padding(16.dp), contentAlignment = Alignment.Center) { Text(message, color = colors.secondary, fontSize = sp(14f)) }
        return
    }
    if (doc?.kind == LyricsKind.PLAIN) {
        val plain = doc.plainText.orEmpty().lines()
        LazyColumn(modifier.testTag("bubble-lyrics"), contentPadding = PaddingValues(16.dp)) {
            items(plain.size) { i -> Text(plain[i].ifBlank { " " }, color = colors.sung, fontSize = sp(16f), fontWeight = FontWeight.SemiBold) }
        }
        return
    }

    val state = rememberLazyListState()
    val dragged by state.interactionSource.collectIsDraggedAsState()
    var lastUserScroll by remember { mutableLongStateOf(0L) }
    LaunchedEffect(dragged) { if (dragged) lastUserScroll = SystemClock.uptimeMillis() }
    val active = snap.activeLineIndex
    // La línea actual queda como segunda visible (se ve la anterior arriba y lo que viene abajo).
    LaunchedEffect(active, lines) {
        while (SystemClock.uptimeMillis() - lastUserScroll < FOLLOW_RESUME_MS) delay(500)
        val target = (active - 1).coerceAtLeast(0)
        if (reduced) state.scrollToItem(target) else state.animateScrollToItem(target)
    }
    LazyColumn(
        modifier.testTag("bubble-lyrics"),
        state = state,
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 160.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(lines.size, key = { it }) { i ->
            val line = lines[i]
            when {
                line.isInterlude -> Text("♪", color = colors.accent, fontSize = sp(18f))
                i == active -> Column {
                    KaraokeLine(line, live, reduced, colors.sung, colors.upcoming, sp(19f))
                    if (settings.showRomaji && line.romaji != null) {
                        Text(line.romaji.orEmpty(), color = colors.secondary, fontSize = sp(13f), fontStyle = FontStyle.Italic)
                    }
                }
                else -> Column(Modifier.alpha(if (i < active) 0.55f else 1f)) {
                    Text(line.text, color = if (i < active) colors.sung else colors.upcoming, fontSize = sp(17f), fontWeight = FontWeight.SemiBold)
                    if (settings.showRomaji && line.romaji != null) {
                        Text(line.romaji.orEmpty(), color = colors.secondary, fontSize = sp(12f), fontStyle = FontStyle.Italic)
                    }
                }
            }
        }
    }
}

/** Cabeza de la burbuja: carátula en círculo con un anillo del avance de la canción. Se toca o se arrastra. */
@Composable
private fun BubbleHead(snap: IslandSnapshot, artwork: ImageBitmap?, colors: IslandColors, controls: BubbleControls) {
    val duration = snap.track?.durationMs?.takeIf { it > 0 }
    val progress = if (duration != null) (snap.positionMs / duration).toFloat().coerceIn(0f, 1f) else 0f
    val dim = if (snap.status == PlaybackStatus.PLAYING) 1f else 0.7f
    Box(
        Modifier
            .requiredSize(HEAD) // siempre un círculo del mismo tamaño, sin importar el texto de al lado
            .alpha(dim)
            .shadow(6.dp, CircleShape)
            .clip(CircleShape)
            .background(colors.bg)
            .pointerInput(Unit) { detectTapGestures(onTap = { controls.onToggleOpen() }) }
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { controls.onDragStart() },
                    onDragEnd = { controls.onDragEnd() },
                    onDragCancel = { controls.onDragEnd() },
                ) { change, drag ->
                    change.consume()
                    controls.onDrag(drag.x, drag.y)
                }
            }
            .testTag("bubble"),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.requiredSize(HEAD - 8.dp).clip(CircleShape), contentAlignment = Alignment.Center) {
            Artwork(artwork, HEAD - 8.dp, show = true, accent = colors.accent)
        }
        Canvas(Modifier.fillMaxSize()) {
            val stroke = 3.dp.toPx()
            val inset = stroke / 2
            val arcSize = androidx.compose.ui.geometry.Size(size.width - stroke, size.height - stroke)
            val topLeft = androidx.compose.ui.geometry.Offset(inset, inset)
            drawArc(Color.White.copy(alpha = 0.18f), 0f, 360f, false, topLeft, arcSize, style = Stroke(stroke))
            drawArc(colors.accent, -90f, 360f * progress, false, topLeft, arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
        }
        if (snap.status != PlaybackStatus.PLAYING && snap.track != null) {
            Text("❚❚", color = Color.White, fontSize = 12.sp, modifier = Modifier.background(Color.Black.copy(alpha = 0.45f), CircleShape).padding(4.dp))
        }
    }
}

/** Blanco para descartar la burbuja (abajo al centro, mientras se arrastra). */
@Composable
fun BubbleDismissTarget(visible: Boolean, near: Boolean) {
    val scale by animateFloatAsState(if (near) 1.25f else 1f, tween(120), label = "s")
    val a by animateFloatAsState(if (visible) 1f else 0f, tween(150), label = "a")
    Box(Modifier.padding(24.dp).size(64.dp * scale).alpha(a).clip(CircleShape).background(Color.Black.copy(alpha = if (near) 0.75f else 0.5f)), contentAlignment = Alignment.Center) {
        Text("✕", color = Color.White, fontSize = 24.sp)
    }
}
