package com.lyricisland.app.ui.island

import android.os.Build
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.basicMarquee
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.ResolvedTextDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.Canvas
import androidx.compose.ui.unit.sp
import com.lyricisland.app.R
import com.lyricisland.app.data.AppSettings
import com.lyricisland.app.data.BgStyle
import com.lyricisland.core.ColorEngine
import com.lyricisland.core.IslandController
import com.lyricisland.core.IslandMode
import com.lyricisland.core.IslandSnapshot
import com.lyricisland.core.LyricLine
import com.lyricisland.core.PlaybackStatus
import com.lyricisland.core.Romaji
import kotlinx.coroutines.delay
import kotlin.math.abs
import kotlin.math.roundToInt

/** Geometría de la pantalla para colocar la isla alrededor de la cámara (12.7). */
data class IslandGeometry(
    val screenWidthDp: Float = 400f,
    val cutoutWidthDp: Float? = null,
    val cutoutHeightDp: Float? = null,
)

private fun hex(c: String) = Color(ColorEngine.toArgb(c).toInt())

/** Conecta el controlador con Compose y corre el bucle de frames solo cuando hace falta (8.5.7). */
@Composable
fun IslandOverlay(
    controller: IslandController,
    settings: AppSettings,
    artwork: ImageBitmap?,
    geometry: IslandGeometry,
    screenOn: Boolean,
    powerSave: Boolean,
    reducedMotion: Boolean,
    onTap: () -> Unit,
    onSwipeUp: () -> Unit,
    onOffset: (Int) -> Unit,
    onHide: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    var snap by remember { mutableStateOf(controller.snapshot()) }
    var version by remember { mutableIntStateOf(0) }
    DisposableEffect(controller) {
        val off = controller.subscribe { version++ }
        onDispose { off() }
    }
    LaunchedEffect(version, screenOn, powerSave) {
        snap = controller.snapshot()
        // En pausa, con la isla oculta o con la pantalla apagada el bucle se detiene (0 frames).
        while (screenOn && controller.needsAnimation()) {
            if (powerSave) delay(33) else withFrameMillis { }
            snap = controller.snapshot()
        }
    }
    IslandView(snap, settings, artwork, geometry, reducedMotion, onTap, onSwipeUp, onOffset, onHide, onOpenSettings)
}

