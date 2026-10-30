package com.lyricisland.app.media

import android.content.ComponentName
import android.content.Context
import android.service.notification.NotificationListenerService
import androidx.core.app.NotificationManagerCompat

/**
 * NotificationListenerService vacío: NO lee las notificaciones. Es solo el "pase" que Android exige para que
 * MediaSessionManager.getActiveSessions() devuelva las sesiones de otras apps.
 */
class MediaListenerService : NotificationListenerService() {
    override fun onListenerConnected() {
        connected = true
        onConnectedListeners.forEach { it() }
    }

    override fun onListenerDisconnected() {
        connected = false
    }

    companion object {
        @Volatile var connected = false
            private set
        val onConnectedListeners = mutableSetOf<() -> Unit>()

        fun component(context: Context) = ComponentName(context, MediaListenerService::class.java)

        fun isEnabled(context: Context): Boolean =
            NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }
}
