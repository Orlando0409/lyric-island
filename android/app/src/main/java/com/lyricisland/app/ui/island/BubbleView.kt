package com.lyricisland.app.ui.island

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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
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
 * `open`: tarjeta con la letra abierta; `onRight`: lado de la pantalla; `dragging`: se está arrastrando.
 */
class BubbleControls(
    val open: Boolean,
    val onRight: Boolean,
    val dragging: Boolean,
    val onDragStart: () -> Unit,
    val onDrag: (dx: Float, dy: Float) -> Unit,
    val onDragEnd: () -> Unit,
    val onToggleOpen: () -> Unit,
)

private val HEAD = 56.dp

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
    val lines = snap.lyrics?.lines.orEmpty()
    val current = lines.getOrNull(snap.activeLineIndex)?.takeIf { !it.isInterlude }
    val showPill = !controls.open && !controls.dragging && settings.bubbleShowLine && current != null && snap.mode == IslandMode.EXPANDED

    Column(
        Modifier.alpha(alpha).padding(8.dp).then(if (controls.open) Modifier.fillMaxWidth() else Modifier),
        horizontalAlignment = if (controls.onRight) Alignment.End else Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!controls.onRight) BubbleHead(snap, artwork, colors, controls)
            if (showPill && current != null) {
                // Línea actual al lado de la burbuja, con karaoke; tocarla abre la tarjeta.
                Box(
                    Modifier
                        .shadow(4.dp, RoundedCornerShape(18.dp))
                        .clip(RoundedCornerShape(18.dp))
                        .islandBackground(settings.bgStyle, colors.gradFrom, colors.gradTo, settings.gradientAngle, artwork, reducedMotion)
                        .pointerInput(Unit) { detectTapGestures(onTap = { controls.onToggleOpen() }) }
                        .padding(horizontal = 14.dp, vertical = 8.dp)
                        .widthIn(max = 240.dp)
                        .testTag("bubble-line"),
                ) {
                    KaraokeLine(current, live, reducedMotion, colors.sung, colors.upcoming, sp(14f), compact = true)
                }
            }
            if (controls.onRight) BubbleHead(snap, artwork, colors, controls)
        }
        if (controls.open) {
            // Tarjeta con la letra (la misma vista que la isla expandida); tocarla la cierra.
            Box(
                Modifier
                    .fillMaxWidth()
                    .height((88f * minOf(settings.fontScale, 1.4f)).dp)
                    .shadow(8.dp, RoundedCornerShape(24.dp))
                    .clip(RoundedCornerShape(24.dp))
                    .islandBackground(settings.bgStyle, colors.gradFrom, colors.gradTo, settings.gradientAngle, artwork, reducedMotion)
                    .pointerInput(Unit) { detectTapGestures(onTap = { controls.onToggleOpen() }) }
                    .testTag("bubble-card"),
            ) {
                ExpandedContent(snap, settings, artwork, reducedMotion, colors.sung, colors.upcoming, colors.secondary, colors.accent, ::sp, 0.dp)
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
            .size(HEAD)
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
        Box(Modifier.size(HEAD - 8.dp).clip(CircleShape), contentAlignment = Alignment.Center) {
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
