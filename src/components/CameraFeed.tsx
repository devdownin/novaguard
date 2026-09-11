import React, { RefObject, useEffect, useMemo } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import {
  Camera, runAtTargetFps, useCameraDevice, useCameraFormat, useFrameProcessor,
} from 'react-native-vision-camera';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { useRunOnJS } from 'react-native-worklets-core';
import { useAppState } from '../state/AppStateContext';
import { devicePositionFor, physicalDeviceFilterFor } from '../camera/deviceSelection';
import { swapsAxes, uprightAspect, uprightRotation } from '../camera/orientation';
import { t } from '../i18n';
import { uprightBoxToViewBox } from '../camera/framing';
import { useDetectionModel } from '../camera/useDetectionModel';
import { interpretDetections } from '../ml/interpretDetections';
import { letterboxFor, letterboxInto } from '../ml/letterbox';
import { SENSITIVITY_PROFILES } from '../ml/sensitivity';
import { tunedSettings } from '../camera/autoTune';
import { frameErrorMessage } from '../camera/frameErrors';
import { FrameStage } from '../camera/frameTrace';
import { qualityBitRate, qualityResolution } from '../recording/library';
import { DetectionBox, FrameDetection } from '../ml/types';

/**
 * The two detectors, and the input each was exported with (both verified
 * against the model files themselves: uint8, NHWC, and the same four output
 * tensors in the same order).
 *
 * They come from the same TensorFlow mirror and carry the *same* 90-entry
 * labelmap, byte for byte — which is the one thing that has to hold for
 * `labels.ts` to stay valid, and the one that silently kills detection when it
 * does not. Lite2 is markedly better on small subjects, which on a surveillance
 * camera is most of them, and costs roughly three times the inference: hence a
 * setting rather than a swap.
 */
const MODEL_STANDARD = require('../../assets/models/efficientdet-lite0.tflite');
const MODEL_PRECISE = require('../../assets/models/efficientdet-lite2.tflite');
const STANDARD_INPUT_SIZE = 320;
const PRECISE_INPUT_SIZE = 448;
/** `pixelFormat: 'rgb'` — three bytes per pixel. */
const MODEL_INPUT_CHANNELS = 3;

/**
 * Lowest score worth handing to the tracker.
 *
 * Not the user's "seuil de confiance": that one now decides which detections may
 * *open* a track (`startConfidence`), while this decides which are worth
 * associating at all. Everything between the two is a subject the detector is
 * unsure about — which is what a person half in shadow, at the end of a garden
 * or turned away actually looks like at 320 px — and keeping those looks is what
 * lets an already-open track survive them instead of ending mid-passage.
 *
 * Low enough to catch that, high enough that the tracker is not sifting the 25
 * near-zero slots the model always returns.
 */
const DETECTION_FLOOR = 0.3;

interface CameraFeedProps {
  style: StyleProp<ViewStyle>;
  active: boolean;
  /** Measured viewfinder size — face bounds come back in this space (see `autoMode` below). */
  viewWidth: number;
  viewHeight: number;
  /** Boxes for the auto-zoom, already normalized to the viewfinder rect. */
  onFrame?: (faces: DetectionBox[], persons: DetectionBox[]) => void;
  /**
   * Magnification asked of the capture session, as a factor over the device's
   * neutral position. 1 means the sensor delivers its full field of view.
   *
   * This is the only zoom that reaches the recorded file: the viewfinder's
   * transform scales a React Native view, which the encoder never sees.
   */
  cameraZoom?: number;
  /**
   * How far this device can actually be zoomed, in the same factor. Reported
   * because the caller decides the zoom and only the device knows its ceiling.
   */
  onZoomRange?: (maxFactor: number) => void;
  /** Handed up so the recorder can call `startRecording`/`stopRecording` on it. */
  cameraRef?: RefObject<Camera | null>;
  /** Camera and model failures, which are otherwise completely silent. */
  onProblem?: (message: string | null) => void;
  /**
   * The capture session died and no frame is coming until something restarts
   * it — separate from `onProblem`, which also carries a model that would not
   * load and a frame-processor error, neither of which stops the session.
   */
  onSessionError?: (message: string) => void;
  /**
   * Called before each native call the analysis makes, so a crash that takes
   * the process down still says which one it was in. See `frameTrace.ts`.
   */
  onStage?: (stage: FrameStage) => void;
}

/**
 * Live camera preview, on-device person/animal detection, and face detection
 * for the auto-zoom.
 *
 * Returns null if there's no permission or no matching device — the caller
 * (Viewfinder) falls back to the decorative standby view in that case.
 */
