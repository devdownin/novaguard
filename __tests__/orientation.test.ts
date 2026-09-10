/**
 * @format
 */

import { swapsAxes, uprightAspect, uprightRotation } from '../src/camera/orientation';
import { uprightBoxToViewBox } from '../src/camera/framing';

describe('uprightRotation', () => {
  it('leaves an already-upright frame alone', () => {
    expect(uprightRotation('portrait')).toBe('0deg');
  });

  it('counter-rotates the two landscape cases in opposite directions', () => {
    expect(uprightRotation('landscape-left')).toBe('270deg');
    expect(uprightRotation('landscape-right')).toBe('90deg');
  });

  it('flips an upside-down frame', () => {
    expect(uprightRotation('portrait-upside-down')).toBe('180deg');
  });
});

describe('uprightAspect', () => {
  it('keeps the aspect for portrait frames', () => {
    expect(uprightAspect(1080, 1920, 'portrait')).toBeCloseTo(1080 / 1920);
  });

  it('swaps width and height for landscape frames', () => {
    // A 1920x1080 sensor buffer held portrait becomes a 1080x1920 upright image.
    expect(uprightAspect(1920, 1080, 'landscape-left')).toBeCloseTo(1080 / 1920);
    expect(uprightAspect(1920, 1080, 'landscape-right')).toBeCloseTo(1080 / 1920);
    expect(swapsAxes('landscape-left')).toBe(true);
    expect(swapsAxes('portrait')).toBe(false);
  });

  it('is safe for a degenerate frame', () => {
    expect(uprightAspect(0, 0, 'portrait')).toBe(1);
  });
});

describe('uprightBoxToViewBox (cover crop)', () => {
  const VIEW_W = 360;
  const VIEW_H = 560;
  const viewAspect = VIEW_W / VIEW_H;

  it('is the identity when frame and view share an aspect', () => {
    const box = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 };
    const out = uprightBoxToViewBox(box, viewAspect, VIEW_W, VIEW_H);
    expect(out.x).toBeCloseTo(box.x);
    expect(out.y).toBeCloseTo(box.y);
    expect(out.width).toBeCloseTo(box.width);
    expect(out.height).toBeCloseTo(box.height);
  });

  it('keeps a centred box centred whatever the aspect mismatch', () => {
    for (const aspect of [0.4, viewAspect, 1, 1.8]) {
      const out = uprightBoxToViewBox({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, aspect, VIEW_W, VIEW_H);
      expect(out.x + out.width / 2).toBeCloseTo(0.5);
      expect(out.y + out.height / 2).toBeCloseTo(0.5);
    }
  });

  it('crops the sides when the frame is wider than the view', () => {
    // 16:9 upright frame in a narrower portrait view: full height, sides cut.
    const out = uprightBoxToViewBox({ x: 0, y: 0.25, width: 1, height: 0.5 }, 1.0, VIEW_W, VIEW_H);
    expect(out.width).toBeGreaterThan(1);   // frame width overflows the view
    expect(out.x).toBeLessThan(0);
    expect(out.y).toBeCloseTo(0.25);        // height untouched
    expect(out.height).toBeCloseTo(0.5);
  });

  it('crops top and bottom when the frame is taller than the view', () => {
    const out = uprightBoxToViewBox({ x: 0.25, y: 0, width: 0.5, height: 1 }, 0.3, VIEW_W, VIEW_H);
    expect(out.height).toBeGreaterThan(1);
    expect(out.y).toBeLessThan(0);
    expect(out.x).toBeCloseTo(0.25);
    expect(out.width).toBeCloseTo(0.5);
  });

  it('maps a full-frame box to at least the whole view (cover never letterboxes)', () => {
    for (const aspect of [0.35, 0.5625, 1, 1.777]) {
      const out = uprightBoxToViewBox({ x: 0, y: 0, width: 1, height: 1 }, aspect, VIEW_W, VIEW_H);
      expect(out.x).toBeLessThanOrEqual(1e-9);
      expect(out.y).toBeLessThanOrEqual(1e-9);
      expect(out.x + out.width).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(out.y + out.height).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });

  it('is safe before the view has been measured', () => {
    const box = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    expect(uprightBoxToViewBox(box, 0.5, 0, 0)).toBe(box);
  });
});
