package com.lyricisland.app.overlay

import android.content.Context
import android.graphics.Rect
import android.os.Build
import android.view.WindowManager

/** Rectángulo de la cámara frontal centrada en el borde superior, en px. */
data class CameraCutout(val rect: Rect, val screenWidth: Int)

object CutoutLocator {
    /** Lógica pura: elige el recorte superior y centrado (±15 % del ancho). Cámara en esquina o sin recorte → null. */
    fun pickTopCenter(rects: List<Rect>, screenWidth: Int): Rect? =
        rects.filter { it.top <= 0 || it.top < it.height() }
            .firstOrNull { kotlin.math.abs(it.centerX() - screenWidth / 2) <= screenWidth * 0.15 }

    fun locate(context: Context): CameraCutout? {
        val wm = context.getSystemService(WindowManager::class.java)
        if (Build.VERSION.SDK_INT >= 30) {
            val metrics = wm.currentWindowMetrics
            val cutout = metrics.windowInsets.displayCutout ?: return null
            val w = metrics.bounds.width()
            return pickTopCenter(cutout.boundingRects, w)?.let { CameraCutout(it, w) }
        }
        // API 28–29: sin WindowMetrics; el servicio usa el margen manual.
        return null
    }
}
