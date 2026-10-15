/**
 * @format
 */
import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { daySummary } from '../src/recording/daySummary';
import { groupPassages } from '../src/recording/passages';
import { DetectionEvent } from '../src/state/types';
import { CountUp } from '../src/components/CountUp';

const at = (h: number, m = 0, day = 15) => new Date(2026, 9, day, h, m).getTime();
let nextId = 1;
const ev = (timestamp: number, passageId?: string): DetectionEvent => ({
  id: nextId++, passageId, kind: 'Personne', timestamp, dur: 5, conf: 0.8, path: '/x.mp4', bytes: 1, thumbPath: null,
} as DetectionEvent);

describe('daySummary', () => {
  const now = at(18, 30);

  it('counts passages, not clips, and only today', () => {
    const passages = groupPassages([
      ev(at(9, 5), 'a'), ev(at(9, 6), 'a'), ev(at(9, 7), 'a'), // one passage in three files
      ev(at(14, 32)),
      ev(at(23, 50, 14)), // yesterday evening
    ]);
    const s = daySummary(passages, now);
    expect(s.count).toBe(2);
    expect(s.lastAt).toBe(at(14, 32));
    expect(s.perHour[9]).toBe(1);
    expect(s.perHour[14]).toBe(1);
    expect(s.perHour[23]).toBe(0);
    expect(s.perHour.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('starts at local midnight, not 24 h ago', () => {
    const s = daySummary(groupPassages([ev(at(0, 1)), ev(at(23, 59, 14))]), at(0, 30));
    expect(s.count).toBe(1);
  });

  it('is empty on a quiet day', () => {
    expect(daySummary([], now)).toEqual({ count: 0, lastAt: null, perHour: new Array(24).fill(0) });
  });
});

describe('CountUp', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const shown = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findByType(Text).props.children;

  it('shows its first value as is, then rolls to a new one', async () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { tree = ReactTestRenderer.create(<CountUp value={3} />); });
    expect(shown(tree)).toBe(3);
    await act(async () => { tree.update(<CountUp value={13} />); });
    await act(async () => { jest.advanceTimersByTime(90); });
    const mid = shown(tree);
    expect(mid).toBeGreaterThan(3);
    expect(mid).toBeLessThan(13);
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(shown(tree)).toBe(13);
  });
});
