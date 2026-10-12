package com.novaguard.surveillance

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.os.Handler
import android.os.HandlerThread
import android.os.StatFs
import android.os.SystemClock
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.mrousavy.camera.frameprocessors.Frame
import java.io.File
import java.util.ArrayDeque
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicInteger

/**
 * Continuous, all-intra video encoder with a bounded in-memory pre-confirmation buffer.
 * The camera and encoder stay up across MP4 boundaries. Only samples within positive
 * detection windows are written. All codec/muxer state belongs to one HandlerThread.
 */
class PresenceRecorderModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val thread = HandlerThread("NovaGuardPresence").apply { start() }
  private val worker = Handler(thread.looper)
  private val writerThread = HandlerThread("NovaGuardMuxer").apply { start() }
  private val writer = Handler(writerThread.looper)
  private val framePending = AtomicInteger(0)
  private val writerBytes = AtomicLong(0)
  private val frameBytes = AtomicLong(0)
  @Volatile private var capturing = false
  @Volatile private var generation = 0L
  private var audioEnabled = false
  private var bitrate = 6_000_000
  private var epochOffsetUs = 0L
  private var video: MediaCodec? = null
  private var audio: MediaCodec? = null
  private var microphone: AudioRecord? = null
  private var videoFormat: MediaFormat? = null
  private var audioFormat: MediaFormat? = null
  private var inputWidth = 0
  private var inputHeight = 0
  private var rotation = 0
  private var lastVideoInputUs = 0L
  private var videoEos = false
  private var audioPtsUs = 0L
  private val ring = ArrayDeque<Sample>()
  private var ringBytes = 0
  private var recording: Recording? = null
  private val closingRecords = LinkedHashMap<Int, Recording>()
  private var drainScheduled = false

  private data class Sample(val video: Boolean, val bytes: ByteArray, val ptsUs: Long, val flags: Int)
  private class Recording(val id: Int, val window: PresenceWindow, val audioRequested: Boolean, val bitrate: Int) {
    var videoFormat: MediaFormat? = null
    var audioFormat: MediaFormat? = null
    var rotation = 0
    var captureStartUs = Long.MIN_VALUE
    val failed = AtomicBoolean(false)
    var closing = false
    var queuedSegmentStartUs = Long.MIN_VALUE
    var endDeadlineMs = 0L
    var muxer: MediaMuxer? = null
    var file: File? = null
    var videoTrack = -1
    var audioTrack = -1
    var segmentStartUs = 0L
    var lastVideoUs = Long.MIN_VALUE
    var lastAudioUs = Long.MIN_VALUE
    var segmentLastVideoUs = 0L
    var segmentLastAudioUs = Long.MIN_VALUE
  }
  override fun getName() = NAME

  @ReactMethod fun addListener(name: String) { /* NativeEventEmitter contract */ }
  @ReactMethod fun removeListeners(count: Int) { /* NativeEventEmitter contract */ }

  @ReactMethod fun startCapture(withAudio: Boolean, targetBitrate: Double, promise: Promise) = dispatch(promise) {
    if (capturing && audioEnabled == withAudio && bitrate == targetBitrate.toInt()) return@dispatch
    stopInternal()
    bitrate = targetBitrate.toInt().coerceIn(1_000_000, 30_000_000)
    audioEnabled = withAudio
    epochOffsetUs = System.currentTimeMillis() * 1000 - SystemClock.elapsedRealtimeNanos() / 1000
    if (withAudio) startAudio()
    capturing = true
    owner = this
    scheduleDrain()
  }

  @ReactMethod fun stopCapture(promise: Promise) = dispatch(promise) { stopInternal() }

  @ReactMethod fun begin(id: Double, fromAt: Double, maxMs: Double, promise: Promise) = dispatch(promise) {
    check(capturing) { "Encodeur en préparation" }
    check(recording == null) { "Enregistrement précédent en finalisation" }
    val first = ring.firstOrNull { it.video }
    val requestedFromUs = (fromAt * 1000).toLong()
    // Report an exhausted buffer instead of pretending the beginning was captured.
    if (first != null && requestedFromUs < first.ptsUs - FRAME_US) {
      emit(Arguments.createMap().apply {
        putInt("recordingId", 0)
        putString("error", "Début de présence indisponible : tampon vidéo épuisé")
      })
    }
    // Keep the requested window: clamping its start must not extend its end into an empty scene.
    val fromUs = requestedFromUs
    recording = Recording(id.toInt(), PresenceWindow(fromUs, (maxMs * 1000).toLong()), audioEnabled, bitrate)
    flushPresence()
  }

  @ReactMethod fun observe(id: Double, untilAt: Double) {
    worker.post {
      try {
        recording?.takeIf { it.id == id.toInt() }?.window?.observe((untilAt * 1000).toLong())
        flushPresence()
      } catch (e: Exception) { fail(e) }
    }
  }

  @ReactMethod fun end(id: Double, untilAt: Double, promise: Promise) {
    worker.post {
      try {
        val current = recording?.takeIf { it.id == id.toInt() }
        if (current != null) {
          current.window.close((untilAt * 1000).toLong())
          current.closing = true
          current.endDeadlineMs = SystemClock.elapsedRealtime() + 1000
          recording = null
          closingRecords[current.id] = current
        }
        promise.resolve(null)
        drain(video, true, 0); drain(audio, false, 0); flushPresence(); finishIfDrained()
      } catch (e: Exception) { fail(e) }
    }
  }

  private fun finishIfDrained() {
    for (current in closingRecords.values.toList()) {
      if (ring.none { it.video && it.ptsUs >= current.window.throughUs() } &&
        SystemClock.elapsedRealtime() < current.endDeadlineMs) continue
      closingRecords.remove(current.id)
      finishOnWriter(current)
    }
  }

  private fun dispatch(promise: Promise, action: () -> Unit) {
    worker.post {
      try { action(); promise.resolve(null) }
      catch (e: Exception) { promise.reject("PRESENCE_RECORDER", e.message, e) }
    }
  }

  /** Copy only while the delivered frame is valid; never retain CameraX buffers. */
  private fun offer(frame: Frame): Double {
    val expectedGeneration = generation
    if (!capturing) return -1.0
    val atUs = (frame.timestamp / 1_000_000 + epochOffsetUs / 1000) * 1000
    if (framePending.incrementAndGet() > MAX_PENDING_FRAMES) {
      framePending.decrementAndGet()
      // Queue contention is visible, not silently reported as continuous capture.
      worker.post { if (capturing && generation == expectedGeneration) fail(IllegalStateException("Encodeur vidéo trop lent : image perdue")) }
      return -1.0
    }
    var reservedBytes = 0L
    try {
      val image = frame.image
      val width = image.width
      val height = image.height
      val degrees = frame.orientation.toSurfaceRotation() * 90
      check(width % 2 == 0 && height % 2 == 0) { "Dimensions YUV non prises en charge" }
      val size = width.toLong() * height * 3 / 2
      check(size in 1..MAX_FRAME_BYTES) { "Image trop grande pour le tampon vidéo" }
      reservedBytes = size
      if (frameBytes.addAndGet(size) > MAX_FRAME_BYTES) {
        frameBytes.addAndGet(-size)
        reservedBytes = 0
        error("Encodeur vidéo trop lent : mémoire tampon saturée")
      }
      val bytes = ByteArray(size.toInt())
      var offset = 0
      image.planes.forEachIndexed { index, plane ->
        val w = if (index == 0) width else width / 2
        val h = if (index == 0) height else height / 2
        val buffer = plane.buffer.duplicate()
        val origin = buffer.position()
        for (y in 0 until h) for (x in 0 until w) {
          bytes[offset++] = buffer.get(origin + y * plane.rowStride + x * plane.pixelStride)
        }
      }
      worker.post {
        try {
          if (capturing && generation == expectedGeneration) {
            if (audioEnabled && microphone == null) startAudio()
            if (video == null) startVideo(width, height, degrees)
            check(width == inputWidth && height == inputHeight && degrees == rotation) {
              "Format caméra modifié pendant la capture"
            }
            queueVideo(bytes, atUs)
            pumpAudio()
            drain(video, true, 0)
            drain(audio, false, 0)
            flushPresence()
            scheduleDrain()
          }
        } catch (e: Exception) { fail(e) }
        finally { framePending.decrementAndGet(); frameBytes.addAndGet(-size) }
      }
    } catch (e: Exception) {
      frameBytes.addAndGet(-reservedBytes)
      framePending.decrementAndGet()
      worker.post { if (capturing && generation == expectedGeneration) fail(e) }
      return -1.0
    }
    return atUs / 1000.0
  }

  private fun startVideo(width: Int, height: Int, degrees: Int) {
    val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatYUV420Flexible)
      setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
      setInteger(MediaFormat.KEY_FRAME_RATE, 30)
      // Every frame is independently decodable: exact frame selection needs no preceding GOP.
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 0)
      setInteger(MediaFormat.KEY_MAX_B_FRAMES, 0)
    }
    val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    video = codec
    codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    codec.start()
    videoEos = false
    inputWidth = width
    inputHeight = height
    rotation = degrees
  }

  private fun queueVideo(bytes: ByteArray, atUs: Long) {
    val codec = video ?: return
    val index = codec.dequeueInputBuffer(10_000)
    check(index >= 0) { "Encodeur vidéo saturé : image perdue" }
    val image = codec.getInputImage(index) ?: error("Encodeur sans entrée YUV flexible")
    var offset = 0
    image.planes.forEachIndexed { planeIndex, plane ->
      val w = if (planeIndex == 0) inputWidth else inputWidth / 2
      val h = if (planeIndex == 0) inputHeight else inputHeight / 2
      val buffer = plane.buffer
      val origin = buffer.position()
      for (y in 0 until h) for (x in 0 until w) {
        buffer.put(origin + y * plane.rowStride + x * plane.pixelStride, bytes[offset++])
      }
    }
    codec.queueInputBuffer(index, 0, bytes.size, atUs, 0)
    lastVideoInputUs = atUs
  }

  private fun startAudio() {
    check(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
      "Permission microphone requise"
    }
    val min = AudioRecord.getMinBufferSize(AUDIO_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    check(min > 0) { "Microphone indisponible" }
    val source = AudioRecord(MediaRecorder.AudioSource.MIC, AUDIO_RATE, AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT, maxOf(min * 2, 16_384))
    microphone = source
    check(source.state == AudioRecord.STATE_INITIALIZED) { "Microphone non initialisé" }
    val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    audio = codec
    codec.configure(MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, AUDIO_RATE, 1).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, 64_000)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 4096)
    }, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    codec.start()
    source.startRecording()
    audioPtsUs = SystemClock.elapsedRealtimeNanos() / 1000 + epochOffsetUs
  }

  private fun pumpAudio() {
    val source = microphone ?: return
    val codec = audio ?: return
    repeat(4) {
      val index = codec.dequeueInputBuffer(0)
      if (index < 0) return
      val buffer = codec.getInputBuffer(index) ?: error("Entrée audio indisponible")
      buffer.clear()
      val count = source.read(buffer, minOf(buffer.capacity(), 4096), AudioRecord.READ_NON_BLOCKING)
      check(count >= 0) { "Lecture microphone refusée" }
      if (count > 0) {
        codec.queueInputBuffer(index, 0, count, audioPtsUs, 0)
        audioPtsUs += (count / 2) * 1_000_000L / AUDIO_RATE
      } else codec.queueInputBuffer(index, 0, 0, audioPtsUs, 0)
    }
  }

  private fun drain(codec: MediaCodec?, isVideo: Boolean, timeoutUs: Long) {
    if (codec == null) return
    val info = MediaCodec.BufferInfo()
    var index = codec.dequeueOutputBuffer(info, timeoutUs)
    while (index != MediaCodec.INFO_TRY_AGAIN_LATER) {
      if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        if (isVideo) videoFormat = codec.outputFormat else audioFormat = codec.outputFormat
      } else if (index >= 0) {
        if (isVideo && info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) videoEos = true
        try {
          if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
            if (isVideo) check(info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0) {
              "L’encodeur ne prend pas en charge la capture précise image par image"
            }
            val buffer = codec.getOutputBuffer(index) ?: error("Sortie encodeur indisponible")
            buffer.position(info.offset)
            buffer.limit(info.offset + info.size)
            val bytes = ByteArray(info.size)
            buffer.get(bytes)
            ring.addLast(Sample(isVideo, bytes, info.presentationTimeUs, info.flags))
            ringBytes += bytes.size
          }
        } finally { codec.releaseOutputBuffer(index, false) }
      }
      index = codec.dequeueOutputBuffer(info, 0)
    }
    flushPresence()
    val newest = ring.maxOfOrNull { it.ptsUs } ?: return
    val expired = ring.filter { newest - it.ptsUs > BUFFER_US }
    for (sample in expired) { ring.remove(sample); ringBytes -= sample.bytes.size }
    while (ringBytes > MAX_RING_BYTES && ring.isNotEmpty()) {
      val oldest = ring.minByOrNull { it.ptsUs } ?: break
      ring.remove(oldest)
      ringBytes -= oldest.bytes.size
    }
  }

  private fun scheduleDrain() {
    if (drainScheduled) return
    drainScheduled = true
    worker.postDelayed({
      drainScheduled = false
      if (!capturing) return@postDelayed
      try { pumpAudio(); drain(video, true, 0); drain(audio, false, 0); flushPresence(); finishIfDrained(); scheduleDrain() }
      catch (e: Exception) { fail(e) }
    }, 20)
  }

  private fun flushPresence() {
    recording?.let { flushRecording(it) }
    for (current in closingRecords.values.toList()) flushRecording(current)
  }

  private fun flushRecording(current: Recording) {
    val format = videoFormat ?: return
    if (current.lastVideoUs == Long.MIN_VALUE) {
      val firstVideo = ring.firstOrNull { it.video && current.window.contains(it.ptsUs) } ?: return
      current.captureStartUs = firstVideo.ptsUs
      current.videoFormat = format
      current.audioFormat = if (current.audioRequested) audioFormat else null
      current.rotation = rotation
    }
    val samples = ring.filter {
      if (it.video) current.window.contains(it.ptsUs)
      else current.audioFormat != null && it.ptsUs >= current.captureStartUs &&
        current.window.containsAudio(it.ptsUs, AAC_FRAME_US, FRAME_US)
    }.sortedWith(compareBy<Sample> { it.ptsUs }.thenBy { if (it.video) 0 else 1 })
    for (sample in samples) {
      if (sample.ptsUs <= if (sample.video) current.lastVideoUs else current.lastAudioUs) continue
      var audioForSegment: Boolean? = null
      if (sample.video && (current.queuedSegmentStartUs == Long.MIN_VALUE ||
        current.window.mustRotate(current.queuedSegmentStartUs, sample.ptsUs))) {
        val hasAudio = current.audioFormat != null && ring.any {
          !it.video && it.ptsUs >= sample.ptsUs &&
            it.ptsUs < sample.ptsUs + current.window.maxSegmentUs &&
            current.window.containsAudio(it.ptsUs, AAC_FRAME_US, FRAME_US)
        }
        // A short closed fragment may have no complete AAC packet. Save its video.
        if (current.audioRequested && !hasAudio && !current.closing && capturing) return
        current.queuedSegmentStartUs = sample.ptsUs
        audioForSegment = hasAudio
      }
      // Claim each sample once on the codec thread, then serialize disk work elsewhere.
      // MediaMuxer.stop() can block; it must never block encoding the next frame.
      if (sample.video) current.lastVideoUs = sample.ptsUs else current.lastAudioUs = sample.ptsUs
      val queued = writerBytes.addAndGet(sample.bytes.size.toLong())
      if (queued > MAX_WRITER_BYTES) {
        writerBytes.addAndGet(-sample.bytes.size.toLong())
        error("Stockage trop lent : capture interrompue")
      }
      writer.post {
        if (current.failed.get()) { writerBytes.addAndGet(-sample.bytes.size.toLong()); return@post }
        try { writeSample(current, sample, audioForSegment) }
        catch (e: Exception) {
          current.failed.set(true)
          val path = current.file
          try { current.muxer?.release() } catch (_: Exception) {}
          current.muxer = null
          current.file = null
          path?.delete()
          worker.post {
            if (recording === current) recording = null
            closingRecords.remove(current.id)
            emit(Arguments.createMap().apply {
              putInt("recordingId", current.id)
              putString("error", e.message ?: "Écriture vidéo impossible")
            })
          }
        } finally { writerBytes.addAndGet(-sample.bytes.size.toLong()) }
      }
    }
  }

  private fun writeSample(current: Recording, sample: Sample, audioForSegment: Boolean?) {
    if (sample.video) {
      if (current.muxer != null && current.window.mustRotate(current.segmentStartUs, sample.ptsUs)) {
        closeSegment(current, true, sample.ptsUs)
      }
      if (current.muxer == null) openSegment(current, sample.ptsUs, audioForSegment == true)
    }
    val muxer = current.muxer ?: return
    if (sample.ptsUs < current.segmentStartUs) return
    val track = if (sample.video) current.videoTrack else current.audioTrack
    if (track < 0) return
    val info = MediaCodec.BufferInfo().apply {
      set(0, sample.bytes.size, sample.ptsUs - current.segmentStartUs, sample.flags)
    }
    muxer.writeSampleData(track, java.nio.ByteBuffer.wrap(sample.bytes), info)
    if (sample.video) current.segmentLastVideoUs = sample.ptsUs else current.segmentLastAudioUs = sample.ptsUs
  }

  private fun finishOnWriter(current: Recording, warning: String? = null) {
    writer.post {
      if (current.failed.get()) return@post
      try { closeSegment(current, false, warning = warning) }
      catch (e: Exception) {
        emit(Arguments.createMap().apply {
          putInt("recordingId", current.id)
          putString("error", e.message ?: "Finalisation impossible")
        })
      }
    }
  }

  private fun openSegment(current: Recording, atUs: Long, withAudio: Boolean) {
    val dir = File(context.filesDir, "recordings")
    check(dir.isDirectory || dir.mkdirs()) { "Dossier d’enregistrement inaccessible" }
    val needed = 150L * 1024 * 1024 + current.bitrate.toLong() * current.window.maxSegmentUs / 8_000_000
    check(StatFs(dir.path).availableBytes >= needed) { "Espace insuffisant pour enregistrer" }
    val path = File.createTempFile("presence-", ".mp4", dir)
    current.file = path
    val muxer = MediaMuxer(path.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    current.muxer = muxer
    muxer.setOrientationHint(current.rotation)
    current.videoTrack = muxer.addTrack(checkNotNull(current.videoFormat))
    current.audioTrack = if (withAudio) current.audioFormat?.let { muxer.addTrack(it) } ?: -1 else -1
    current.segmentStartUs = atUs
    current.segmentLastVideoUs = atUs
    current.segmentLastAudioUs = Long.MIN_VALUE
    muxer.start()
  }

  private fun closeSegment(current: Recording, continued: Boolean, boundaryUs: Long? = null, warning: String? = null) {
    val muxer = current.muxer
    val path = current.file
    current.muxer = null
    current.file = null
    if (muxer == null || path == null) {
      if (!continued) emitEmpty(current, warning)
      return
    }
    val audioEnd = if (current.segmentLastAudioUs == Long.MIN_VALUE) 0 else current.segmentLastAudioUs + AAC_FRAME_US
    val endedAt = boundaryUs ?: maxOf(current.segmentLastVideoUs + FRAME_US, audioEnd)
    // Android's MP4 muxer uses an empty EOS sample to set the final sample duration.
    // At rotation the previous file ends exactly where the following file begins.
    try {
      muxer.writeSampleData(current.videoTrack, java.nio.ByteBuffer.allocate(0), MediaCodec.BufferInfo().apply {
        set(0, 0, endedAt - current.segmentStartUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
      })
      if (current.audioTrack >= 0 && current.segmentLastAudioUs != Long.MIN_VALUE) {
        muxer.writeSampleData(current.audioTrack, java.nio.ByteBuffer.allocate(0), MediaCodec.BufferInfo().apply {
          set(0, 0, endedAt - current.segmentStartUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
        })
      }
      muxer.stop()
    } catch (e: Exception) { path.delete(); throw e }
    finally { muxer.release() }
    val payload = Arguments.createMap().apply {
      putInt("recordingId", current.id)
      putString("path", path.path)
      putDouble("bytes", path.length().toDouble())
      putDouble("duration", (endedAt - current.segmentStartUs) / 1_000_000.0)
      putNull("thumbPath")
      putDouble("startedAt", current.segmentStartUs / 1000.0)
      putDouble("endedAt", endedAt / 1000.0)
      putBoolean("continued", continued)
      if (warning != null) putString("warning", warning)
    }
    emit(payload)
  }

  private fun emitEmpty(current: Recording, message: String? = null) = emit(Arguments.createMap().apply {
    putInt("recordingId", current.id)
    putString("error", message ?: "Aucune image vidéo dans la présence détectée")
  })

  private fun fail(error: Exception) {
    generation += 1
    val affected = listOfNotNull(recording) + closingRecords.values.toList()
    recording = null
    closingRecords.clear()
    val message = error.message ?: "Capture interrompue"
    if (affected.isEmpty()) emit(Arguments.createMap().apply { putInt("recordingId", 0); putString("error", message) })
    for (current in affected) {
      current.closing = true
      emit(Arguments.createMap().apply {
        putInt("recordingId", current.id); putBoolean("encoderFree", true); putString("error", message)
      })
      finishOnWriter(current, message)
    }
    releaseCodecs()
    ring.clear()
    ringBytes = 0
    // The next delivered frame reinitialises the codec; queued old-generation frames are ignored.
  }

  private fun stopInternal() {
    capturing = false
    generation += 1
    recording?.let {
      it.closing = true
      it.window.close(it.window.throughUs())
      closingRecords[it.id] = it
    }
    recording = null
    try {
      val codec = video
      if (closingRecords.isNotEmpty() && codec != null) {
        val index = codec.dequeueInputBuffer(50_000)
        if (index >= 0) codec.queueInputBuffer(index, 0, 0, lastVideoInputUs + 1, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
        val deadline = SystemClock.elapsedRealtime() + 1000
        while (!videoEos && SystemClock.elapsedRealtime() < deadline) drain(codec, true, 10_000)
      }
      drain(audio, false, 0)
      flushPresence()
      for (current in closingRecords.values.toList()) finishOnWriter(current)
    } catch (e: Exception) {
      for (current in closingRecords.values.toList()) finishOnWriter(current, e.message)
      throw e
    } finally {
      closingRecords.clear()
      releaseCodecs()
      ring.clear()
      ringBytes = 0
    }
  }

  private fun releaseCodecs() {
    microphone?.let {
      try { it.stop() } catch (_: Exception) {}
      try { it.release() } catch (_: Exception) {}
    }
    microphone = null
    for (codec in listOf(video, audio)) codec?.let {
      try { it.stop() } catch (_: Exception) {}
      try { it.release() } catch (_: Exception) {}
    }
    video = null
    audio = null
    videoFormat = null
    audioFormat = null
  }

  private fun emit(payload: com.facebook.react.bridge.WritableMap) {
    if (!context.hasActiveReactInstance()) return
    try {
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("PresenceRecorderClip", payload)
    } catch (_: Exception) { /* React instance can disappear between the check and emission. */ }
  }

  override fun invalidate() {
    capturing = false
    if (owner === this) owner = null
    worker.post {
      try { stopInternal() } finally {
        writer.post { writerThread.quitSafely() }
        thread.quitSafely()
      }
    }
    super.invalidate()
  }

  companion object {
    const val NAME = "PresenceRecorder"
    private const val AUDIO_RATE = 48_000
    private const val AAC_FRAME_US = 1024L * 1_000_000 / AUDIO_RATE
    private const val BUFFER_US = 4_000_000L
    private const val MAX_RING_BYTES = 16 * 1024 * 1024
    private const val MAX_PENDING_FRAMES = 8
    private const val MAX_FRAME_BYTES = 32L * 1024 * 1024
    private const val MAX_WRITER_BYTES = 32L * 1024 * 1024
    private const val FRAME_US = 33_333L
    @Volatile private var owner: PresenceRecorderModule? = null
    fun capture(frame: Frame): Double = owner?.offer(frame) ?: -1.0
  }
}
