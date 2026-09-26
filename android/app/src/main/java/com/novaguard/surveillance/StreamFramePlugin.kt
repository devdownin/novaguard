package com.novaguard.surveillance

import android.graphics.Bitmap
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.SharedArray
import java.io.ByteArrayOutputStream

/** Encodes an already resized RGB frame without crossing the React Native bridge. */
class StreamFramePlugin : FrameProcessorPlugin() {
  override fun callback(frame: Frame, params: MutableMap<String, Any>?): Any? {
    if (!LocalStreamServerModule.hasActiveServer()) return null
    val width = (params?.get("width") as? Number)?.toInt() ?: return null
    val height = (params?.get("height") as? Number)?.toInt() ?: return null
    if (width !in 1..640 || height !in 1..640) return null
    val buffer = (params?.get("rgb") as? SharedArray)?.byteBuffer?.duplicate()?.apply { rewind() } ?: return null
    if (buffer.remaining() < width * height * 3) return null

    val pixels = IntArray(width * height)
    for (i in pixels.indices) {
      val r = buffer.get().toInt() and 0xff
      val g = buffer.get().toInt() and 0xff
      val b = buffer.get().toInt() and 0xff
      pixels[i] = -0x1000000 or (r shl 16) or (g shl 8) or b
    }
    val bitmap = Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
    val output = ByteArrayOutputStream()
    try {
      bitmap.compress(Bitmap.CompressFormat.JPEG, 70, output)
      LocalStreamServerModule.publishJpeg(output.toByteArray())
    } finally {
      bitmap.recycle()
    }
    return null
  }
}
