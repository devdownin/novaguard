/**
 * The cinematic move's timing, driven through the real state machine.
 *
 * The framing maths has its own tests (`framing.test.ts`); what this covers is
 * the part that was wrong — how long each phase is allowed to last, and what
 * the move is allowed to be *about*: a person, never a face on its own.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  CLOSE_HOLD_MS, CLOSE_ZOOM_IN_MS, FULL_CYCLE_MS, RELEASE_MS, RETRIGGER_COOLDOWN_MS,
  useAutoZoom, WIDE_DWELL_MS, WIDE_ZOOM_OUT_MS, ZoomPhase,
} from '../src/camera/useAutoZoom';
import { DetectionBox } from '../src/ml/types';

const FACE: DetectionBox = { x: 0.4, y: 0.25, width: 0.2, height: 0.2 };
const BODY: DetectionBox = { x: 0.3, y: 0.2, width: 0.4, height: 0.7 };

/** A plausible epoch: the retrigger check reads Date.now() against 0. */
const T0 = 1_780_000_000_000;

interface Harness {
  phase?: ZoomPhase;
  submit?: (faces: DetectionBox[], persons: DetectionBox[]) => void;
}

function mount(): Harness {
  const harness: Harness = {};
  function Probe() {
    const zoom = useAutoZoom({ enabled: true, viewWidth: 360, viewHeight: 640 });
    harness.phase = zoom.phase;
    harness.submit = zoom.submitFrame;
    return null;
  }
  ReactTestRenderer.act(() => { ReactTestRenderer.create(<Probe />); });
  return harness;
}

/** One report from the frame processor, at wall-clock `at`. */
function report(h: Harness, at: number, faces = [FACE], persons = [BODY]) {
  jest.setSystemTime(T0 + at);
  ReactTestRenderer.act(() => { h.submit!(faces, persons); });
}

function wait(ms: number) {
  ReactTestRenderer.act(() => { jest.advanceTimersByTime(ms); });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
});
afterEach(() => { jest.useRealTimers(); });

describe('timing constants', () => {
  it('never lets a new close shot interrupt the pull-back', () => {
    // The invariant the whole feature rests on. A literal 6000 here — which is
    // what shipped — is shorter than the 7000 ms cycle, so the wide shot was
    // cut off partway and never actually appeared.
    expect(RETRIGGER_COOLDOWN_MS).toBeGreaterThanOrEqual(FULL_CYCLE_MS);
  });

  /**
   * Literals on purpose: the rest of the suite reads these constants
   * symbolically, so it stays green at any speed — which is how the move ended
   * up feeling like a snap. Three seconds each way is the requirement.
   */
  it('takes three seconds to push in and three to pull back', () => {
    expect(CLOSE_ZOOM_IN_MS).toBe(3000);
    expect(WIDE_ZOOM_OUT_MS).toBe(3000);
    // Losing the subject widens the same way the scripted pull-back does.
    expect(RELEASE_MS).toBe(3000);
  });

  it('leaves the wide shot up long enough to be read', () => {
    expect(RETRIGGER_COOLDOWN_MS - FULL_CYCLE_MS).toBe(WIDE_DWELL_MS);
    expect(WIDE_DWELL_MS).toBeGreaterThan(WIDE_ZOOM_OUT_MS / 2);
  });
});

describe('the move, with someone standing in frame', () => {
  it('eases in on the person, holds, then pulls back to the whole scene', () => {
    const h = mount();

    report(h, 0);
    expect(h.phase).toBe('idle');   // one sighting is not a streak
    report(h, 200);
    expect(h.phase).toBe('close');

    wait(CLOSE_ZOOM_IN_MS + CLOSE_HOLD_MS);
    expect(h.phase).toBe('wide');
  });

  it('holds the wide shot past the end of the pull-back', () => {
    const h = mount();
    report(h, 0);
    report(h, 200);
    wait(CLOSE_ZOOM_IN_MS + CLOSE_HOLD_MS);

    // The subject stays, so reports keep arriving all the way through.
    for (let t = 5600; t <= FULL_CYCLE_MS + WIDE_DWELL_MS - 200; t += 200) {
      report(h, t);
      expect(h.phase).toBe('wide');
    }
  });

  it('is allowed to start over once the wide shot has had its turn', () => {
    const h = mount();
    report(h, 0);
    report(h, 200);
    wait(CLOSE_ZOOM_IN_MS + CLOSE_HOLD_MS);

    report(h, RETRIGGER_COOLDOWN_MS + 400);
    expect(h.phase).toBe('close');
  });
});

/**
 * What the move is about. The trigger used to be a face, which meant a subject
 * with their back to the camera — or in the dark, where this app is expected to
 * work — was never zoomed on at all, while a stray face where the person
 * detector saw nobody pulled the camera into a portrait.
 */
describe('what starts a move', () => {
  it('zooms on someone whose face is never detected', () => {
    const h = mount();

    report(h, 0, [], [BODY]);
    report(h, 200, [], [BODY]);

    expect(h.phase).toBe('close');
  });

  it('does nothing for a face with nobody attached to it', () => {
    const h = mount();

    report(h, 0, [FACE], []);
    report(h, 200, [FACE], []);
    report(h, 400, [FACE], []);

    expect(h.phase).toBe('idle');
  });
});

describe('when the subject leaves', () => {
  it('returns to the full frame', () => {
    const h = mount();
    report(h, 0);
    report(h, 200);
    expect(h.phase).toBe('close');

    report(h, 400, [], []);
    wait(5000);                      // past the lost-grace window
    expect(h.phase).toBe('idle');
  });

  it('lets go even while their face is still being detected', () => {
    const h = mount();
    report(h, 0);
    report(h, 200);

    // Person gone, face still coming back: there is no longer anything whole
    // to frame, so the camera must not sit on the leftover portrait.
    report(h, 400, [FACE], []);
    wait(5000);
    expect(h.phase).toBe('idle');
  });
});
