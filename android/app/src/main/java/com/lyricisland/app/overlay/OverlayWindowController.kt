package com.lyricisland.app.overlay

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.WindowManager

/**
 * Ventana overlay (12.5). Mide SOLO lo que mide la isla (WRAP_CONTENT en ambos ejes), así no tapa nada más:
 * cuando Compose cambia el tamaño de la isla, WindowManager re-dimensiona la ventana.
 */
class OverlayWindowController(context: Context) {
    private val wm = context.getSystemService(WindowManager::class.java)
    private var view: View? = null

    val params = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
        title = "LyricIsland"
        if (Build.VERSION.SDK_INT >= 28) {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
    }

    val isShown get() = view != null

    fun show(v: View) {
        if (view != null) return
        wm.addView(v, params)
        view = v
    }

    fun setTopOffset(px: Int) {
        if (params.y == px) return
        params.y = px
        view?.let { wm.updateViewLayout(it, params) }
    }

    fun remove() {
        view?.let { runCatching { wm.removeViewImmediate(it) } }
        view = null
    }
}
