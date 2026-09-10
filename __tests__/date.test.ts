/**
 * @format
 */

import { daysAgo, formatDuration, formatWhen, startOfDay, startOfDayBefore } from '../src/utils/date';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('startOfDayBefore', () => {
  it('is midnight of the same day for 0', () => {
    expect(startOfDayBefore(at(2026, 9, 2, 15), 0)).toBe(at(2026, 9, 2, 0));
  });

  it('walks back whole calendar days', () => {
    expect(startOfDayBefore(at(2026, 9, 2, 15), 6)).toBe(at(2026, 8, 27, 0));
    expect(startOfDayBefore(at(2026, 9, 2, 15), 29)).toBe(at(2026, 8, 4, 0));
  });

  it('walks forward for a negative count', () => {
    expect(startOfDayBefore(at(2026, 9, 2, 15), -1)).toBe(at(2026, 9, 3, 0));
  });

  // jest.config pins TZ to Europe/Paris so this actually crosses a transition:
  // subtracting 86_400_000 ms per day lands an hour off here, which drags the
  // wrong evening's clips into a retention sweep or a history filter.
  it('lands on midnight across a daylight-saving change', () => {
    // Europe falls back on Sunday 25 October 2026.
    const from = new Date(startOfDayBefore(at(2026, 10, 28, 15), 6));
    expect(from.getHours()).toBe(0);
    expect(from.getDate()).toBe(22);
    expect(from.getTime()).not.toBe(startOfDay(at(2026, 10, 28)) - 6 * 86_400_000);
  });
});

describe('formatWhen', () => {
  it('names today and yesterday', () => {
    expect(formatWhen(Date.now())).toMatch(/^Aujourd'hui, /);
    expect(formatWhen(Date.now() - 86_400_000)).toMatch(/^Hier, /);
  });
});

describe('daysAgo', () => {
  it('counts whole calendar days', () => {
    expect(daysAgo(Date.now())).toBe(0);
    expect(daysAgo(Date.now() - 86_400_000)).toBe(1);
  });
});

describe('formatDuration', () => {
  it('carries seconds over into minutes', () => {
    expect(formatDuration(18)).toBe('0:18');
    expect(formatDuration(125)).toBe('2:05');
    expect(formatDuration(-3)).toBe('0:00');
  });
});
