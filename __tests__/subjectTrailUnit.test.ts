import { MAX_SAMPLES, recordSubject, trailSince, RawSample } from '../src/recording/subjectTrail';

const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };

it('keeps at most one sample a second', () => {
  const trail: RawSample[] = [];
  for (let at = 0; at < 5000; at += 200) recordSubject(trail, at, box);
  expect(trail.map(s => s.at)).toEqual([0, 1000, 2000, 3000, 4000]);
});

it('stays bounded over a passage of any length and spreads what it keeps over the clip', () => {
  const trail: RawSample[] = [];
  for (let at = 0; at < 3_600_000; at += 1000) recordSubject(trail, at, box);
  expect(trail.length).toBeLessThanOrEqual(MAX_SAMPLES * 4);
  const kept = trailSince(trail, 0);
  expect(kept.length).toBe(MAX_SAMPLES);
  expect(kept[0].t).toBe(0);
  expect(kept[kept.length - 1].t).toBeGreaterThan(3_400_000);
});

it('counts from the clip start and drops what came before it', () => {
  const trail: RawSample[] = [];
  for (let at = 0; at < 5000; at += 1000) recordSubject(trail, at, box);
  expect(trailSince(trail, 2000).map(s => s.t)).toEqual([0, 1000, 2000]);
});

it('rounds to three decimals', () => {
  const trail = recordSubject([], 0, { x: 0.123456, y: 0.2, width: 0.3, height: 0.4 });
  expect(trailSince(trail, 0)[0].x).toBe(0.123);
});
