/**
 * That the cinematic move actually drives the transform, with the right numbers.
 *
 * `autoZoom.test.tsx` covers the phases and their timing; `framing.test.ts` and
 * `orientation.test.ts` cover the geometry. Nothing covered the seam: the hook
 * could sequence every phase perfectly and hand the animation a framing for the
 * wrong corner of the screen, and the whole suite would stay green.
 *
 * The values cannot be read back. The transform animates on the native driver —
 * which is the point, so inference cannot stutter it — and under Jest the JS
 * copy of an `Animated.Value` driven that way never moves: `__getValue()`
 * answers 1 / 0 / 0 from mount to teardown, whatever the animation did. What
 * the hook asks for is observable, though, so that is what this asserts.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Animated } from 'react-native';
import {
  CLOSE_HOLD_MS, CLOSE_ZOOM_IN_MS, RELEASE_MS, useAutoZoom, WIDE_ZOOM_OUT_MS,
} from '../src/camera/useAutoZoom';
import { DetectionBox } from '../src/ml/types';
import { DEFAULT_TRACKER_OPTIONS, iou } from '../src/ml/tracker';
import { boxInZoomedFrame, CAPTURE_ZOOM_CEILING } from '../src/camera/framing';

const VIEW_W = 360;
const VIEW_H = 640;

/** Standing left of centre, high in the frame — a person, head to toe. */
const PERSON_LEFT: DetectionBox = { x: 0.10, y: 0.14, width: 0.16, height: 0.45 };
/** Mirrored, for the sign of the pan. */
const PERSON_RIGHT: DetectionBox = { x: 0.74, y: 0.14, width: 0.16, height: 0.45 };
/** Dead centre, where a centre crop can magnify furthest. */
const PERSON_CENTRED: DetectionBox = { x: 0.42, y: 0.30, width: 0.16, height: 0.40 };
/** Hard against the left edge: a centre crop cannot magnify this at all. */
const PERSON_AT_EDGE: DetectionBox = { x: 0, y: 0.30, width: 0.16, height: 0.40 };
/** Where a face sits on `PERSON_LEFT` — inside them, near the top. */
const FACE_ON_LEFT: DetectionBox = { x: 0.145, y: 0.15, width: 0.07, height: 0.07 };

const T0 = 1_780_000_000_000;

interface Move {
  scale: number;
  translateX: number;
  translateY: number;
  duration: number;
}

interface Harness {
  zoom: ReturnType<typeof useAutoZoom>;
  /** Every completed move the hook asked for, oldest first. */
  moves: () => Move[];
}

/**
 * Mounts the hook with `Animated.timing` under a spy.
 *
 * The spy calls through, so the real animation still runs — this only records
 * what each of the three channels was asked to reach, and in how long.
 */
function mount({ enabled = true, maxCameraZoom = 1 } = {}): Harness {
  const timing = jest.spyOn(Animated, 'timing');
  const box = {} as { zoom: ReturnType<typeof useAutoZoom> };

  function Probe({ on }: { on: boolean }) {
    box.zoom = useAutoZoom({ enabled: on, viewWidth: VIEW_W, viewHeight: VIEW_H, maxCameraZoom });
    return null;
  }
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => { tree = ReactTestRenderer.create(<Probe on={enabled} />); });

  const moves = () => {
    const out: Move[] = [];
    // The three channels are always started together, in one parallel group.
    for (let i = 0; i < timing.mock.calls.length; i += 3) {
      const group = timing.mock.calls.slice(i, i + 3);
      if (group.length < 3) break;
      const byChannel = new Map<unknown, { toValue: number; duration: number }>();
      for (const [value, config] of group) {
        byChannel.set(value, {
          toValue: config.toValue as number,
          duration: (config as { duration: number }).duration,
        });
      }
      const s = byChannel.get(box.zoom.scale)!;
      out.push({
        scale: s.toValue,
        translateX: byChannel.get(box.zoom.translateX)!.toValue,
        translateY: byChannel.get(box.zoom.translateY)!.toValue,
        duration: s.duration,
      });
    }
    return out;
  };

  return Object.assign(box as Harness, {
    moves,
    setEnabled: (on: boolean) => {
      ReactTestRenderer.act(() => { tree.update(<Probe on={on} />); });
    },
  }) as Harness & { setEnabled: (on: boolean) => void };
}

/** One report from the frame processor, at wall-clock `at`. */
function report(h: Harness, at: number, faces: DetectionBox[], persons: DetectionBox[]) {
  jest.setSystemTime(T0 + at);
  ReactTestRenderer.act(() => { h.zoom.submitFrame(faces, persons); });
}

