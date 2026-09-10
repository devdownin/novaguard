import {
  bytesToReclaim,
  clipFileName,
  clipOutcome,
  eventsToReclaim,
  expiredEvents,
  formatBytes,
  historyRows,
  LOW_SPACE_BYTES,
  MIN_FREE_BYTES,
  minFreeBytes,
  expectedClipBytes,
  lowSpaceBytes,
  maxDurationMs,
  nextEventId,
  periodDays,
  periodRange,
  postRollMs,
  qualityBitRate,
  qualityResolution,
  retentionDays,
  sameDay,
  todayCount,
  totalBytes,
} from '../src/recording/library';
import { DetectionEvent, MaxDuration } from '../src/state/types';

const MB = 1024 * 1024;

function ev(id: number, daysBack: number, bytes = 10 * MB): DetectionEvent {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  d.setHours(12, 0, 0, 0);
  return {
    id, kind: 'Personne', timestamp: d.getTime(), dur: 12, conf: 90,
    path: `/clips/${id}.mp4`, bytes, thumbPath: `/clips/${id}.jpg`,
  };
}

describe('formatBytes', () => {
  it('uses French decimal separators', () => {
    expect(formatBytes(1.5 * MB)).toBe('1,5 Mo');
    expect(formatBytes(2.5 * 1024 * MB)).toBe('2,5 Go');
  });

  it('drops decimals once megabytes get large enough not to need them', () => {
    expect(formatBytes(14.4 * MB)).toBe('14 Mo');
  });

  it('never renders a negative or nonsense size', () => {
    expect(formatBytes(0)).toBe('0 Ko');
    expect(formatBytes(-5)).toBe('0 Ko');
    expect(formatBytes(NaN)).toBe('0 Ko');
  });

  it('expresses small sizes in kilobytes rather than as no data at all', () => {
    // The detection journal is a few kilobytes. Against a megabyte floor it
    // read "0,0 Mo" — real stored data shown as none, on the screen whose whole
    // job is to say what the app keeps.
    expect(formatBytes(6 * 1024)).toBe('6 Ko');
    expect(formatBytes(900 * 1024)).toBe('900 Ko');
    // Rounding down to "0 Ko" would make a non-empty store look empty.
    expect(formatBytes(200)).toBe('1 Ko');
  });
});

/** Every value the union offers, so a new one cannot be added and left unmapped. */
const MAX_DURATIONS: MaxDuration[] = ['1 min', '2 min', '5 min', '10 min', '15 min', '20 min'];

describe('setting translations', () => {
  it('maps every retention option, with "Toujours" meaning no expiry', () => {
    expect(retentionDays('1 jour')).toBe(1);
    expect(retentionDays('7 jours')).toBe(7);
    expect(retentionDays('30 jours')).toBe(30);
    expect(retentionDays('90 jours')).toBe(90);
    expect(retentionDays('Toujours')).toBeNull();
  });

  it('maps durations to milliseconds', () => {
    expect(maxDurationMs('1 min')).toBe(60_000);
    expect(maxDurationMs('5 min')).toBe(300_000);
    expect(maxDurationMs('20 min')).toBe(1_200_000);
    expect(postRollMs('5 s')).toBe(5_000);
    expect(postRollMs('30 s')).toBe(30_000);
  });

  it('has a real duration for every option the setting cycles through', () => {
    // The `default` in the switch exists so a value written by another version
    // degrades to a sane length instead of `NaN` — which `setTimeout` fires on
    // immediately, cutting every clip at once. It must not be what a *current*
    // option lands on: that would silently cap a 20-minute setting at two.
    for (const max of MAX_DURATIONS) {
      const minutes = Number(max.split(' ')[0]);
      expect(maxDurationMs(max)).toBe(minutes * 60_000);
    }
  });

  it('gives each quality a distinct resolution and bitrate', () => {
    expect(qualityResolution('720p')).toEqual({ width: 1280, height: 720 });
    expect(qualityResolution('4K')).toEqual({ width: 3840, height: 2160 });
    const rates = (['720p', '1080p', '4K'] as const).map(qualityBitRate);
    expect(new Set(rates).size).toBe(3);
    expect(rates[0]).toBeLessThan(rates[2]);
  });

  it('states the bitrate in the megabits VisionCamera expects', () => {
    // Android does `videoBitRate * 1_000_000` and hands an Int to the encoder.
    // Written in bits per second — as these were — every value overflows Int
    // and the encoder is configured with something no device can honour.
    for (const quality of ['720p', '1080p', '4K'] as const) {
      const bitsPerSecond = qualityBitRate(quality) * 1_000_000;
      expect(bitsPerSecond).toBeLessThan(2 ** 31 - 1);
      expect(bitsPerSecond).toBeGreaterThan(1_000_000);
    }
  });
});

