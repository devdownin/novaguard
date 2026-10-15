import { analysisCropFor, cropInBuffer, FULL_FRAME } from '../src/ml/analysisCrop';
import { inZone } from '../src/ml/zone';
import { interpretDetections } from '../src/ml/interpretDetections';
import { Rotation } from '../src/camera/orientation';

/**
 * Where an upright pixel came from in the buffer, by actually rotating a grid
 * clockwise the way the resize plugin documents — not by restating the formula.
 */
function bufferOrigin(u: number, v: number, rotation: Rotation, W: number, H: number): [number, number] {
  // Build the upright image of buffer coordinates, then read the pixel back.
  let grid: [number, number][][] = Array.from({ length: H }, (_row, y) => Array.from({ length: W }, (_col, x) => [x, y] as [number, number]));
  const turns = { '0deg': 0, '90deg': 1, '180deg': 2, '270deg': 3 }[rotation];
  for (let i = 0; i < turns; i++) {
    const h = grid.length;
    const w = grid[0].length;
    grid = Array.from({ length: w }, (_row, y) => Array.from({ length: h }, (_col, x) => grid[h - 1 - x][y]));
  }
  const rows = grid.length;
  const cols = grid[0].length;
  return grid[Math.floor(v * rows)][Math.floor(u * cols)];
}

describe('cropInBuffer', () => {
  const W = 40, H = 20;
  it.each<Rotation>(['0deg', '90deg', '180deg', '270deg'])('keeps the same pixels as the upright rectangle (%s)', rotation => {
    const rect = { x: 0.2, y: 0.1, width: 0.5, height: 0.3 };
    const b = cropInBuffer(rect.x, rect.y, rect.width, rect.height, rotation);
    // Points well inside the upright rectangle come from inside the buffer rectangle, and vice versa.
    for (const [fu, fv] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.5, 0.5]]) {
      const [bx, by] = bufferOrigin(rect.x + fu * rect.width, rect.y + fv * rect.height, rotation, W, H);
      expect(bx / W).toBeGreaterThanOrEqual(b.x - 1e-9);
      expect(bx / W).toBeLessThan(b.x + b.width);
      expect(by / H).toBeGreaterThanOrEqual(b.y - 1e-9);
      expect(by / H).toBeLessThan(b.y + b.height);
    }
    const outside = bufferOrigin(0.95, 0.95, rotation, W, H);
    const inside = outside[0] / W >= b.x && outside[0] / W < b.x + b.width && outside[1] / H >= b.y && outside[1] / H < b.y + b.height;
    expect(inside).toBe(false);
  });
});

describe('analysisCropFor', () => {
  it('analyses the whole frame without a zone, or when the zone would keep most of it', () => {
    expect(analysisCropFor(null)).toBe(FULL_FRAME);
    expect(analysisCropFor({ x: 0.1, y: 0.4, width: 0.8, height: 0.5 })).toBe(FULL_FRAME);
  });

  it('keeps every body whose feet are in the zone, with its head', () => {
    const zone = { x: 0.6, y: 0.6, width: 0.25, height: 0.2 };
    const crop = analysisCropFor(zone);
    expect(crop.width * crop.height).toBeLessThan(0.6);
    // A person standing at the far edges of the zone, 0.4 of the frame tall.
    for (const footX of [zone.x, zone.x + zone.width]) {
      const person = { x: footX - 0.05, y: zone.y - 0.4, width: 0.1, height: 0.4 };
      expect(inZone(person, zone)).toBe(true);
      expect(person.x).toBeGreaterThanOrEqual(crop.x);
      expect(person.x + person.width).toBeLessThanOrEqual(crop.x + crop.width + 1e-9);
      expect(person.y).toBeGreaterThanOrEqual(crop.y - 1e-9);
    }
    // Bottom edge of the zone is inside the crop too.
    expect(crop.y + crop.height).toBeGreaterThanOrEqual(zone.y + zone.height);
  });
});

describe('interpretDetections with a crop', () => {
  it('returns boxes in whole-frame fractions', () => {
    const outputs = [
      Float32Array.from([0.5, 0.5, 1, 1]), // ymin, xmin, ymax, xmax in crop
      Float32Array.from([0]), // person
      Float32Array.from([0.9]),
      Float32Array.from([1]),
    ];
    const [d] = interpretDetections(outputs, {
      detectPerson: true, detectAnimal: true, floorConfidence: 0.3, scaleX: 1, scaleY: 1,
      cropX: 0.5, cropY: 0.2, cropWidth: 0.4, cropHeight: 0.6,
    });
    expect(d.box.x).toBeCloseTo(0.7);
    expect(d.box.y).toBeCloseTo(0.5);
    expect(d.box.width).toBeCloseTo(0.2);
    expect(d.box.height).toBeCloseTo(0.3);
  });
});
