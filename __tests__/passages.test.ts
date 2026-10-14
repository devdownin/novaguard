import { groupPassages } from '../src/recording/passages';
import { DetectionEvent } from '../src/state/types';
const event = (
  id: number,
  passageId?: string,
  kind: DetectionEvent['kind'] = 'Personne',
): DetectionEvent => ({
  id,
  passageId,
  kind,
  timestamp: id * 1000,
  dur: 10,
  conf: 90,
  path: `/clips/${id}.mp4`,
  bytes: 100,
  thumbPath: null,
});
it('groups only explicit passage identities and orders clips by capture time', () => {
  const groups = groupPassages([
    event(3, 'A', 'Animal'),
    event(2, 'B'),
    event(1, 'A'),
  ]);
  expect(groups).toHaveLength(2);
  const a = groups.find(group => group.id === 'passage:A')!;
  expect(a.events.map(clip => clip.id)).toEqual([1, 3]);
  expect(a.kinds).toEqual(['Personne', 'Animal']);
  expect(a.summary.dur).toBe(20);
  expect(a.summary.bytes).toBe(200);
});
it('keeps old clips separate even when their times overlap', () => {
  expect(
    groupPassages([event(1), { ...event(2), timestamp: 1000 }]),
  ).toHaveLength(2);
});
it('retains missing clips and uses a playable file for the summary', () => {
  const passage = groupPassages([
    { ...event(1, 'A'), path: null },
    event(2, 'A'),
  ])[0];
  expect(passage.missingCount).toBe(1);
  expect(passage.summary.path).toBe('/clips/2.mp4');
  expect(passage.events).toHaveLength(2);
  expect(passage.summary.dur).toBe(10);
});
