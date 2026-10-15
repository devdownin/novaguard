package com.novaguard.surveillance

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/** One still taken from a clip, ready to hand a model. */
internal class McpFrame(val offsetMs: Long, val jpegBase64: String)

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

  /**
   * One decode at a time. Extraction runs on a request thread and competes with
   * the analysis for the same cores; several agents asking at once would turn
   * that into a stall of the detector, which is the one thing that must not stop.
   */
  private val decoding = Semaphore(1)
  private const val DECODE_WAIT_S = 10L

  fun clampEdge(requested: Int): Int = requested.coerceIn(MAX_EDGE_MIN, MAX_EDGE_MAX)

  fun fromVideo(file: File, count: Int, maxEdge: Int): List<McpFrame> {
    if (!decoding.tryAcquire(DECODE_WAIT_S, TimeUnit.SECONDS)) {
      throw McpException("NOVAGUARD_TIMEOUT", "Another frame extraction is running; retry shortly", -32603)
    }
    try {
      return decode(file, count, maxEdge)
    } finally {
      decoding.release()
    }
  }

  private fun decode(file: File, count: Int, maxEdge: Int): List<McpFrame> {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(file.path)
      val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      val edge = clampEdge(maxEdge)
      return McpRules.frameTimesUs(durationMs, count).toList().mapNotNull { timeUs ->
        // Scaled by the retriever to fit edge×edge with the aspect kept: a 4K
        // frame decoded at full size is 33 MB of bitmap per frame.
        val bitmap = retriever.getScaledFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, edge, edge)
          ?: return@mapNotNull null
        try {
          McpFrame(timeUs / 1000, encode(bitmap))
        } finally {
          bitmap.recycle()
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

  private fun encode(bitmap: Bitmap): String {
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, QUALITY, out)
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }
}