@Composable
fun IslandView(
    snap: IslandSnapshot,
    settings: AppSettings,
    artwork: ImageBitmap?,
    geometry: IslandGeometry,
    reducedMotion: Boolean,
    onTap: () -> Unit = {},
    onSwipeUp: () -> Unit = {},
    onOffset: (Int) -> Unit = {},
    onHide: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
) {
    val density = LocalDensity.current
    // Respeta fontScale del sistema con un tope de 1.3 para no romper la isla (10.4).
    val cappedFont = minOf(density.fontScale, 1.3f)
    fun sp(base: Float): TextUnit = (base * settings.fontScale * cappedFont / density.fontScale).sp

    val expanded = snap.mode == IslandMode.EXPANDED || snap.mode == IslandMode.PAUSED
    val hidden = snap.mode == IslandMode.HIDDEN
    val cw = geometry.cutoutWidthDp
    val ch = geometry.cutoutHeightDp
    val targetW: Dp = when {
        expanded -> (geometry.screenWidthDp - 24f).dp
        cw != null -> (cw + 2 * 56f).dp
        else -> 220.dp
    }
    // EXPANDED "se derrama hacia abajo" (10.3): la cámara queda dentro de la franja superior y el texto debajo.
    val cameraInset: Dp = if (expanded && ch != null) (ch + 8f).dp else 0.dp
    val targetH: Dp = when {
        expanded -> (88f * minOf(settings.fontScale, 1.4f)).dp + cameraInset
        ch != null -> (ch + 8f).dp
        else -> 34.dp
    }
    val anim = if (reducedMotion) snap() else spring<Dp>(dampingRatio = 0.77f, stiffness = 380f)
    val w by animateDpAsState(if (hidden) targetW * 0.85f else targetW, anim, label = "w")
    val h by animateDpAsState(if (hidden) targetH * 0.85f else targetH, anim, label = "h")
    val radius by animateDpAsState(if (expanded) 28.dp else targetH / 2, anim, label = "r")
    val alpha by animateFloatAsState(if (hidden) 0f else settings.maxOpacity, tween(200), label = "a")

    val bg by animateColorAsState(hex(snap.palette.background), tween(600, easing = FastOutSlowInEasing), label = "bg")
    val bgAlt by animateColorAsState(hex(snap.palette.backgroundAlt), tween(600, easing = FastOutSlowInEasing), label = "bgAlt")
    val accent by animateColorAsState(hex(snap.palette.accent), tween(600), label = "accent")
    val sung = hex(snap.palette.textPrimary)
    val upcoming = hex(snap.palette.textUpcoming)
    val secondary = hex(snap.palette.textSecondary)

    var panel by remember { mutableStateOf(false) }

    if (hidden && alpha == 0f) {
        Box(Modifier.size(1.dp)) // ventana mínima mientras está oculta
        return
    }

    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .testTag("island")
                .width(w)
                .height(h)
                .alpha(alpha)
                .clip(RoundedCornerShape(radius))
                .islandBackground(settings.bgStyle, bg, bgAlt, artwork, reducedMotion)
                .pointerInput(Unit) {
                    detectTapGestures(onTap = { onTap() }, onLongPress = { panel = !panel })
                }
                .pointerInput(Unit) {
                    var dx = 0f
                    var dy = 0f
                    val step = 40.dp.toPx()
                    detectDragGestures(
                        onDragStart = { dx = 0f; dy = 0f },
                        onDragEnd = {
                            if (dy < -step && abs(dy) > abs(dx)) onSwipeUp()
                            else if (abs(dx) >= step) onOffset((dx / step).toInt())
                        },
                    ) { change, drag ->
                        change.consume()
                        dx += drag.x
                        dy += drag.y
                    }
                },
        ) {
            if (expanded) {
                ExpandedContent(snap, settings, artwork, reducedMotion, sung, upcoming, secondary, accent, ::sp, cameraInset)
            } else {
                CompactContent(snap, settings, artwork, accent, sung, cw, ::sp)
            }
            snap.offsetFlash?.let {
                Text(
                    it,
                    color = sung,
                    fontSize = sp(11f),
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.align(Alignment.TopCenter).padding(top = 2.dp)
                        .background(Color.Black.copy(alpha = 0.45f), RoundedCornerShape(8.dp)).padding(horizontal = 8.dp),
                )
            }
        }
        if (panel) QuickPanel(snap, bg, sung, onOffset, onHide = { panel = false; onHide() }, onOpenSettings = { panel = false; onOpenSettings() })
    }
}

@Composable
private fun Modifier.islandBackground(style: BgStyle, bg: Color, bgAlt: Color, artwork: ImageBitmap?, reduced: Boolean): Modifier = when (style) {
    BgStyle.SOLID -> background(bg)
    BgStyle.GRADIENT -> background(Brush.linearGradient(listOf(bg, bgAlt)))
    BgStyle.LIVE -> if (reduced) background(Brush.linearGradient(listOf(bg, bgAlt))) else this.then(Modifier.liveGradient(bg, bgAlt))
    // Carátula difuminada: la imagen con blur (RenderEffect, API 31+) se dibuja encima en ExpandedContent;
    // debajo (y en versiones anteriores) queda el degradado.
    BgStyle.BLUR -> background(Brush.linearGradient(listOf(bg, bgAlt)))
}

@Composable
private fun Modifier.liveGradient(bg: Color, bgAlt: Color): Modifier {
    val t = rememberInfiniteTransition(label = "live")
    val shift by t.animateFloat(0f, 1f, infiniteRepeatable(tween(20_000, easing = LinearEasing), RepeatMode.Reverse), label = "shift")
    return drawWithContent {
        val x = size.width * shift
        drawRect(Brush.linearGradient(listOf(bg, bgAlt, bg), start = Offset(x - size.width, 0f), end = Offset(x + size.width, size.height)))
        drawContent()
    }
}

