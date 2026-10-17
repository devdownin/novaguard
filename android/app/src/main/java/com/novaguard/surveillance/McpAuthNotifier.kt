package com.novaguard.surveillance

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.novaguard.MainActivity
import com.novaguard.R

/**
 * Tells the owner an assistant is waiting for their answer.
 *
 * A phone that watches a room has its screen off, so a prompt that exists only
 * inside the app would expire unseen after two minutes. The notification carries
 * the client's name and nothing else; the code to compare is shown in the app,
 * behind the unlock.
 */
object McpAuthNotifier {
  private const val CHANNEL_ID = "novaguard.cloud_auth"
  private const val NOTIFICATION_ID = 4107

  fun post(context: Context, clientName: String) {
    createChannel(context)
    val open = Intent(context, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pending = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle(context.getString(R.string.cloud_auth_title))
      .setContentText(context.getString(R.string.cloud_auth_text, clientName))
      .setSmallIcon(R.drawable.ic_notification)
      .setContentIntent(pending)
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      // The title says that something asks; who, and the code, wait for the unlock.
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setTimeoutAfter(McpOAuth.PENDING_TTL_MS)
      .setLocalOnly(true)
      .build()
    // Dropped silently when POST_NOTIFICATIONS is denied: the prompt still shows once the app is opened.
    NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
  }

  fun dismiss(context: Context) {
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
  }

  private fun createChannel(context: Context) {
    val channel = NotificationChannel(
      CHANNEL_ID,
      context.getString(R.string.cloud_auth_channel_name),
      NotificationManager.IMPORTANCE_HIGH,
    ).apply { description = context.getString(R.string.cloud_auth_channel_description) }
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }
}
