import type { DetectionKind } from '../state/types';

// COCO label map extracted from the bundled model's own metadata
// (assets/models/efficientdet-lite0.tflite → labelmap.txt).
//
// NOTE: unlike the older SSD MobileNet label file, this one is 0-indexed on
// 'person' — there is no leading '???' placeholder. Swapping models without
// swapping this array shifts every class by one and silently kills detection.
export const COCO_LABELS = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus',
  'train', 'truck', 'boat', 'traffic light', 'fire hydrant', '???',
  'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog',
  'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
  'giraffe', '???', 'backpack', 'umbrella', '???', '???',
  'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard',
  'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard',
  'tennis racket', 'bottle', '???', 'wine glass', 'cup', 'fork',
  'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich',
  'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut',
  'cake', 'chair', 'couch', 'potted plant', 'bed', '???',
  'dining table', '???', '???', 'toilet', '???', 'tv',
  'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'microwave',
  'oven', 'toaster', 'sink', 'refrigerator', '???', 'book',
  'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush',
] as const;

export const PERSON_LABELS = ['person'] as const;

// COCO has no "animal" superclass — these are its individual animal classes.
export const ANIMAL_LABELS = [
  'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe',
] as const;

/**
 * The kind each COCO class index maps to, or `null` for the classes NovaGuard
 * ignores. Indexed directly by the model's class output.
 *
 * Deliberately a plain array rather than the two `Set`s this used to be, and
 * built once here rather than looked up by label per detection.
 *
 * A `Set` cannot cross into a worklet. The worklets compiler saw
 * `PERSON_LABELS.has(...)` inside the frame processor and hoisted just the
 * method into the closure as `{ has: Set.prototype.has }` — a bare builtin on a
 * plain object, which throws the moment it is called. The frame processor died
 * on the first detection that cleared the threshold, taking the app with it:
 * the preview appeared, then the app closed. Nothing under Jest could see it,
 * because `babel.config.js` turns the worklets plugin off for tests — hence
 * `__tests__/workletSafety.test.ts`, which compiles the real worklets.
 */
export const KIND_BY_CLASS_INDEX: readonly (DetectionKind | null)[] = COCO_LABELS.map(label =>
  (PERSON_LABELS as readonly string[]).includes(label) ? 'Personne'
    : (ANIMAL_LABELS as readonly string[]).includes(label) ? 'Animal'
      : null,
);
