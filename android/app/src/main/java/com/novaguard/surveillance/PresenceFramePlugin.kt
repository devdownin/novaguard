package com.novaguard.surveillance

import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin

/** Called for every delivered frame, before inference throttling. No frame crosses runtimes. */
class PresenceFramePlugin : FrameProcessorPlugin() {
  override fun callback(frame: Frame, params: MutableMap<String, Any>?): Any =
    PresenceRecorderModule.capture(frame)
}