@Composable
private fun Artwork(artwork: ImageBitmap?, size: Dp, show: Boolean, accent: Color) {
    if (!show) return
    if (artwork != null) {
        Image(artwork, null, Modifier.size(size).clip(CircleShape), contentScale = ContentScale.Crop)
    } else {
        Box(Modifier.size(size).clip(CircleShape).background(Color.White.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            Text("♪", color = accent, fontSize = (size.value * 0.45f).sp)
        }
    }
}

@Composable
private fun CompactContent(snap: IslandSnapshot, settings: AppSettings, artwork: ImageBitmap?, accent: Color, text: Color, cutoutW: Float?, sp: (Float) -> TextUnit) {
    Row(
        Modifier.fillMaxSize().padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Artwork(artwork, 22.dp, settings.showArtwork, accent)
        // Con cámara en el centro, el título quedaría tapado: se reserva el hueco del recorte.
        if (snap.showTitle && cutoutW == null) {
            val title = listOfNotNull(snap.track?.title, snap.track?.artist?.takeIf { it.isNotBlank() }).joinToString(" — ")
            Text(title, color = text, fontSize = sp(13f), fontWeight = FontWeight.Medium, maxLines = 1, modifier = Modifier.weight(1f).basicMarquee().testTag("title"))
        } else {
            Spacer(Modifier.weight(1f))
        }
        Equalizer(snap.status == PlaybackStatus.PLAYING, accent)
    }
}

@Composable
private fun Equalizer(playing: Boolean, color: Color) {
    val t = rememberInfiniteTransition(label = "eq")
    val durations = listOf(900, 1270, 730)
    val heights = durations.mapIndexed { i, d ->
        t.animateFloat(0.25f, 1f, infiniteRepeatable(tween(d, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "eq$i")
    }
    // Se congelan en pausa (no es un análisis real del audio: no se captura audio).
    val frozen = remember { floatArrayOf(0.5f, 0.8f, 0.35f) }
    Row(Modifier.height(14.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
        heights.forEachIndexed { i, hState ->
            val v = if (playing) hState.value.also { frozen[i] = it } else frozen[i]
            Box(Modifier.width(3.dp).fillMaxHeight(v).clip(RoundedCornerShape(2.dp)).background(color))
        }
    }
}

@Composable
private fun ExpandedContent(
    snap: IslandSnapshot,
    settings: AppSettings,
    artwork: ImageBitmap?,
    reduced: Boolean,
    sung: Color,
    upcoming: Color,
    secondary: Color,
    accent: Color,
    sp: (Float) -> TextUnit,
    cameraInset: Dp,
) {
    val lines = snap.lyrics?.lines.orEmpty()
    val active = lines.getOrNull(snap.activeLineIndex)
    val showInterlude = snap.interlude != null || active?.isInterlude == true
    // Antes de la primera línea: con interludio la siguiente es la 1.ª; sin él, la 1.ª ya está arriba.
    val next = if (snap.activeLineIndex < 0) lines.filter { !it.isInterlude }.getOrNull(if (showInterlude) 0 else 1) else lines.getOrNull(snap.activeLineIndex + 1)
    val dim = if (snap.mode == IslandMode.PAUSED) 0.5f else 1f
    // El avance del karaoke se lee al dibujar desde este State: así se redibuja en cada frame aunque
    // AnimatedContent no vuelva a componer su contenido (antes la línea se quedaba sin rellenar).
    val live = rememberUpdatedState(snap)
    Box(Modifier.fillMaxSize()) {
        if (settings.bgStyle == BgStyle.BLUR && artwork != null && Build.VERSION.SDK_INT >= 31) {
            Image(artwork, null, Modifier.fillMaxSize().blur(40.dp), contentScale = ContentScale.Crop)
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)))
        }
        Row(
            Modifier.fillMaxSize().padding(start = 16.dp, end = 18.dp, top = cameraInset),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Artwork(artwork, 32.dp, settings.showArtwork, accent)
            Column(Modifier.weight(1f).alpha(dim), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                AnimatedContent(
                    targetState = snap.activeLineIndex to showInterlude,
                    transitionSpec = {
                        if (reduced) fadeIn(snap()) togetherWith fadeOut(snap())
                        else (slideInVertically(tween(220)) { it / 3 } + fadeIn(tween(220))) togetherWith
                            (slideOutVertically(tween(180)) { -it / 4 } + fadeOut(tween(180)))
                    },
                    label = "line",
                ) { (index, interlude) ->
                    val line = lines.getOrNull(index)
                    when {
                        interlude -> Interlude(snap.interlude?.progress ?: 0.0, accent, sp)
                        line != null && !line.isInterlude -> KaraokeLine(line, live, reduced, sung, upcoming, sp(17f))
                        else -> Text(
                            lines.firstOrNull { !it.isInterlude }?.text ?: snap.track?.title.orEmpty(),
                            color = upcoming, fontSize = sp(17f), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                // Canción en japonés: romaji de la línea de arriba en lugar de la siguiente.
                val topLine = if (showInterlude) null else active?.takeIf { !it.isInterlude } ?: if (snap.activeLineIndex < 0) lines.firstOrNull { !it.isInterlude } else null
                if (topLine?.romaji != null && settings.showRomaji) {
                    RomajiLine(topLine, isCurrent = topLine === active, live, reduced, sung, secondary, sp(13f))
                } else if (settings.showNextLine) {
                    Text(next?.text.orEmpty(), color = secondary, fontSize = sp(13f), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.testTag("next-line"))
                }
            }
        }
        if (snap.mode == IslandMode.PAUSED) Text("❚❚", color = secondary, fontSize = sp(11f), modifier = Modifier.align(Alignment.BottomEnd).padding(end = 14.dp, bottom = 8.dp))
        if (snap.estimatedLines) Text("≈", color = secondary, fontSize = sp(12f), modifier = Modifier.align(Alignment.BottomEnd).padding(end = 36.dp, bottom = 8.dp))
    }
}

@Composable
private fun Interlude(progress: Double, accent: Color, sp: (Float) -> TextUnit) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.testTag("interlude")) {
        Text("♪", color = accent, fontSize = sp(17f))
        for (i in 0..2) {
            val d = (progress * 3 - i).coerceIn(0.0, 1.0).toFloat()
            Text("•", color = accent.copy(alpha = 0.25f + 0.75f * d), fontSize = sp(17f * (0.8f + 0.3f * d)))
        }
    }
}

/** Cómo entra una línea: en un renglón, partida en dos (letra un 10 % menor) o desplazándose (RF-31). */
internal enum class LineFit { SINGLE, WRAP, SCROLL }

/**
 * Relleno karaoke (10.5): el texto se mide con TextMeasurer y se dibuja dos veces (pendiente y cantado); el
 * cantado se recorta renglón por renglón hasta la posición de la palabra actual. Las líneas largas se parten en
 * dos renglones; si ni así entran, se desplazan siguiendo a la palabra que se canta (siempre visible).
 * Con movimiento reducido se rellena por palabras enteras, sin barrido.
 */
@Composable
private fun KaraokeLine(line: LyricLine, live: State<IslandSnapshot>, reduced: Boolean, sung: Color, upcoming: Color, textSize: TextUnit) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxWidth().clipToBounds().testTag("current-line")) {
        val maxW = constraints.maxWidth
        val base = TextStyle(fontSize = textSize, fontWeight = FontWeight.SemiBold)
        val small = base.copy(fontSize = textSize * 0.9f)
        val (fit, layout) = remember(line.text, maxW, textSize) {
            val single = measurer.measure(line.text, base, maxLines = 1, softWrap = false)
            when {
                single.size.width <= maxW -> LineFit.SINGLE to single
                else -> {
                    val wrapped = measurer.measure(line.text, small, maxLines = 2, softWrap = true, constraints = Constraints(maxWidth = maxW))
                    if (!wrapped.hasVisualOverflow) LineFit.WRAP to wrapped else LineFit.SCROLL to single
                }
            }
        }

        Canvas(Modifier.fillMaxWidth().height(with(density) { layout.size.height.toDp() }).semantics { contentDescription = line.text }.testTag(fit.name)) {
            // Se lee el avance aquí (fase de dibujo): cada frame redibuja sin recomponer.
            val s = live.value
            val fill = karaokeFill(line, layout, s.wordIndex, if (reduced) 1.0 else s.wordProgress)
            val overflow = (layout.size.width - maxW).toFloat().coerceAtLeast(0f)
            val shift = when {
                fit != LineFit.SCROLL -> 0f
                fill != null -> (fill.second - maxW * 0.35f).coerceIn(0f, overflow)
                else -> overflow
            }
            translate(left = -shift) {
                drawText(layout, color = upcoming)
                for (row in 0 until layout.lineCount) {
                    val top = layout.getLineTop(row)
                    val bottom = layout.getLineBottom(row)
                    val right = when {
                        fill == null || row < fill.first -> layout.size.width.toFloat()
                        row == fill.first -> fill.second
                        else -> continue
                    }
                    clipRect(left = 0f, top = top, right = right, bottom = bottom) { drawText(layout, color = sung) }
                }
            }
        }
    }
}

