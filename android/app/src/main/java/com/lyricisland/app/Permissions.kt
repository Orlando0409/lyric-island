package com.lyricisland.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import com.lyricisland.app.media.MediaListenerService

/** Permisos que la isla necesita, en el orden en que se piden (RF-42). */
enum class Perm(val title: Int, val why: Int) {
    OVERLAY(R.string.perm_overlay, R.string.perm_overlay_why),
    LISTENER(R.string.perm_listener, R.string.perm_listener_why),
    NOTIFICATIONS(R.string.perm_notifications, R.string.perm_notifications_why),
}

object Permissions {
    fun isGranted(ctx: Context, p: Perm): Boolean = when (p) {
        Perm.OVERLAY -> Settings.canDrawOverlays(ctx)
        Perm.LISTENER -> MediaListenerService.isEnabled(ctx)
        Perm.NOTIFICATIONS -> Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    fun missing(ctx: Context): List<Perm> = Perm.entries.filterNot { isGranted(ctx, it) }

    /** Pantallas del sistema para los permisos especiales; la primera que exista es la buena. */
    fun settingsIntents(ctx: Context, p: Perm): List<Intent> = when (p) {
        Perm.OVERLAY -> listOf(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, "package:${ctx.packageName}".toUri()))
        Perm.LISTENER -> buildList {
            // Android 11+: directo al interruptor de LyricIsland.
            if (Build.VERSION.SDK_INT >= 30) {
                add(
                    Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                        .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, MediaListenerService.component(ctx).flattenToString()),
                )
            }
            add(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        // Si el usuario ya rechazó el diálogo, Android no lo vuelve a mostrar: se abre la pantalla de notificaciones de la app.
        Perm.NOTIFICATIONS -> listOf(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName))
    }

    fun openSettings(ctx: Context, p: Perm): Boolean {
        for (intent in settingsIntents(ctx, p)) {
            if (runCatching { ctx.startActivity(intent) }.isSuccess) return true
        }
        return false
    }
}
