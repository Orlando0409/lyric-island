package com.lyricisland.app.overlay

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.WindowManager

/**
 * Ventana overlay. Mide SOLO lo que mide la isla (WRAP_CONTENT en ambos ejes), así no tapa nada más:
 * cuando Compose cambia el tamaño de la isla, WindowManager re-dimensiona la ventana.
 * En modo burbuja la ventana se mueve libremente (gravity START/END + x, y).
 */
class OverlayWindowController(context: Context, gravity: Int = Gravity.TOP or Gravity.CENTER_HORIZONTAL, extraFlags: Int = 0) {
    private val wm = context.getSystemService(WindowManager::class.java)
    private var view: View? = null

    val params = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED or
            extraFlags,
        PixelFormat.TRANSLUCENT,
    ).apply {
        this.gravity = gravity
        title = "LyricIsland"
        if (Build.VERSION.SDK_INT >= 28) {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
    }

    val isShown get() = view != null

    /** Tamaño actual de la vista (px); 0 si todavía no se midió. */
    val width get() = view?.width ?: 0
    val height get() = view?.height ?: 0

    fun show(v: View) {
        if (view != null) return
        wm.addView(v, params)
        view = v
    }

    fun setTopOffset(px: Int) {
        if (params.y == px) return
        params.y = px
        update()
    }

    /** Posición libre: `gravity` (p. ej. TOP|START o TOP|END), x desde ese borde, y desde arriba; `fullWidth` ocupa todo el ancho. */
    fun place(gravity: Int, x: Int, y: Int, fullWidth: Boolean = false) {
        val w = if (fullWidth) WindowManager.LayoutParams.MATCH_PARENT else WindowManager.LayoutParams.WRAP_CONTENT
        if (params.gravity == gravity && params.x == x && params.y == y && params.width == w) return
        params.gravity = gravity
        params.x = x
        params.y = y
        params.width = w
        update()
    }

    private fun update() {
        view?.let { runCatching { wm.updateViewLayout(it, params) } }
    }

    fun remove() {
        view?.let { runCatching { wm.removeViewImmediate(it) } }
        view = null
    }
}
