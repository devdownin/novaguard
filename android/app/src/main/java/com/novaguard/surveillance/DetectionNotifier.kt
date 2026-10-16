package com.novaguard.surveillance

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.novaguard.MainActivity
import com.novaguard.R
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

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
 *
 * The picture follows the alert rather than delaying it: the text is posted at
 * once, and the same notification is reposted silently with a still when the
 * camera delivers one (`LiveStill`, which works with the screen off — there is
 * no preview to capture then). It is never bridged to a watch (`setLocalOnly`):
 * what the camera saw does not leave the phone.
 */
object DetectionNotifier {

  private const val TAG = "NovaGuardNotifier"
  private const val CHANNEL_ID = "novaguard.detections"
  private const val NOTIFICATION_ID = 1002
  private const val PICTURE_EDGE = 720
  private const val PICTURE_TIMEOUT_MS = 2_500L

  /** Which alert a late picture belongs to: a newer alert, or a dismissal, wins. */
  private val serial = AtomicInteger()
  private val pictures = Executors.newSingleThreadExecutor()

  fun notify(context: Context, title: String, body: String, passageId: String, picture: Boolean) {
    val mine = serial.incrementAndGet()
    try {
      post(context, title, body, passageId, null)
    } catch (e: Exception) {
      // An alert is never worth crashing surveillance for.
      Log.w(TAG, "Detection notification refused: ${e.message}")
      return
    }
    if (!picture) return
    pictures.execute {
      try {
        val jpeg = LiveStill.captureBytes(PICTURE_EDGE, PICTURE_TIMEOUT_MS)?.first ?: return@execute
        val bitmap = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size) ?: return@execute
        // Only onto the alert it was taken for, and only while it is still on
        // screen: reposting a swiped-away alert would bring it back.
        if (serial.get() != mine || !showing(context)) return@execute
        post(context, title, body, passageId, bitmap)
      } catch (e: Exception) {
        Log.w(TAG, "Alert picture unavailable: ${e.message}")
      }
    }
  }

  private fun showing(context: Context): Boolean =
    context.getSystemService(NotificationManager::class.java).activeNotifications.any { it.id == NOTIFICATION_ID }

  private fun post(context: Context, title: String, body: String, passageId: String, picture: Bitmap?) {
    createChannel(context)

    // VIEW + data is what React Native's Linking reads (getInitialURL on a cold
    // start, the "url" event through onNewIntent on the singleTask activity).
    // Explicit component and no intent-filter: no other app can route here.
    val open = Intent(Intent.ACTION_VIEW, passageUri(passageId), context, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pending = PendingIntent.getActivity(
      context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
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
      .setLocalOnly(true)
    if (picture != null) {
      // The repost of an alert already rung: the picture must not ring it again.
      builder.setOnlyAlertOnce(true)
        .setLargeIcon(picture)
        .setStyle(NotificationCompat.BigPictureStyle().bigPicture(picture).bigLargeIcon(null as Bitmap?))
    }
    val notification = builder.build()

    // Throws nothing when POST_NOTIFICATIONS is denied; the post is simply
    // dropped, which is the behaviour we want — the app must not depend on it.
    NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
  }

  /** Read back by `passageIdFromUrl` in `alerts.ts`. */
  private fun passageUri(passageId: String): Uri? = passageId.takeIf { it.isNotEmpty() }?.let {
    Uri.Builder().scheme("novaguard").authority("passage").appendPath(it).build()
  }

  fun dismiss(context: Context) {
    serial.incrementAndGet()
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
