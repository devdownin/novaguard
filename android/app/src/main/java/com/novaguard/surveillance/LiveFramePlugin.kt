package com.novaguard.surveillance

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import android.util.Base64
import android.util.Log
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Called from the frame processor twice a second while the owner allows the
 * live view; does nothing at all until an agent has asked for a still.
 */
class LiveFramePlugin : FrameProcessorPlugin() {
  override fun callback(frame: Frame, params: MutableMap<String, Any>?): Any? {
    McpLiveFrame.offer(frame)
    return null
  }
}

/**
 * What the camera sees now, for `get_live_frame`.
 *
 * The frame path pays nothing while nobody asks: `offer` reads one volatile and
 * returns. When a request is pending, the YUV planes are copied on the camera
 * thread — the only thread on which the image is valid — and everything else
 * (JPEG, downscale, rotation) runs on a thread of its own, so the analysis of
 * the next frame is not held up by an agent's question.
 */
internal object McpLiveFrame {
  private const val TAG = "NovaGuardLive"
  private const val QUALITY = 72

  private val lock = ReentrantLock()
  private val delivered = lock.newCondition()
  @Volatile private var maxEdge = 0
  @Volatile private var wanted = false
  private var latest: ByteArray? = null
  private var latestAt = 0L
  private val encoder = Executors.newSingleThreadExecutor()

  fun offer(frame: Frame) {
    if (!wanted) return
    wanted = false
    try {
      val image = frame.image
      val width = image.width
      val height = image.height
      val degrees = frame.orientation.toSurfaceRotation() * 90
      val ySize = width * height
      val i420 = ByteArray(ySize * 3 / 2)
      var offset = 0
      image.planes.forEachIndexed { index, plane ->
        val w = if (index == 0) width else width / 2
        val h = if (index == 0) height else height / 2
        offset = YuvPlanes.read(plane.buffer, plane.rowStride, plane.pixelStride, w, h, i420, offset)
      }
      val edge = maxEdge
      encoder.execute { publish(encode(i420, width, height, degrees, edge)) }
    } catch (e: Exception) {
      Log.w(TAG, "Live still unavailable: ${e.message}")
    }
  }

  /** Base64 JPEG and when it was taken, or null if no frame arrived within `timeoutMs`. */
  fun capture(maxEdge: Int, timeoutMs: Long): Pair<String, Long>? {
    val askedAt = System.currentTimeMillis()
    val deadline = askedAt + timeoutMs
    lock.withLock {
      this.maxEdge = maxEdge
      wanted = true
      while (latestAt < askedAt) {
        val left = deadline - System.currentTimeMillis()
        if (left <= 0) return null
        delivered.await(left, TimeUnit.MILLISECONDS)
      }
      val jpeg = latest ?: return null
      return Base64.encodeToString(jpeg, Base64.NO_WRAP) to latestAt
    }
  }

  private fun publish(jpeg: ByteArray?) {
    if (jpeg == null) return
    lock.withLock {
      latest = jpeg
      latestAt = System.currentTimeMillis()
      delivered.signalAll()
    }
  }

  private fun encode(i420: ByteArray, width: Int, height: Int, degrees: Int, maxEdge: Int): ByteArray? = try {
    val ySize = width * height
    val quarter = ySize / 4
    // YuvImage only takes NV21: Y, then V and U interleaved.
    val nv21 = ByteArray(i420.size)
    System.arraycopy(i420, 0, nv21, 0, ySize)
    for (i in 0 until quarter) {
      nv21[ySize + 2 * i] = i420[ySize + quarter + i]
      nv21[ySize + 2 * i + 1] = i420[ySize + i]
    }
    val full = ByteArrayOutputStream()
    YuvImage(nv21, ImageFormat.NV21, width, height, null).compressToJpeg(Rect(0, 0, width, height), 90, full)
    val bytes = full.toByteArray()
    // Decoded already reduced: a 4K frame at full size is 33 MB of bitmap.
    val options = BitmapFactory.Options().apply { inSampleSize = McpRules.sampleSizeFor(width, height, maxEdge) }
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    val scale = minOf(1f, maxEdge.toFloat() / maxOf(decoded.width, decoded.height))
    val matrix = Matrix().apply { postScale(scale, scale); postRotate(degrees.toFloat()) }
    val upright = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    val out = ByteArrayOutputStream()
    upright.compress(Bitmap.CompressFormat.JPEG, QUALITY, out)
    if (upright !== decoded) upright.recycle()
    decoded.recycle()
    out.toByteArray()
  } catch (e: Exception) {
    Log.w(TAG, "Could not encode the live still: ${e.message}")
    null
  }
}
