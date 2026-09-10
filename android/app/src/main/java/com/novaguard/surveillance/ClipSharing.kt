package com.novaguard.surveillance

import android.content.Intent
import android.util.Log
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ReactApplicationContext
import java.io.File

/**
 * Hands one recorded clip to another app, at the user's request.
 *
 * NovaGuard records evidence into its own private files directory, where no
 * other app — a mail client, a messaging app, a file manager — can read it.
 * That is deliberate: nothing leaves the device on its own. But a clip that can
 * never be given to anybody is not evidence either, so this is the one door,
 * and it only ever opens on a tap.
 *
 * A content URI through [FileProvider] rather than a `file://` path: Android
 * has refused the latter across app boundaries since API 24, and the temporary
 * read grant that comes with it dies with the receiving activity — so sharing
 * one clip never exposes the directory the others live in.
 */
object ClipSharing {

  private const val TAG = "NovaGuardSharing"
  /** Must match the authority declared for the provider in AndroidManifest.xml. */
  private const val AUTHORITY_SUFFIX = ".fileprovider"

  fun share(context: ReactApplicationContext, path: String): Boolean {
    val file = File(path.removePrefix("file://"))
    // A clip the retention sweep already reclaimed, or an event that never had
    // one: answering false lets the UI say so instead of opening an empty chooser.
    if (!file.exists()) return false

    return try {
      val uri = FileProvider.getUriForFile(context, context.packageName + AUTHORITY_SUFFIX, file)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = "video/mp4"
        putExtra(Intent.EXTRA_STREAM, uri)
        // On the chooser too: the flag has to ride the intent the system
        // actually launches, or the receiving app is handed a URI it may not read.
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(send, null).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }

      val activity = context.currentActivity
      if (activity != null) {
        activity.startActivity(chooser)
      } else {
        // No activity while the app sits behind the surveillance service. The
        // chooser can still be raised, but only as its own task.
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(chooser)
      }
      true
    } catch (e: Exception) {
      // A missing provider entry, a device with nothing that takes video, a
      // path outside the directory the provider covers. None of them is worth
      // taking surveillance down for.
      Log.w(TAG, "Sharing refused: ${e.message}")
      false
    }
  }
}
