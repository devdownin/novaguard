/**
 * The watched zone, and the two conversions it depends on.
 *
 * A zone is the one filter that can silently switch the app off: it is stored,
 * it is invisible once monitoring starts, and a scene it lets nothing through
 * looks exactly like an empty room. So the boundary is pinned on both sides —
 * what it keeps as well as what it drops — and so is the round trip through
 * view space, since a zone drawn correctly and stored wrong watches the wrong
 * part of the room forever.
 *
 * @format
 */

import { detectionsInZone, inZone, isUsableZone, MIN_ZONE_SIDE } from '../src/ml/zone';
import { uprightBoxToViewBox, viewBoxToUprightBox } from '../src/camera/framing';
import { FrameDetection } from '../src/ml/types';

/** The right-hand half of the frame — a garden, with the street on the left. */
const GARDEN = { x: 0.5, y: 0.3, width: 0.5, height: 0.7 };

/** A person standing with their feet at (x, y). */
const standing = (x: number, y: number): FrameDetection => ({
  kind: 'Personne',
  confidence: 0.9,
  box: { x: x - 0.06, y: y - 0.35, width: 0.12, height: 0.35 },
});

describe('inZone', () => {
  it('judges a subject by their feet, not their head', () => {
    // Someone on the pavement leaning over the fence has their head and
    // shoulders inside the zone. They are still on the pavement.
    const leaning = { x: 0.40, y: 0.35, width: 0.12, height: 0.35 };
    expect(leaning.x + leaning.width).toBeGreaterThan(GARDEN.x);   // the box does overlap
    expect(inZone(leaning, GARDEN)).toBe(false);
  });

  it('keeps a subject standing inside it', () => {
    expect(inZone(standing(0.7, 0.8).box, GARDEN)).toBe(true);
  });

  it('drops a subject standing outside it', () => {
    expect(inZone(standing(0.2, 0.8).box, GARDEN)).toBe(false);
  });

  it('drops a subject standing beyond the far edge of the zone', () => {
    // Up the frame is further away: someone on the road behind the garden.
    expect(inZone(standing(0.7, 0.2).box, GARDEN)).toBe(false);
  });

  it('counts a subject exactly on the boundary as inside', () => {
    // The choice matters less than its being made: a strict comparison here
    // makes the edge of the zone a place a subject can stand and not exist.
    expect(inZone(standing(0.5, 1).box, GARDEN)).toBe(true);
  });
});

describe('isUsableZone', () => {
  it('rejects a rectangle a stray tap could have produced', () => {
    // A zone matching nothing is indistinguishable from a camera that has
    // stopped working, and the app would say nothing about either.
    expect(isUsableZone({ x: 0.4, y: 0.4, width: 0.001, height: 0.001 })).toBe(false);
    expect(isUsableZone({ x: 0.4, y: 0.4, width: 0.9, height: MIN_ZONE_SIDE / 2 })).toBe(false);
  });

  it('accepts one deliberately drawn', () => {
    expect(isUsableZone(GARDEN)).toBe(true);
    expect(isUsableZone({ x: 0, y: 0, width: MIN_ZONE_SIDE, height: MIN_ZONE_SIDE })).toBe(true);
  });
});

describe('detectionsInZone', () => {
  const inside = standing(0.7, 0.8);
  const outside = standing(0.2, 0.8);

  it('lets everything through when no zone is set', () => {
    const all = [inside, outside];
    // Identity: a new array on every analysed frame is the allocation the rest
    // of this path is written to avoid.
    expect(detectionsInZone(all, null)).toBe(all);
  });

  it('returns the same array when the zone excludes nothing', () => {
    const all = [inside];
    expect(detectionsInZone(all, GARDEN)).toBe(all);
  });

  it('drops what stands outside and keeps what stands inside', () => {
    expect(detectionsInZone([inside, outside], GARDEN)).toEqual([inside]);
  });

  it('can drop everything', () => {
    expect(detectionsInZone([outside], GARDEN)).toEqual([]);
  });
});

describe('view space round trip', () => {
  // A zone is drawn on the viewfinder and stored against the frame. The preview
  // is `resizeMode="cover"`, so the two disagree by a crop — and a zone stored
  // in the wrong one of them watches the wrong part of the room for good.
  const cases: [string, number, number, number][] = [
    ['portrait frame in a portrait view', 9 / 16, 360, 640],
    ['landscape frame in a portrait view', 16 / 9, 360, 640],
    ['landscape frame in a landscape view', 16 / 9, 640, 360],
    ['portrait frame in a landscape view', 9 / 16, 640, 360],
    ['4:3 frame in a 16:9 view', 4 / 3, 360, 640],
  ];

  it.each(cases)('survives it: %s', (_name, aspect, w, h) => {
    const drawn = { x: 0.22, y: 0.31, width: 0.4, height: 0.5 };
    const stored = viewBoxToUprightBox(drawn, aspect, w, h);
    const back = uprightBoxToViewBox(stored, aspect, w, h);
    expect(back.x).toBeCloseTo(drawn.x);
    expect(back.y).toBeCloseTo(drawn.y);
    expect(back.width).toBeCloseTo(drawn.width);
    expect(back.height).toBeCloseTo(drawn.height);
  });

  it('actually converts — a stored zone is not what was drawn', () => {
    // Guards the round trip above from passing on two identity functions.
    const drawn = { x: 0.22, y: 0.31, width: 0.4, height: 0.5 };
    // A 16:9 frame in a portrait view is cropped on its sides, so it is the
    // horizontal axis that has to move.
    const stored = viewBoxToUprightBox(drawn, 16 / 9, 360, 640);
    expect(stored.width).not.toBeCloseTo(drawn.width);
  });

  it('leaves a box alone when the view has not been measured yet', () => {
    const drawn = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };
    expect(viewBoxToUprightBox(drawn, 9 / 16, 0, 0)).toEqual(drawn);
  });
});