/**
 * The free-space guard used to be a flat 150 Mo, which admitted a clip needing
 * 2,2 Go. The encoder then ran out of room mid-clip and the passage was lost —
 * the exact failure the guard exists to prevent.
 */
describe('the space a clip is expected to need', () => {
  const GB = 1024 * MB;

  it('follows the bitrate and the duration', () => {
    // 20 Mb/s over 15 min, in bytes.
    expect(expectedClipBytes('4K', '15 min')).toBeCloseTo((20e6 / 8) * 900, 0);
    // Halving the duration halves the file; the quality ladder only grows it.
    expect(expectedClipBytes('4K', '5 min') * 3).toBeCloseTo(expectedClipBytes('4K', '15 min'), 0);
    expect(expectedClipBytes('720p', '1 min')).toBeLessThan(expectedClipBytes('4K', '1 min'));
  });

  it('demands more free space than the clip will occupy', () => {
    for (const quality of ['720p', '1080p', '4K'] as const) {
      for (const max of ['1 min', '2 min', '5 min', '10 min', '15 min', '20 min'] as const) {
        // Equal would be a guard that lets a clip fill the volume exactly.
        expect(minFreeBytes(quality, max)).toBeGreaterThan(expectedClipBytes(quality, max));
      }
    }
  });

  it('follows the longest cap the setting offers', () => {
    // A 20-minute clip in 4K is 3 Go: the guard has to ask for more than a
    // 15-minute one, or the longest setting is the one that fills the volume.
    expect(expectedClipBytes('4K', '20 min')).toBeCloseTo((20e6 / 8) * 1200, 0);
    expect(minFreeBytes('4K', '20 min')).toBeGreaterThan(minFreeBytes('4K', '15 min'));
  });

  it('scales past the old flat threshold where that threshold was wrong', () => {
    // The two settings that broke it: a single clip an order of magnitude
    // larger than the 150 Mo the guard used to ask for.
    expect(minFreeBytes('4K', '15 min')).toBeGreaterThan(2 * GB);
    expect(minFreeBytes('4K', '5 min')).toBeGreaterThan(750 * MB);
    // And it must not have quietly loosened the modest settings.
    expect(minFreeBytes('1080p', '2 min')).toBeGreaterThan(MIN_FREE_BYTES);
  });

  it('never starts auto-delete below the mark a recording needs', () => {
    for (const quality of ['720p', '1080p', '4K'] as const) {
      for (const max of ['1 min', '20 min'] as const) {
        // Otherwise a sweep deletes the user's history and the camera still
        // refuses to record: the worst of both.
        expect(lowSpaceBytes(quality, max)).toBeGreaterThanOrEqual(minFreeBytes(quality, max));
      }
    }
  });

  it('leaves the modest settings on the existing low-space mark', () => {
    expect(lowSpaceBytes('1080p', '2 min')).toBe(LOW_SPACE_BYTES);
  });
});

describe('expiredEvents', () => {
  const now = Date.now();

  it('keeps everything when retention is "Toujours"', () => {
    expect(expiredEvents([ev(1, 400)], 'Toujours', now)).toEqual([]);
  });

  it('drops only what falls outside the window', () => {
    const events = [ev(1, 0), ev(2, 3), ev(3, 10), ev(4, 40)];
    const expired = expiredEvents(events, '7 jours', now);
    expect(expired.map(e => e.id)).toEqual([3, 4]);
  });

  it('measures from the start of the day, so "1 jour" keeps today', () => {
    const expired = expiredEvents([ev(1, 0), ev(2, 1)], '1 jour', now);
    expect(expired.map(e => e.id)).toEqual([2]);
  });
});

