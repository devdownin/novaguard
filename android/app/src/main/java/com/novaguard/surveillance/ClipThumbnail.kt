package com.novaguard.surveillance

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.util.Log
import java.io.File
import java.io.FileOutputStream

/**
 * One still from a recorded clip, written beside it as a JPEG.
 *
 * The history list drew a gradient and a decorative rectangle in place of every
 * clip, so two passages were indistinguishable without opening each one — on a
 * screen whose entire job is letting somebody find the passage they care about.
 * A surveillance history is looked at, not read.
 *
 * Nothing here is allowed to cost a recording. Every failure returns an empty
 * string and the event is filed without a picture, which is a case the UI has to
 * handle anyway: an event can exist with no file at all (encoder refused, disk
 * full, clip reclaimed by the retention sweep).
 */
object ClipThumbnail {

  /** Long edge of the stored still, in pixels. 240 covers the 74 dp card at 3x. */
  private const val MAX_EDGE = 240

  /** Enough for a list thumbnail; the clip itself is what evidence comes from. */
  private const val QUALITY = 78

  private const val TAG = "ClipThumbnail"

  /** The JPEG that belongs to `clipPath`, whether or not it has been written yet. */
  fun pathFor(clipPath: String): String = clipPath.replaceAfterLast('.', "jpg")

  /**
   * Extracts the first decodable frame of `clipPath` and returns the JPEG's
   * path, or "" if anything went wrong.
   *
   * `OPTION_CLOSEST_SYNC` at time 0 asks for the nearest key frame rather than a
   * decode up to an arbitrary instant, so this is one frame's work. It still
   * runs off the calling thread — the module hands it to a background executor —
   * because MediaMetadataRetriever opens and parses the container, and this is
   * called moments after the encoder released the camera.
   */
  fun extract(clipPath: String): String {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(clipPath)
      val frame = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        ?: return ""
      val scaled = scaleToFit(frame)
      val out = File(pathFor(clipPath))
      FileOutputStream(out).use { scaled.compress(Bitmap.CompressFormat.JPEG, QUALITY, it) }
      if (scaled !== frame) scaled.recycle()
      frame.recycle()
      return out.absolutePath
    } catch (e: Exception) {
      // A clip that cannot be read is still a clip: it plays in the detail
      // sheet or it does not, and either way the event stands.
      Log.w(TAG, "No thumbnail for $clipPath", e)
      return ""
    } finally {
      // `release()` rather than `close()`: the latter needs API 29 semantics we
      // do not rely on, and this one has been the contract since API 10.
      retriever.release()
    }
  }

  private fun scaleToFit(frame: Bitmap): Bitmap {
    val longest = maxOf(frame.width, frame.height)
    if (longest <= MAX_EDGE || longest == 0) return frame
    val ratio = MAX_EDGE.toFloat() / longest
    return Bitmap.createScaledBitmap(
      frame,
      maxOf(1, (frame.width * ratio).toInt()),
      maxOf(1, (frame.height * ratio).toInt()),
      true,
    )
  }
}