export function CameraFeed({
  style, active, viewWidth, viewHeight, onFrame, cameraZoom = 1, onZoomRange, cameraRef,
  onProblem, onSessionError, onStage,
}: CameraFeedProps) {
  const { perms, settings: chosen, autoTune, foreground, reportDetections } = useAppState();
  /**
   * What the user asked for, minus whatever the device has been measured to be
   * unable to hold up (see `autoTune.ts`). Only the two costs the ladder can
   * remove differ from `chosen`; everything else here reads the same value it
   * always did.
   */
  const settings = useMemo(() => tunedSettings(chosen, autoTune), [chosen, autoTune]);

  const cameraPosition = devicePositionFor(settings.camera);
  const device = useCameraDevice(cameraPosition, physicalDeviceFilterFor(settings.camera));

  // The recording quality setting picks the format; without this the camera
  // would record at whatever default the device chooses and the 720p/1080p/4K
  // rows would mean nothing.
  //
  // It also sets the size of the frames this component analyses: VisionCamera
  // builds the frame-processor ImageAnalysis `.forSize(format.videoSize)`, so
  // recording in 4K means downscaling 8.3 MP to 320x320 on every analysed
  // frame instead of 2.1 MP. There is no separate analysis resolution to ask
  // for in VisionCamera 4, so the cost is inherent — Setup says so rather than
  // hiding it.
  const format = useCameraFormat(device, [
    { videoResolution: qualityResolution(settings.quality) },
  ]);

  const { resize } = useResizePlugin();
  const precise = settings.preciseDetection;
  // `failed` used to be computed and thrown away, so a model both delegates
  // refused looked exactly like a working camera that never sees anything.
  const { model, failed: modelFailed } = useDetectionModel(
    precise ? MODEL_PRECISE : MODEL_STANDARD,
    settings.forceCpu,
  );
  const inputSize = precise ? PRECISE_INPUT_SIZE : STANDARD_INPUT_SIZE;

  useEffect(() => {
    if (!onProblem) return;
    onProblem(modelFailed ? t('error.model') : null);
  }, [modelFailed, onProblem]);

  // Recorded as soon as the camera is asked to open, because opening it is
  // itself native work: CameraX configures a session and binds an ImageAnalysis
  // use case, and a device that dies there never reaches the frame processor at
  // all. Without this, the trace such a launch leaves is empty — indistinguishable
  // from a launch that never started surveillance.
  useEffect(() => {
    // Gated on the same condition the render is: with no permission or no
    // device this component draws nothing, and blaming a camera that was never
    // opened would send the reader after the wrong failure.
    if (active && perms.cam && device != null) onStage?.('camera');
  }, [active, device, onStage, perms.cam]);

  // `autoMode` asks the plugin to scale and rotate face bounds natively against
  // the window size we hand it — passing the viewfinder's own size means bounds
  // come back in viewfinder pixels, so no rotation maths is needed on our side.
  //
  // Memoized on the values it actually contains, because `useFaceDetector`
  // memoizes on the options object's *identity*: an object literal built during
  // render made it construct a fresh native plugin — and with it a fresh ML Kit
  // FaceDetector, which nothing ever closes — on every single render, while
  // also churning `detectFaces` and so rebuilding the frame processor worklet
  // at the same rate.
  const faceDetectorOptions = useMemo(() => ({
    performanceMode: 'fast' as const,
    landmarkMode: 'none' as const,
    contourMode: 'none' as const,
    classificationMode: 'none' as const,
    minFaceSize: 0.1,
    trackingEnabled: true,
    cameraFacing: cameraPosition,
    autoMode: true,
    windowWidth: viewWidth || 1,
    windowHeight: viewHeight || 1,
  }), [cameraPosition, viewWidth, viewHeight]);
  const faceDetector = useFaceDetector(faceDetectorOptions);
  const { detectFaces } = faceDetector;

  // ML Kit's plugin registers a device-orientation listener on Android and
  // nothing in the library takes it back down; `stopListeners` is the only
  // teardown it exposes. A new plugin instance is built whenever the options
  // above change, so this runs on every one of them, not just on unmount.
  useEffect(() => {
    return () => {
      faceDetector.stopListeners();
    };
  }, [faceDetector]);

  const onJsFrame = useRunOnJS((
    detections: FrameDetection[],
    faces: DetectionBox[],
    frameAspect: number,
  ) => {
    reportDetections(detections, frameAspect);
    if (!onFrame) return;
    const persons = detections
      .filter(d => d.kind === 'Personne')
      .map(d => uprightBoxToViewBox(d.box, frameAspect, viewWidth, viewHeight));
    onFrame(faces, persons);
  }, [reportDetections, onFrame, viewWidth, viewHeight]);

  // Only the text crosses back: an Error object cannot be copied between the
  // two runtimes, and the worklet holds no `Error` we could hand over anyway.
  const onFrameError = useRunOnJS((message: string) => {
    onProblem?.(frameErrorMessage(message));
  }, [onProblem]);

  // Deliberately unconditional, and deliberately not gated on a flag the
  // worklet reads. A flag would have to be a captured value — which the
  // compiler freezes at build time — or a shared value, whose `.value` the
  // compiler hoists into a copy. Both would silently stop tracing. The cost of
  // getting it wrong is a diagnostic that lies; the cost of always hopping is
  // four cross-runtime calls per analysed frame, against a resize and an
  // inference that each take milliseconds. The JS side stops recording as soon
  // as one frame gets through (see `reportFrameStage`).
  const onFrameStage = useRunOnJS((stage: FrameStage) => {
    onStage?.(stage);
  }, [onStage]);

  // Reported as headroom over neutral, which is the unit the caller works in.
  const maxZoomFactor = device ? device.maxZoom / device.neutralZoom : 1;
  useEffect(() => { onZoomRange?.(maxZoomFactor); }, [maxZoomFactor, onZoomRange]);

  // "Sensibilité" sets three things that trade against each other; the other
  // two reach the tracker, in `reportDetections` (see `sensitivity.ts`).
  const targetFps = SENSITIVITY_PROFILES[settings.sens].fps;
  const detectPerson = settings.person;
  const detectAnimal = settings.animal;
  const autoZoom = settings.autoZoom;
  const viewW = viewWidth || 1;
  const viewH = viewHeight || 1;

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    if (model == null) return;

    // Analysed on the thread CameraX delivers the frame on, not handed to
    // `runAsync`. `runAsync` moves the work to a second worklet context and
    // keeps the frame alive across threads, and that is where this app died:
    // a SIGSEGV on `VisionCamera.video` a few frames after the preview
    // appeared, with the ImageReader then running out of buffers because the
    // frames it was holding were never closed. Upstream has the same crash
    // open on the same thread (mrousavy/react-native-vision-camera#2589),
    // release builds only.
    //
    // What it costs: the analysis blocks the analyser thread. That is what
    // `runAtTargetFps` and CameraX's backpressure are for — the producer waits
    // or the frame is dropped, which is exactly what looking five times a
    // second already means. The preview is a separate use case and keeps its
    // own frame rate.
    runAtTargetFps(targetFps, () => {
      'worklet';
      // Everything analysis does per frame sits inside this `try`, because
      // outside it VisionCamera hands whatever escapes to `reportFatalError`
      // and the app closes. A failing detector is a degraded camera; it must
      // read as a message in the viewfinder, not as the app disappearing.
      try {
        // Each `onFrameStage` names the call that comes next, never the one
        // that just finished: libyuv, LiteRT and ML Kit can all end the
        // process outright, and a record of the last thing that worked names
        // everything except the culprit.
        onFrameStage('resize');
        // Feed the model the WHOLE frame, uprighted. An earlier version let the
        // plugin centre-crop to a square, which threw away the sides of the
        // field of view, and left the scene rotated for a portrait-held phone.
        //
        // Uniformly scaled into a corner of the square rather than stretched to
        // fill it: the plugin resizes to exactly the size it is given, so asking
        // for 320x320 squashed a 16:9 frame and handed the detector people 1.78x
        // too wide (see `letterbox.ts`). The plugin scales *before* it rotates,
        // so the size asked for is in the frame buffer's own axes — swapped for
        // a landscape-held phone, whose buffer is uprighted by a quarter turn.
        const aspect = uprightAspect(frame.width, frame.height, frame.orientation);
        const inner = letterboxFor(aspect, inputSize);
        const swap = swapsAxes(frame.orientation);
        const resized = resize(frame, {
          crop: { x: 0, y: 0, width: frame.width, height: frame.height },
          scale: swap
            ? { width: inner.height, height: inner.width }
            : { width: inner.width, height: inner.height },
          rotation: uprightRotation(frame.orientation),
          pixelFormat: 'rgb',
          dataType: 'uint8',
        });
        const input = letterboxInto(resized, inner, inputSize, MODEL_INPUT_CHANNELS);
        onFrameStage('inference');
        // The model's 4 outputs are always float32 (see interpretDetections' doc comment).
        const outputs = model.runSync([input]) as Float32Array[];
        const detections = interpretDetections(outputs, {
          detectPerson,
          detectAnimal,
          floorConfidence: DETECTION_FLOOR,
          // Boxes come back as fractions of the square, so the padded axis has
          // to be stretched back out before anything downstream sees them.
          scaleX: inputSize / inner.width,
          scaleY: inputSize / inner.height,
        });

        // ML Kit is asked only when its answer can change something. Since the
        // zoom frames whole people, a face no longer decides how close to get —
        // it decides *which* person to follow, and with one person in shot
        // there is nothing to decide. Skipping it there drops a native call per
        // analysed frame in by far the commonest case. What it costs is the
        // union that recovers a head the person box clipped, for a lone
        // subject; the framing pads the box anyway, so that is a slightly
        // tighter shot rather than a missing one.
        let people = 0;
        for (let i = 0; i < detections.length; i++) {
          if (detections[i].kind === 'Personne') people++;
        }

        const faces: DetectionBox[] = [];
        if (autoZoom && people > 1) {
          onFrameStage('faces');
          // ML Kit failing is not detection failing. Auto-zoom is cosmetic;
          // seeing a person is what the app is for, and it has already been
          // done by this point — so a face detector that throws costs the
          // framing, not the frame. Reported rather than swallowed: at five
          // frames a second an unreported failure is invisible, and the trace
          // cannot name it either, since reaching `report` clears the record.
          // The reported text is identical every frame, so the state update
          // that carries it bails out and nothing re-renders.
          try {
            const detected = detectFaces(frame);
            for (let i = 0; i < detected.length; i++) {
              const b = detected[i]?.bounds;
              if (b == null) continue;
              faces.push({ x: b.x / viewW, y: b.y / viewH, width: b.width / viewW, height: b.height / viewH });
            }
          } catch (e) {
            const failure = e as { message?: string } | undefined;
            onFrameError(failure?.message ?? 'erreur inconnue');
          }
        }

        onFrameStage('report');
        onJsFrame(detections, faces, aspect);

      } catch (e) {
        // Plain property access, no `instanceof`: the worklet runtime is not
        // the one this value's prototype came from.
        const failure = e as { message?: string } | undefined;
        onFrameError(failure?.message ?? 'erreur inconnue');
      }
    });
  }, [model, inputSize, resize, onJsFrame, onFrameError, onFrameStage, detectFaces, autoZoom, viewW, viewH, targetFps, detectPerson, detectAnimal]);

  if (!perms.cam || device == null) return null;

  return (
    <Camera
      ref={cameraRef}
      // Expressed against the device's neutral position rather than as a raw
      // factor: on a multi-physical camera `neutralZoom` is the wide-angle
      // lens, and passing 1 there would start the session on the fish-eye.
      zoom={Math.min(Math.max(device.neutralZoom * cameraZoom, device.minZoom), device.maxZoom)}
      style={style}
      device={device}
      format={format}
      isActive={active}
      // Streamed only while somebody can see it. `isActive` stays true: the
      // session, the analysis and the recording must all carry on with the
      // screen off, which is what the foreground service exists for — it is
      // the preview output alone that has no reader.
      //
      // Toggled on going to and from the background, never on starting or
      // stopping a recording: a preview output added or removed mid-clip is a
      // capture-session reconfiguration, and this project has already paid for
      // one of those between two clips.
      //
      // Keep preview active when monitoring or recording, so CameraX session / frame pipeline
      // does not freeze or reconfigure when backgrounded.
      preview={foreground || active}
      frameProcessor={active ? frameProcessor : undefined}
      pixelFormat="yuv"
      resizeMode="cover"
      // CameraX hands the session back on a phone call, on another app opening
      // the camera, on an OEM policy reclaiming it. Painting the message in the
      // viewfinder was the whole response, on the one screen a surveillance
      // phone keeps switched off.
      onError={error => onSessionError?.(t('error.camera', { message: error.message }))}
      video={true}
      // Audio is only captured once the OS microphone permission is actually
      // granted — asking the camera for audio without it aborts the recording.
      audio={perms.mic}
      videoBitRate={qualityBitRate(settings.quality)}
      lowLightBoost={settings.night && device.supportsLowLightBoost}
    />
  );
}
