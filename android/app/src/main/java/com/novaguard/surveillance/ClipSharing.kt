package com.novaguard.surveillance

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ReactApplicationContext
import java.io.File
import java.security.MessageDigest

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
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      launch(context, send)
      true
    } catch (e: Exception) {
      // A missing provider entry, a device with nothing that takes video, a
      // path outside the directory the provider covers. None of them is worth
      // taking surveillance down for.
      Log.w(TAG, "Sharing refused: ${e.message}")
      false
    }
  }

  /**
   * A whole passage as evidence: its clips and a text report, in one chooser.
   *
   * The report has to be a file the provider can serve, so it is written under
   * the recordings root, in `exports/` — a directory the startup orphan sweep
   * never lists, since it reads only the files directly in `recordings/`. The
   * previous export is removed first: one report is all a temporary grant
   * needs, and they would otherwise pile up where nothing accounts for them.
   */
  fun shareEvidence(context: ReactApplicationContext, paths: List<String>, report: String, reportName: String): Boolean {
    val clips = paths.map { File(it.removePrefix("file://")) }.filter { it.isFile }
    if (clips.isEmpty()) return false
    return try {
      val exports = File(context.filesDir, "recordings/$EXPORTS_DIR").apply { mkdirs() }
      exports.listFiles()?.forEach { it.delete() }
      // The name comes from JS; only its last segment is used, so it cannot
      // point the write anywhere but this directory.
      val reportFile = File(exports, File(reportName).name.ifEmpty { "NovaGuard.txt" })
      reportFile.writeText(report, Charsets.UTF_8)

      val authority = context.packageName + AUTHORITY_SUFFIX
      val uris = ArrayList<Uri>(clips.size + 1)
      uris.add(FileProvider.getUriForFile(context, authority, reportFile))
      clips.forEach { uris.add(FileProvider.getUriForFile(context, authority, it)) }

      val send = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
        type = "*/*"
        putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        // The grant rides ClipData too: on the chooser path, EXTRA_STREAM alone
        // is not always what the system copies the permission from.
        clipData = ClipData.newRawUri(reportFile.name, uris[0]).apply {
          uris.drop(1).forEach { addItem(ClipData.Item(it)) }
        }
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      launch(context, send)
      true
    } catch (e: Exception) {
      Log.w(TAG, "Evidence export refused: ${e.message}")
      false
    }
  }

  /** Lower-case hex SHA-256, streamed; "" for a file that cannot be read. */
  fun sha256(path: String): String {
    val file = File(path.removePrefix("file://"))
    if (!file.isFile) return ""
    return try {
      val digest = MessageDigest.getInstance("SHA-256")
      file.inputStream().use { input ->
        val buffer = ByteArray(1 shl 20)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          digest.update(buffer, 0, read)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    } catch (e: Exception) {
      Log.w(TAG, "Could not hash a recording: ${e.message}")
      ""
    }
  }

  private fun launch(context: ReactApplicationContext, send: Intent) {
    val chooser = Intent.createChooser(send, null).apply {
      // On the chooser too: the flag has to ride the intent the system
      // actually launches, or the receiving app is handed a URI it may not read.
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
  }

  private const val EXPORTS_DIR = "exports"
}
