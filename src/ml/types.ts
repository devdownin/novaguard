import { DetectionKind } from '../state/types';

/** Normalized (0–1) box within the square region the model was fed. */
export interface DetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameDetection {
  kind: DetectionKind;
  /** 0–1 */
  confidence: number;
  box: DetectionBox;
}
