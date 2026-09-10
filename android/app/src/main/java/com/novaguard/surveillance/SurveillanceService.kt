package com.novaguard.surveillance

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.novaguard.MainActivity
import com.novaguard.R

/**
 * Keeps NovaGuard alive and allowed to use the camera while it is off screen.
 *
 * Android does not let a backgrounded app hold the camera: without a running
 * foreground service of type `camera`, the capture session is cut as soon as the
 * app stops being visible, and the process becomes a candidate for being killed.
 * VisionCamera drives its own `LifecycleRegistry` from the `isActive` prop rather
 * than from the Activity's lifecycle, so the session itself survives the app
 * going to the background — this service is what makes the platform allow it.
 *
 * Nothing in here may throw. The JS wrapper guards its own call, but that call
 * only asks the system to start a service: everything below runs later, on the
 * service's own stack, where a JS try/catch cannot reach. An exception here
 * takes the whole process down.
 */
class SurveillanceService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: getString(R.string.app_name)
    val body = intent?.getStringExtra(EXTRA_BODY).orEmpty()

    // A foreground service of type `camera` requires the camera permission to be
    // held at the moment it starts; without it startForeground throws
    // SecurityException. Refusing here turns a crash into a message.
    if (!hasPermission(Manifest.permission.CAMERA)) {
      failAndStop(getString(R.string.camera_permission_required))
      return START_NOT_STICKY
    }

    try {
      createChannel()
      startForeground(NOTIFICATION_ID, buildNotification(title, body), foregroundTypes())
    } catch (e: Exception) {
      // SecurityException (a type whose permission is missing),
      // ForegroundServiceStartNotAllowedException (started from a state Android
      // refuses), or anything an OEM adds. Stop cleanly rather than die — and
      // stop promptly, so the system does not also raise a "did not start in
      // time" violation against us.
      failAndStop(e.message ?: e.javaClass.simpleName)
      return START_NOT_STICKY
    }

    lastError = null
    isRunning = true

    // Deliberately not START_STICKY. The camera session lives in the React view
    // tree, so a service the system restarted on its own — with no Activity and
    // no JS context — would show a "surveillance active" notification while
    // recording nothing. Better to stay stopped and let the user restart it.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    isRunning = false
    super.onDestroy()
  }

  private fun failAndStop(reason: String) {
    Log.w(TAG, "Foreground service refused: $reason")
    lastError = reason
    isRunning = false
    stopSelf()
  }

  private fun hasPermission(permission: String): Boolean =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

  /**
   * Microphone is only declared when RECORD_AUDIO is actually granted: since
   * Android 14, starting a foreground service with a type whose permission is
   * missing throws SecurityException. Audio is optional in NovaGuard, so the
   * type set has to be decided at runtime rather than baked in.
   */
  private fun foregroundTypes(): Int {
    var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
    if (hasPermission(Manifest.permission.RECORD_AUDIO)) {
      types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    }
    return types
  }

  private fun createChannel() {
    val channel = NotificationChannel(
      CHANNEL_ID,
      getString(R.string.surveillance_channel_name),
      // LOW: the notification has to exist for as long as the service runs, so
      // it must never make a sound or peek over what the user is doing.
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = getString(R.string.surveillance_channel_description)
      setShowBadge(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun buildNotification(title: String, body: String): Notification {
    val open = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pending = PendingIntent.getActivity(
      this, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      // A drawable, not the launcher mipmap: that one is an <adaptive-icon>,
      // which is not a shape the status bar can flatten into a silhouette.
      .setSmallIcon(R.drawable.ic_notification)
      .setContentIntent(pending)
      .setOngoing(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      // Surveillance footage is sensitive: keep the text off the lock screen.
      .setVisibility(NotificationCompat.VISIBILITY_SECRET)
      .build()
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"

    private const val TAG = "NovaGuardService"
    private const val CHANNEL_ID = "novaguard.surveillance"
    private const val NOTIFICATION_ID = 1001

    /**
     * Read from the JS side through the module. Plain flags are enough: the
     * service is a singleton and both writes happen on the main thread.
     */
    @Volatile
    var isRunning: Boolean = false
      private set

    /** Why the last start was refused, or null if it went through. */
    @Volatile
    var lastError: String? = null
      private set

    fun start(context: Context, title: String, body: String) {
      val intent = Intent(context, SurveillanceService::class.java).apply {
        putExtra(EXTRA_TITLE, title)
        putExtra(EXTRA_BODY, body)
      }
      lastError = null
      try {
        context.startForegroundService(intent)
      } catch (e: Exception) {
        // Android can refuse the start itself, before onStartCommand ever runs.
        lastError = e.message ?: e.javaClass.simpleName
      }
    }

    fun stop(context: Context) {
      try {
        context.stopService(Intent(context, SurveillanceService::class.java))
      } catch (e: Exception) {
        Log.w(TAG, "stopService failed: ${e.message}")
      }
    }
  }
}
