package com.novaguard.surveillance

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/** One still taken from a clip, ready to hand a model. */
internal class McpFrame(val offsetMs: Long, val jpegBase64: String, val cropped: Boolean = false)

/**
 * Stills from a recorded clip, for an agent that has to look at what was filmed.
 *
 * The clip itself went out as one base64 blob of up to 20 MB: past that most
 * clips, and below it several copies of the file in the heap of the process
 * that runs the camera — for a payload most MCP clients cannot read anyway. A
 * model sees images in a tool result, so this hands it a few JPEG frames,
 * scaled down by the decoder itself so no full-resolution bitmap is allocated.
 */
internal object McpFrames {
  private const val QUALITY = 72
  private const val MAX_EDGE_MIN = 160
  private const val MAX_EDGE_MAX = 1280
  const val DEFAULT_MAX_EDGE = 768
  private const val MAX_DECODE_EDGE = 1920

  /**
   * One decode at a time. Extraction runs on a request thread and competes with
   * the analysis for the same cores; several agents asking at once would turn
   * that into a stall of the detector, which is the one thing that must not stop.
   */
  private val decoding = Semaphore(1)
  private const val DECODE_WAIT_S = 10L

  fun clampEdge(requested: Int): Int = requested.coerceIn(MAX_EDGE_MIN, MAX_EDGE_MAX)

  /** `subject` empty: whole frames. Otherwise each still is cropped around the nearest sample. */
  fun fromVideo(file: File, count: Int, maxEdge: Int, subject: List<SubjectBox> = emptyList()): List<McpFrame> {
    if (!decoding.tryAcquire(DECODE_WAIT_S, TimeUnit.SECONDS)) {
      throw McpException("NOVAGUARD_TIMEOUT", "Another frame extraction is running; retry shortly", -32603)
    }
    try {
      return decode(file, count, maxEdge, subject)
    } finally {
      decoding.release()
    }
  }

  private fun decode(file: File, count: Int, maxEdge: Int, subject: List<SubjectBox>): List<McpFrame> {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(file.path)
      val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      val edge = clampEdge(maxEdge)
      val sampleTimes = subject.map { it.tMs }.toLongArray()
      return McpRules.frameTimesUs(durationMs, count).toList().mapNotNull { timeUs ->
        val index = McpRules.nearestSample(sampleTimes, timeUs / 1000)
        if (index < 0) {
          // Scaled by the retriever to fit edge×edge with the aspect kept: a 4K
          // frame decoded at full size is 33 MB of bitmap per frame.
          val bitmap = retriever.getScaledFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, edge, edge)
            ?: return@mapNotNull null
          try {
            McpFrame(timeUs / 1000, encode(bitmap))
          } finally {
            bitmap.recycle()
          }
        } else {
          croppedFrame(retriever, timeUs, edge, subject[index])
        }
      }
    } catch (e: McpException) {
      throw e
    } catch (_: Exception) {
      throw McpException("NOVAGUARD_MEDIA_UNAVAILABLE", "The clip could not be decoded", -32603)
    } finally {
      retriever.release()
    }
  }

  /**
   * Decoded larger than the still it becomes, so the crop keeps detail: the
   * point of framing on the subject is the pixels a whole-frame still spends
   * on the room. Bounded so a 4K clip never allocates a full-size bitmap.
   * The exact frame (OPTION_CLOSEST) rather than the nearest key frame, which
   * can be a second away from where the subject was sampled.
   */
  private fun croppedFrame(retriever: MediaMetadataRetriever, timeUs: Long, edge: Int, box: SubjectBox): McpFrame? {
    val crop = McpRules.subjectCrop(box.x, box.y, box.w, box.h)
    val decodeEdge = minOf(MAX_DECODE_EDGE, Math.ceil(edge / maxOf(crop[2], crop[3])).toInt())
    val full = retriever.getScaledFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST, decodeEdge, decodeEdge)
      ?: return null
    var cut: Bitmap? = null
    var scaled: Bitmap? = null
    try {
      val left = (crop[0] * full.width).toInt().coerceIn(0, full.width - 1)
      val top = (crop[1] * full.height).toInt().coerceIn(0, full.height - 1)
      val width = (crop[2] * full.width).toInt().coerceIn(1, full.width - left)
      val height = (crop[3] * full.height).toInt().coerceIn(1, full.height - top)
      cut = Bitmap.createBitmap(full, left, top, width, height)
      val scale = minOf(1.0, edge.toDouble() / maxOf(width, height))
      scaled = if (scale < 1.0) {
        Bitmap.createScaledBitmap(cut, maxOf(1, (width * scale).toInt()), maxOf(1, (height * scale).toInt()), true)
      } else cut
      return McpFrame(timeUs / 1000, encode(scaled), cropped = true)
    } finally {
      if (scaled != null && scaled !== cut) scaled.recycle()
      if (cut != null && cut !== full) cut.recycle()
      full.recycle()
    }
  }

  private fun encode(bitmap: Bitmap): String {
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, QUALITY, out)
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }
}