describe('eventsToReclaim', () => {
  it('returns nothing when no space is needed', () => {
    expect(eventsToReclaim([ev(1, 5)], 0)).toEqual([]);
    expect(eventsToReclaim([ev(1, 5)], -1)).toEqual([]);
  });

  it('takes the oldest clips first and stops once the target is met', () => {
    const events = [ev(1, 0, 10 * MB), ev(2, 5, 10 * MB), ev(3, 9, 10 * MB)];
    const picked = eventsToReclaim(events, 15 * MB);
    expect(picked.map(e => e.id)).toEqual([3, 2]);
  });

  it('skips events with no file, which would free nothing', () => {
    const withFile = ev(1, 1, 10 * MB);
    const noFile: DetectionEvent = { ...ev(2, 9), path: null, bytes: 0 , thumbPath: null};
    expect(eventsToReclaim([withFile, noFile], 5 * MB).map(e => e.id)).toEqual([1]);
  });

  it('gives back everything it has when that still is not enough', () => {
    const events = [ev(1, 1, MB), ev(2, 2, MB)];
    expect(eventsToReclaim(events, 500 * MB)).toHaveLength(2);
  });
});

describe('bytesToReclaim', () => {
  it('asks for nothing while there is room', () => {
    expect(bytesToReclaim(LOW_SPACE_BYTES + MB, LOW_SPACE_BYTES)).toBe(0);
  });

  it('asks for the shortfall below the low-space mark', () => {
    expect(bytesToReclaim(LOW_SPACE_BYTES - 20 * MB, LOW_SPACE_BYTES)).toBe(20 * MB);
  });

  it('reclaims against the mark it is given, not a constant', () => {
    // The mark scales with the clip settings; reclaiming to a fixed one would
    // free space a 4K clip still cannot fit into.
    const target = lowSpaceBytes('4K', '15 min');
    expect(bytesToReclaim(LOW_SPACE_BYTES, target)).toBe(target - LOW_SPACE_BYTES);
  });
});

describe('totalBytes', () => {
  it('sums real sizes and ignores fileless events', () => {
    const noFile: DetectionEvent = { ...ev(9, 1), path: null, bytes: 0 , thumbPath: null};
    expect(totalBytes([ev(1, 1, 3 * MB), ev(2, 2, 4 * MB), noFile])).toBe(7 * MB);
  });
});

describe('todayCount', () => {
  const noon = new Date(2026, 0, 15, 12, 0, 0).getTime();

  it('starts from zero with nothing stored', () => {
    expect(todayCount(null, noon)).toBe(0);
  });

  it('keeps the count within the same day', () => {
    const morning = new Date(2026, 0, 15, 8, 0, 0).getTime();
    expect(todayCount({ count: 4, day: morning }, noon)).toBe(4);
  });

  it('resets once the day has changed — the bug that made it a lifetime total', () => {
    const yesterday = new Date(2026, 0, 14, 23, 59, 0).getTime();
    expect(todayCount({ count: 41, day: yesterday }, noon)).toBe(0);
  });

  it('resets across a year boundary', () => {
    const lastYear = new Date(2025, 11, 31, 23, 0, 0).getTime();
    const newYear = new Date(2026, 0, 1, 1, 0, 0).getTime();
    expect(todayCount({ count: 7, day: lastYear }, newYear)).toBe(0);
  });
});

describe('sameDay', () => {
  it('separates days, not 24-hour spans', () => {
    const late = new Date(2026, 4, 3, 23, 55).getTime();
    const early = new Date(2026, 4, 4, 0, 5).getTime();
    expect(sameDay(late, early)).toBe(false);
    expect(sameDay(late, new Date(2026, 4, 3, 0, 1).getTime())).toBe(true);
  });
});

describe('clipFileName', () => {
  it('names a clip after what triggered it and when', () => {
    const at = new Date(2026, 8, 2, 14, 32, 7).getTime();
    expect(clipFileName('Personne', at)).toBe('Personne_2026-09-02_14-32-07.mp4');
  });

  it('distinguishes an animal', () => {
    const at = new Date(2026, 0, 5, 9, 4, 3).getTime();
    expect(clipFileName('Animal', at)).toBe('Animal_2026-01-05_09-04-03.mp4');
  });

  it('pads every field, so names sort chronologically as plain text', () => {
    const early = clipFileName('Personne', new Date(2026, 0, 5, 9, 4, 3).getTime());
    const later = clipFileName('Personne', new Date(2026, 0, 5, 10, 0, 0).getTime());
    const nextDay = clipFileName('Personne', new Date(2026, 0, 6, 0, 0, 0).getTime());
    expect([nextDay, later, early].sort()).toEqual([early, later, nextDay]);
  });

  it('uses only characters a filesystem is happy with', () => {
    const name = clipFileName('Personne', Date.now());
    expect(name).toMatch(/^[A-Za-z]+_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/);
  });
});