/** Two sightings, which is the streak a close shot needs. */
function seePerson(h: Harness, person: DetectionBox, faces: DetectionBox[] = []) {
  report(h, 0, faces, [person]);
  report(h, 200, faces, [person]);
}

/** Where a frame-space box lands on screen once a move has been applied. */
function onScreen(box: DetectionBox, move: Move): DetectionBox {
  const project = (v: number, s: number, pan: number, size: number) =>
    (v - 0.5) * s + 0.5 + pan / size;
  return {
    x: project(box.x, move.scale, move.translateX, VIEW_W),
    y: project(box.y, move.scale, move.translateY, VIEW_H),
    width: box.width * move.scale,
    height: box.height * move.scale,
  };
}

function wait(ms: number) {
  ReactTestRenderer.act(() => { jest.advanceTimersByTime(ms); });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
  jest.restoreAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('magnifies when it eases in on someone', () => {
  const h = mount();
  seePerson(h, PERSON_LEFT);

  const [move] = h.moves();
  // A "close shot" that does not magnify is the failure this cannot detect from
  // phases alone: the machine would report `close` either way.
  expect(move.scale).toBeGreaterThan(1);
  expect(move.duration).toBe(CLOSE_ZOOM_IN_MS);
});

/**
 * The point of the change: the move frames a person, entire.
 *
 * Framed on the face box — which is what this used to do — a subject at this
 * distance is magnified until their own feet are off screen, and the recording
 * keeps a portrait instead of what the person was doing. Asserted on the
 * projected rectangle rather than on the scale, because it is the subject
 * leaving the shot that is the failure, not any particular number.
 */
describe('what ends up in the shot', () => {
  const cases: Array<[string, DetectionBox, DetectionBox[]]> = [
    ['left of centre', PERSON_LEFT, []],
    ['left of centre, face detected', PERSON_LEFT, [FACE_ON_LEFT]],
    ['right of centre', PERSON_RIGHT, []],
    ['centred', PERSON_CENTRED, []],
    ['against an edge', PERSON_AT_EDGE, []],
  ];

  it.each(cases)('keeps the whole person in frame: %s', (_label, person, faces) => {
    const h = mount();
    seePerson(h, person, faces);

    const shot = onScreen(person, h.moves()[0]);
    expect({
      top: shot.y >= -1e-6,
      bottom: shot.y + shot.height <= 1 + 1e-6,
      left: shot.x >= -1e-6,
      right: shot.x + shot.width <= 1 + 1e-6,
    }).toEqual({ top: true, bottom: true, left: true, right: true });
  });

  it('frames the same person whether or not their face was found', () => {
    const withFace = mount();
    seePerson(withFace, PERSON_LEFT, [FACE_ON_LEFT]);
    const framedWithFace = withFace.moves()[0];

    jest.restoreAllMocks();
    const without = mount();
    seePerson(without, PERSON_LEFT);
    const framedWithout = without.moves()[0];

    // A face inside the subject says *who* to look at, never how close to get:
    // the two framings differ only by the face's own union with the body, which
    // here is entirely inside it.
    expect(framedWithFace.scale).toBeCloseTo(framedWithout.scale, 6);
    expect(framedWithFace.translateX).toBeCloseTo(framedWithout.translateX, 6);
    expect(framedWithFace.translateY).toBeCloseTo(framedWithout.translateY, 6);
  });

  it('looks at the person whose face was found, not simply the biggest', () => {
    const h = mount();
    // Bigger, nearer, turned away — and a smaller one facing the camera.
    const turnedAway: DetectionBox = { x: 0.60, y: 0.20, width: 0.30, height: 0.70 };
    const facing: DetectionBox = { x: 0.08, y: 0.30, width: 0.16, height: 0.40 };
    const theirFace: DetectionBox = { x: 0.12, y: 0.31, width: 0.07, height: 0.07 };

    report(h, 0, [theirFace], [turnedAway, facing]);
    report(h, 200, [theirFace], [turnedAway, facing]);

    // Left of centre: the camera moves right. Framed on the larger figure it
    // would go the other way.
    expect(h.moves()[0].translateX).toBeGreaterThan(0);
  });
});

it('pans towards the subject rather than away from it', () => {
  const left = mount();
  seePerson(left, PERSON_LEFT);
  const leftMove = left.moves()[0];

  jest.restoreAllMocks();
  const right = mount();
  seePerson(right, PERSON_RIGHT);
  const rightMove = right.moves()[0];

  // Someone left of centre has to be brought right, and vice versa. A sign
  // error here frames the opposite corner of the screen — and every phase and
  // every geometry test still passes, because neither looks at the two together.
  expect(leftMove.translateX).toBeGreaterThan(0);
  expect(rightMove.translateX).toBeLessThan(0);
  // Both stand high in the frame, so both pull the image down.
  expect(leftMove.translateY).toBeGreaterThan(0);
  expect(rightMove.translateY).toBeGreaterThan(0);
});

it('never pans far enough to expose an edge', () => {
  const h = mount();
  seePerson(h, PERSON_LEFT);
  wait(CLOSE_ZOOM_IN_MS + CLOSE_HOLD_MS);      // through to the wide shot
  report(h, 6000, [], [PERSON_LEFT]);

  for (const move of h.moves()) {
    // At scale s the image overhangs the view by (s-1)/2 on each side; panning
    // past that slides the frame's own border into shot.
    const maxX = ((move.scale - 1) * VIEW_W) / 2;
    const maxY = ((move.scale - 1) * VIEW_H) / 2;
    expect(Math.abs(move.translateX)).toBeLessThanOrEqual(maxX + 1e-6);
    expect(Math.abs(move.translateY)).toBeLessThanOrEqual(maxY + 1e-6);
  }
});

it('pulls back to a wider shot than the close one, without zooming out past 1x', () => {
  const h = mount();
  seePerson(h, PERSON_LEFT);
  const closeUp = h.moves()[0];

  wait(CLOSE_ZOOM_IN_MS + CLOSE_HOLD_MS);
  const wide = h.moves()[h.moves().length - 1];

  expect(wide.duration).toBe(WIDE_ZOOM_OUT_MS);
  // The whole point of the move: the wide shot shows more than the close one.
  expect(wide.scale).toBeLessThan(closeUp.scale);
  // But it is still a framing, not a zoom-out — 1x is the floor.
  expect(wide.scale).toBeGreaterThanOrEqual(1);
});

/**
 * The magnification the recorded file actually receives.
 *
 * A React Native transform scales the preview view; the encoder sits downstream
 * of the capture session and never sees it. Only `<Camera zoom>` reaches the
 * file — and it is a centre crop with no pan, which is what makes this delicate
 * rather than a one-line change.
 */
describe('the zoom that reaches the recording', () => {
  it('leaves the capture alone while the move is still running', () => {
    const h = mount({ maxCameraZoom: 8 });
    seePerson(h, PERSON_CENTRED);

    // Changing it mid-move would jump the preview: the transform is animating
    // towards a framing computed against the field of view it started from.
    expect(h.zoom.cameraZoom).toBe(1);
  });

  it('hands the magnification to the sensor once the preview has arrived', () => {
    const h = mount({ maxCameraZoom: 8 });
    seePerson(h, PERSON_CENTRED);
    wait(CLOSE_ZOOM_IN_MS);

    // Without this the close shot exists only on screen, which is the whole
    // complaint this answers.
    expect(h.zoom.cameraZoom).toBeGreaterThan(1);
  });

  it('gives back exactly what it took, so the preview does not jump', () => {
    const h = mount({ maxCameraZoom: 8 });
    seePerson(h, PERSON_CENTRED);
    const asked = h.moves()[h.moves().length - 1].scale;

    wait(CLOSE_ZOOM_IN_MS);

    // Read off the value rather than the animation: the hand-over is a `setValue`
    // in the same commit as the zoom, deliberately not an animation — there is
    // nothing to animate, since the product must not change at all.
    const residual = (h.zoom.scale as unknown as { __getValue: () => number }).__getValue();
    expect(h.zoom.cameraZoom).toBeGreaterThan(1);
    // The product is what the viewer sees. The transform shrinks by exactly the
    // factor the sensor gained, so the screen shows nothing happen.
    expect(residual * h.zoom.cameraZoom).toBeCloseTo(asked, 3);
  });

  it('refuses to crop a subject out of the recording to zoom in on it', () => {
    const h = mount({ maxCameraZoom: 8 });
    // Hard against the left edge. A centre crop at the scale the preview uses
    // would put this person entirely outside the recorded frame — on a
    // surveillance camera, losing the only thing worth recording.
    seePerson(h, PERSON_AT_EDGE);
    wait(CLOSE_ZOOM_IN_MS);

    expect(h.zoom.cameraZoom).toBe(1);
    // The preview still frames them, because its transform can pan.
    expect(h.moves()[0].scale).toBeGreaterThan(1);
  });

  it('never stops watching more than half the room', () => {
    const h = mount({ maxCameraZoom: 8 });
    seePerson(h, PERSON_CENTRED);
    wait(CLOSE_ZOOM_IN_MS);

    // The crop reaches the detection model as well as the file: past this, more
    // of the room is unwatched than watched, and someone walking in from the
    // side during the hold is neither filmed nor seen.
    expect(h.zoom.cameraZoom).toBeLessThanOrEqual(CAPTURE_ZOOM_CEILING);
    expect(h.zoom.cameraZoom).toBeGreaterThan(1);
  });

  it('never asks for more than the device can do', () => {
    const h = mount({ maxCameraZoom: 1.5 });
    seePerson(h, PERSON_CENTRED);
    wait(CLOSE_ZOOM_IN_MS);

    expect(h.zoom.cameraZoom).toBeLessThanOrEqual(1.5);
  });

  it('stays at 1 on a device that cannot zoom, with the preview unaffected', () => {
    const h = mount();   // maxCameraZoom defaults to 1
    seePerson(h, PERSON_CENTRED);
    wait(CLOSE_ZOOM_IN_MS);

    expect(h.zoom.cameraZoom).toBe(1);
    expect(h.moves()[0].scale).toBeGreaterThan(1);
  });

  it('gives the sensor back its full field of view when the subject leaves', () => {
    const h = mount({ maxCameraZoom: 8 });
    seePerson(h, PERSON_CENTRED);
    wait(CLOSE_ZOOM_IN_MS);
    expect(h.zoom.cameraZoom).toBeGreaterThan(1);

    report(h, 400, [], []);
    wait(CLOSE_HOLD_MS);

    // Anything else leaves the camera permanently cropped, recording a slice of
    // the room it was pointed at.
    expect(h.zoom.cameraZoom).toBe(1);
  });

  /**
   * The property the capture bound exists for, read off the hook rather than
   * recomputed. A sweep that redid the arithmetic itself would go on passing
   * after the hook stopped calling it — which is exactly what happened to the
   * first version of this, and how a flat ceiling looked like it worked.
   *
   * The box swept is now one of the tracker's own: the move frames people, so
   * the bound is measured on the very box `updateTracks` will compare.
   */
  it('never zooms further than the tracker can follow, wherever they stand', () => {
    const positions = [0, 0.08, 0.16, 0.24, 0.32, 0.43];

    for (const x of positions) {
      jest.restoreAllMocks();
      const h = mount({ maxCameraZoom: 8 });
      const person = { x, y: 0.30, width: 0.14, height: 0.40 };
      seePerson(h, person);
      wait(CLOSE_ZOOM_IN_MS);

      // Same measure the tracker will apply, on the same box it holds: below
      // its threshold the subject is dropped and re-confirmed from scratch,
      // leaving no confirmed detection at all for a couple of frames.
      const overlap = iou(person, boxInZoomedFrame(person, h.zoom.cameraZoom));
      expect({ x, overlap: overlap >= DEFAULT_TRACKER_OPTIONS.iouThreshold })
        .toEqual({ x, overlap: true });
    }
  });

  it('releases the capture when the setting is switched off mid-move', () => {
    const h = mount({ maxCameraZoom: 8 }) as Harness & { setEnabled: (on: boolean) => void };
    seePerson(h, PERSON_CENTRED);
    wait(CLOSE_ZOOM_IN_MS);
    expect(h.zoom.cameraZoom).toBeGreaterThan(1);

    h.setEnabled(false);

    expect(h.zoom.cameraZoom).toBe(1);
  });
});

it('returns the transform to neutral when the subject is gone', () => {
  const h = mount();
  seePerson(h, PERSON_LEFT);
  report(h, 400, [], []);
  wait(CLOSE_HOLD_MS);      // past the lost grace period

  const last = h.moves()[h.moves().length - 1];
  // Anything short of exactly neutral leaves the preview permanently cropped.
  expect(last).toMatchObject({ scale: 1, translateX: 0, translateY: 0 });
});

it('releases the zoom when the setting is switched off mid-move', () => {
  const h = mount() as Harness & { setEnabled: (on: boolean) => void };
  seePerson(h, PERSON_LEFT);
  expect(h.zoom.phase).toBe('close');

  h.setEnabled(false);

  // Consuming the setting, not just storing it: a switch that leaves the
  // preview cropped on a subject is a switch that did nothing.
  expect(h.zoom.phase).toBe('idle');
  const last = h.moves()[h.moves().length - 1];
  expect(last).toMatchObject({ scale: 1, translateX: 0, translateY: 0 });
  expect(last.duration).toBe(RELEASE_MS);
});

it('moves all three channels as one gesture', () => {
  const h = mount();
  seePerson(h, PERSON_LEFT);
  wait(CLOSE_ZOOM_IN_MS + CLOSE_HOLD_MS);

  // Recorded per move by construction above; this pins the reason it holds —
  // three channels on three durations is a wobble, not a camera move.
  const timing = Animated.timing as unknown as jest.SpyInstance;
  const durations = timing.mock.calls.map(([, config]) => (config as { duration: number }).duration);
  for (let i = 0; i < durations.length; i += 3) {
    expect(new Set(durations.slice(i, i + 3)).size).toBe(1);
  }
});