/** Posición del relleno de lo cantado: renglón y x; null = línea completa. */
private fun karaokeFill(line: LyricLine, layout: TextLayoutResult, wordIndex: Int, wordProgress: Double): Pair<Int, Float>? {
    if (line.words.isEmpty()) return null
    if (wordIndex >= line.words.size - 1 && wordProgress >= 1.0) return null
    if (wordIndex < 0) return 0 to 0f
    var offset = 0
    for ((i, w) in line.words.withIndex()) {
        val start = offset.coerceAtMost(line.text.length)
        val end = (offset + w.text.length).coerceAtMost(line.text.length)
        offset = end
        if (i < wordIndex) continue
        val row = layout.getLineForOffset(start)
        val x0 = layout.getHorizontalPosition(start, true)
        val x1 = if (layout.getLineForOffset(maxOf(start, end - 1)) == row) layout.getHorizontalPosition(end, true) else layout.getLineRight(row)
        return row to (x0 + (x1 - x0) * wordProgress.toFloat())
    }
    return null
}

/**
 * Romaji debajo de la línea japonesa, con el mismo relleno karaoke: avanza al mismo punto que lo cantado del
 * original (Romaji.romajiFill). Si no entra, se desplaza siguiendo al relleno.
 */
@Composable
private fun RomajiLine(line: LyricLine, isCurrent: Boolean, live: State<IslandSnapshot>, reduced: Boolean, sung: Color, secondary: Color, textSize: TextUnit) {
    val text = line.romaji.orEmpty()
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxWidth().clipToBounds()) {
        val maxW = constraints.maxWidth
        val layout = remember(text, textSize) {
            measurer.measure(text, TextStyle(fontSize = textSize, fontStyle = FontStyle.Italic), maxLines = 1, softWrap = false)
        }
        Canvas(Modifier.fillMaxWidth().height(with(density) { layout.size.height.toDp() }).semantics { contentDescription = text }.testTag("romaji-line")) {
            val s = live.value
            val fraction = if (isCurrent) Romaji.romajiFill(line, s.wordIndex, if (reduced) 1.0 else s.wordProgress).toFloat() else 0f
            val x = layout.size.width * fraction
            val shift = (x - maxW * 0.35f).coerceIn(0f, (layout.size.width - maxW).toFloat().coerceAtLeast(0f))
            translate(left = -shift) {
                drawText(layout, color = secondary)
                if (x > 0f) clipRect(left = 0f, top = 0f, right = x, bottom = layout.size.height.toFloat()) { drawText(layout, color = sung) }
            }
        }
    }
}

@Composable
private fun QuickPanel(snap: IslandSnapshot, bg: Color, text: Color, onOffset: (Int) -> Unit, onHide: () -> Unit, onOpenSettings: () -> Unit) {
    Row(
        Modifier.padding(top = 6.dp).clip(RoundedCornerShape(18.dp)).background(bg).padding(horizontal = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.quick_offset) + " " + IslandController.formatOffset(snap.userOffsetMs), color = text, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 6.dp))
        TextButton(onClick = { onOffset(-1) }) { Text("−100", color = text) }
        TextButton(onClick = { onOffset(1) }) { Text("+100", color = text) }
        TextButton(onClick = onHide) { Text(stringResource(R.string.action_hide), color = text) }
        TextButton(onClick = onOpenSettings) { Text("⚙", color = text) }
    }
}
