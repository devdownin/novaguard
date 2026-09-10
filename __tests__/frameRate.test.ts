/**
 * The cadence the device actually achieves.
 *
 * "Sensibilité" sets a target of 1, 3 or 5 frames per second, and nothing ever
 * checked it was met: `runAtTargetFps` stamps its clock before doing the work,
 * and `runAsync` silently drops a frame whose predecessor is still being
 * analysed. A phone that cannot keep up simply looks less often.
 *
 * @format
 */

import {
  countFrame, EMPTY_FRAME_RATE_WINDOW, formatFrameRate, FRAME_RATE_WINDOW_MS,
} from '../src/camera/frameRate';

const newWindow = () => ({ ...EMPTY_FRAME_RATE_WINDOW });

describe('countFrame', () => {
  it('says nothing until a full window has passed', () => {
    const window = newWindow();
    expect(countFrame(window, 1_000)).toBeNull();
    expect(countFrame(window, 1_500)).toBeNull();
  });

  it('opens the window on the first frame rather than counting it', () => {
    // Counting the first frame against a `since` of 0 divides by the whole
    // epoch, which reports 0.0 i/s for ever.
    const window = newWindow();
    countFrame(window, 1_700_000_000_000);
    expect(window.since).toBe(1_700_000_000_000);
    expect(window.count).toBe(0);
  });

  it('reports the rate the frames actually arrived at', () => {
    const window = newWindow();
    countFrame(window, 0);
    // Six frames spread across a two-second window is three per second.
    let rate: number | null = null;
    for (let i = 1; i <= 6; i++) {
      rate = countFrame(window, (FRAME_RATE_WINDOW_MS / 6) * i);
    }
    expect(rate).toBeCloseTo(3);
  });

  it('sees a device falling short of the target it was given', () => {
    // The case this exists for: "Haute" asks for 5 i/s, the phone manages 1.5.
    const window = newWindow();
    countFrame(window, 0);
    let rate: number | null = null;
    for (let i = 1; i <= 3; i++) rate = countFrame(window, (FRAME_RATE_WINDOW_MS / 3) * i);
    expect(rate).toBeCloseTo(1.5);
  });

  it('starts a fresh window after reporting, instead of averaging for ever', () => {
    const window = newWindow();
    countFrame(window, 0);
    for (let i = 1; i <= 10; i++) countFrame(window, (FRAME_RATE_WINDOW_MS / 10) * i);

    expect(window.count).toBe(0);
    expect(window.since).toBe(FRAME_RATE_WINDOW_MS);
    // A window that kept accumulating would still be reporting the old 5 i/s
    // here; this one has to see the new, slower rate.
    let rate: number | null = null;
    for (let i = 1; i <= 2; i++) {
      rate = countFrame(window, FRAME_RATE_WINDOW_MS + (FRAME_RATE_WINDOW_MS / 2) * i);
    }
    expect(rate).toBeCloseTo(1);
  });
});

describe('formatFrameRate', () => {
  it('uses the French decimal separator, like every other figure in the app', () => {
    expect(formatFrameRate(2.94)).toBe('2,9 i/s');
    expect(formatFrameRate(5)).toBe('5,0 i/s');
  });

  it('never renders a rate it has not measured', () => {
    expect(formatFrameRate(0)).toBe('—');
    expect(formatFrameRate(-1)).toBe('—');
    expect(formatFrameRate(NaN)).toBe('—');
    expect(formatFrameRate(Infinity)).toBe('—');
  });
});
