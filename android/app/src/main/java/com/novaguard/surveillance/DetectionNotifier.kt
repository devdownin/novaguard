package com.novaguard.surveillance

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.novaguard.MainActivity
import com.novaguard.R

/**
 * The "a person or animal was seen" alert.
 *
 * Kept apart from the foreground-service notification: that one is a permanent,
 * silent status line, this one is an interruption, and Android channels are the
 * unit that carries that difference.
 *
 * Sound and vibration are deliberately not parameters. Since Android 8 those
 * belong to the channel, and a channel's importance and vibration cannot be
 * changed after it is created — an app that offers its own in-app toggles
 * either lies about them or has to create a channel per combination. NovaGuard
 * ships one channel and sends the user to the system page for it instead
 * (see [openChannelSettings]).
 */
object DetectionNotifier {

  private const val TAG = "NovaGuardNotifier"
  private const val CHANNEL_ID = "novaguard.detections"
  private const val NOTIFICATION_ID = 1002

  fun notify(context: Context, title: String, body: String) {
    try {
      post(context, title, body)
    } catch (e: Exception) {
      // An alert is never worth crashing surveillance for.
      Log.w(TAG, "Detection notification refused: ${e.message}")
    }
  }

  private fun post(context: Context, title: String, body: String) {
    createChannel(context)

    val open = Intent(context, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pending = PendingIntent.getActivity(
      context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      // A drawable, not the launcher mipmap — see SurveillanceService.
      .setSmallIcon(R.drawable.ic_notification)
      .setContentIntent(pending)
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_EVENT)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      // Shows on the lock screen — being woken by it is the point — but the
      // detail stays hidden until unlock. What the camera saw is not something
      // to display to whoever picks the phone up.
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .build()

    // Throws nothing when POST_NOTIFICATIONS is denied; the post is simply
    // dropped, which is the behaviour we want — the app must not depend on it.
    NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
  }

  fun dismiss(context: Context) {
    try {
      NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    } catch (e: Exception) {
      Log.w(TAG, "Dismiss failed: ${e.message}")
    }
  }

  fun openChannelSettings(context: Context) {
    try {
      createChannel(context)
      val intent = Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
        putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      context.startActivity(intent)
    } catch (e: Exception) {
      // Not every build ships that settings screen.
      Log.w(TAG, "Channel settings unavailable: ${e.message}")
    }
  }

  /** Idempotent: re-creating an existing channel leaves the user's own choices alone. */
  private fun createChannel(context: Context) {
    val channel = NotificationChannel(
      CHANNEL_ID,
      context.getString(R.string.detection_channel_name),
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = context.getString(R.string.detection_channel_description)
      enableVibration(true)
    }
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }
}
