import { KIND_BY_CLASS_INDEX } from './labels';
import { DetectionBox, FrameDetection } from './types';

export interface InterpretOptions {
  detectPerson: boolean;
  detectAnimal: boolean;
  /**
   * Association floor, 0–1 — *not* the user's "seuil de confiance".
   *
   * Everything above this is handed to the tracker; what the user set decides
   * which of those may open a track (`startConfidence` in `tracker.ts`). The two
   * were one number, and the cost was every box under it never existing at all:
   * a subject seen at 0.82 and then, half-turned or half-lit, at 0.51 looked to
   * the tracker exactly like a subject who had left. Keeping the weak looks lets
   * a track that a strong look opened survive on them.
   */
  floorConfidence: number;
  /**
   * Un-letterbox factors: the model was fed the frame scaled into the top-left
   * of its square input (see `letterbox.ts`), so a coordinate it returns is a
   * fraction of the *square*, not of the frame. 1 when nothing was padded.
   */
  scaleX: number;
  scaleY: number;
}

/**
 * Two hypotheses of different kinds overlapping by more than this are the same
 * subject seen twice, and the weaker one is dropped.
 */
const CROSS_CLASS_IOU = 0.6;

/**
 * Smallest side a box may have, as a fraction of the frame, to be a subject at
 * all — a hundredth of the frame, which is four pixels of the detector's own
 * 448 px input and about ten of a 1080p frame.
 *
 * Nothing the model can genuinely have recognised is that thin, and two kinds
 * of box are: a sliver of noise, and one the clamp above has flattened because
 * the model put it (partly or wholly) outside the frame. The flattened ones are
 * worse than useless downstream. A box with no area cannot be associated with
 * anything — `iou` reads 0 and the tracker's proximity fallback refuses a zero
 * area outright — so it can only ever *open* a track and never continue one:
 * a new id every frame, and at "Basse", where one look confirms, a recording.
 */
const MIN_BOX_SIDE = 0.01;

/**
 * Decodes the 4 output tensors of the bundled detection model
 * (efficientdet-lite0.tflite). Verified against the model file itself:
 *   [0] locations  — [1, N, 4] normalized (yMin, xMin, yMax, xMax) per box
 *   [1] classes    — [1, N] float class index into COCO_LABELS
 *   [2] scores     — [1, N] float confidence, 0–1
 *   [3] numDetections — [1] float, how many of the N slots are valid
 * (N is 25 for this model; the code reads it from the tensors rather than
 * assuming, so a model swap does not silently truncate detections.)
 * This 4-output order is fixed by the postprocessing op baked into the
 * model file, not something this app controls. The TFLite_Detection_PostProcess
 * op always emits float32 tensors here regardless of the model's quantized input,
 * so these are plain Float32Arrays (react-native-fast-tflite's TypedArray union
 * also covers Int/BigInt variants that don't apply to this model's outputs).
 *
 * Boxes come out normalized to the uprighted full frame.
 *
 * Runs on the camera's frame-processor thread — must stay a worklet.
 */
/** Worklet-safe: local helpers, not closures over anything outside. */
function clamp01(value: number): number {
  'worklet';
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Overlap of two boxes, as a fraction of their union.
 *
 * Deliberately a copy of the tracker's `iou` rather than an import of it: that
 * one is plain JavaScript, and a plain function reached from a worklet is
 * replaced by a stub that throws on the first call (see `orientation.ts`).
 */
function overlapOf(a: DetectionBox, b: DetectionBox): number {
  'worklet';
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return 0;
  const overlap = w * h;
  const union = a.width * a.height + b.width * b.height - overlap;
  return union > 0 ? overlap / union : 0;
}

export function interpretDetections(outputs: Float32Array[], options: InterpretOptions): FrameDetection[] {
  'worklet';

  const locations = outputs[0];
  const classes = outputs[1];
  const scores = outputs[2];
  const numDetections = outputs[3];

  const count = Math.min(Math.round(numDetections[0] ?? 0), scores.length);
  const results: FrameDetection[] = [];

  for (let i = 0; i < count; i++) {
    const confidence = scores[i];
    if (confidence == null || confidence < options.floorConfidence) continue;

    // Indexed lookup, not a label string: the class index is what the model
    // emits, and a computed access is also the only member access the worklets
    // compiler carries into the closure whole (see `KIND_BY_CLASS_INDEX`).
    // An out-of-range or NaN index reads back undefined, which is the same
    // "not a kind we record" answer as an ignored class.
    const kind = KIND_BY_CLASS_INDEX[Math.round(classes[i])];
    if (kind == null) continue;
    if (kind === 'Personne' ? !options.detectPerson : !options.detectAnimal) continue;

    const o = i * 4;
    // Undo the letterbox first, clamp the corners, then derive the size from
    // them. Clamping the origin and the size independently — which this did —
    // inflates any box the model pushes past the frame edge, and edges are where
    // surveillance subjects live. A person entering at xMin -0.08, xMax 0.25
    // came out 0.33 wide instead of 0.25, and one leaving at xMax 1.14 produced
    // a box reaching 14% of the frame beyond its own right edge.
    const yMin = clamp01(locations[o] * options.scaleY);
    const xMin = clamp01(locations[o + 1] * options.scaleX);
    const yMax = clamp01(locations[o + 2] * options.scaleY);
    const xMax = clamp01(locations[o + 3] * options.scaleX);

    const width = xMax - xMin;
    const height = yMax - yMin;
    if (width < MIN_BOX_SIDE || height < MIN_BOX_SIDE) continue;

    results.push({
      kind,
      confidence,
      box: { x: xMin, y: yMin, width, height },
    });
  }

  results.sort((a, b) => b.confidence - a.confidence);

  // Cross-class suppression. The model's own NMS runs per class, so one subject
  // can be returned twice under two labels — a crouching or distant figure reads
  // as a dog or a bear often enough to matter now that the floor is low, and
  // each spurious Animal is its own track, its own notification and its own
  // history entry. Walking backwards over a list already sorted by confidence
  // means the survivor is always the stronger hypothesis.
  for (let i = results.length - 1; i > 0; i--) {
    for (let j = 0; j < i; j++) {
      if (results[j].kind === results[i].kind) continue;
      if (overlapOf(results[i].box, results[j].box) > CROSS_CLASS_IOU) {
        results.splice(i, 1);
        break;
      }
    }
  }

  return results;
}