describe('clipOutcome', () => {
  it('attaches a real recording to the detection that claimed it', () => {
    expect(clipOutcome(true, 12 * 1024 * 1024)).toBe('attach');
  });

  it('discards a recording nothing claims', () => {
    // The rule the whole thing exists for: never keep footage of an empty room
    // that no event points at.
    expect(clipOutcome(false, 12 * 1024 * 1024)).toBe('discard');
  });

  it('discards it whatever its size, if unclaimed', () => {
    expect(clipOutcome(false, 0)).toBe('discard');
    expect(clipOutcome(false, 1)).toBe('discard');
  });

  it('keeps the sighting but drops an empty file', () => {
    expect(clipOutcome(true, 0)).toBe('event-only');
  });

  it('has no fourth outcome', () => {
    const seen = new Set([
      clipOutcome(true, 1), clipOutcome(true, 0),
      clipOutcome(false, 1), clipOutcome(false, 0),
    ]);
    expect([...seen].sort()).toEqual(['attach', 'discard', 'event-only']);
  });
});

describe('nextEventId', () => {
  it('uses the timestamp when nothing collides', () => {
    expect(nextEventId(0, 1_000)).toBe(1_000);
    expect(nextEventId(900, 1_000)).toBe(1_000);
  });

  it('steps past an id already taken in the same millisecond', () => {
    expect(nextEventId(1_000, 1_000)).toBe(1_001);
    expect(nextEventId(1_001, 1_000)).toBe(1_002);
  });
});

describe('periodRange', () => {
  const now = new Date(2026, 8, 2, 15).getTime();
  const midnight = (m: number, d: number) => new Date(2026, m - 1, d).getTime();

  it('covers exactly the days each period names', () => {
    expect(periodRange("Aujourd'hui", now)).toEqual({ from: midnight(9, 2), to: midnight(9, 3) });
    expect(periodRange('7 jours', now).from).toBe(midnight(8, 27));
    expect(periodRange('30 jours', now).from).toBe(midnight(8, 4));
  });

  it('is unbounded below for Tout, and never includes the future', () => {
    expect(periodRange('Tout', now)).toEqual({ from: -Infinity, to: midnight(9, 3) });
  });

  it('maps every period to a day count', () => {
    expect(periodDays("Aujourd'hui")).toBe(0);
    expect(periodDays('Tout')).toBeNull();
  });
});

describe('historyRows', () => {
  const at = (m: number, d: number, h: number): DetectionEvent => ({
    id: new Date(2026, m - 1, d, h).getTime(),
    kind: 'Personne',
    timestamp: new Date(2026, m - 1, d, h).getTime(),
    dur: 5,
    conf: 90,
    path: null,
    bytes: 0, thumbPath: null
  });

  const shape = (rows: ReturnType<typeof historyRows>) =>
    rows.map(r => (r.kind === 'day' ? 'day' : r.events.length));

  it('opens every day with its heading', () => {
    const rows = historyRows([at(9, 2, 18), at(9, 2, 9), at(9, 1, 20)], 1);
    expect(shape(rows)).toEqual(['day', 1, 1, 'day', 1]);
    expect(rows.filter(r => r.kind === 'day')).toHaveLength(2);
  });

  it('packs the cards of one day and never across two', () => {
    // The reason this is not `numColumns`: with two columns over a flat list,
    // the lone detection of 1 September would sit beside one from the 2nd.
    const rows = historyRows([at(9, 2, 18), at(9, 2, 9), at(9, 1, 20)], 2);
    expect(shape(rows)).toEqual(['day', 2, 'day', 1]);
  });

  it('leaves an odd last card of a day on its own row', () => {
    expect(shape(historyRows([at(9, 2, 18), at(9, 2, 12), at(9, 2, 9)], 2)))
      .toEqual(['day', 2, 1]);
  });

  it('groups by calendar day, not by 24-hour blocks', () => {
    // Two hours apart, either side of midnight: subtracting 86_400_000 would
    // call them the same day, and so would any comparison on the raw instant.
    expect(shape(historyRows([at(9, 2, 1), at(9, 1, 23)], 2))).toEqual(['day', 1, 'day', 1]);
  });

  it('keeps the keys distinct so a row is never reused for another', () => {
    const keys = historyRows([at(9, 2, 18), at(9, 2, 9), at(9, 1, 20)], 2).map(r => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('renders nothing for no events, and survives a nonsensical width', () => {
    expect(historyRows([], 2)).toEqual([]);
    // A zero would otherwise flush on every push and loop forever on none.
    expect(shape(historyRows([at(9, 2, 18), at(9, 2, 9)], 0))).toEqual(['day', 1, 1]);
  });
});
