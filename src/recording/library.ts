import { t } from '../i18n';
import { DetectionEvent, DetectionKind, MaxDuration, Period, PostRoll, Quality, Retention } from '../state/types';
import { startOfDay, startOfDayBefore } from '../utils/date';

/**
 * Pure logic behind recording and storage management: how long a clip may run,
 * which clips have expired, and which ones to drop when the disk fills up.
 *
 * Everything here is deliberately free of filesystem and React so it can be
 * unit-tested — `videoStore.ts` holds the side effects.
 */

/**
 * Floor under {@link lowSpaceBytes}: auto-delete reclaims at least to here.
 *
 * A volume this empty is worth clearing whatever the clip settings are.
 */
export const LOW_SPACE_BYTES = 500 * 1024 * 1024;

/**
 * Headroom a recording needs *on top of* the clip it is about to write.
 *
 * This is what the rest of the app and the OS need to keep working — not part
 * of what the clip itself will occupy. See {@link minFreeBytes}.
 */
export const MIN_FREE_BYTES = 150 * 1024 * 1024;

/** One decimal, with the separator the reader's language uses. */
function decimal(value: number): string {
  return value.toFixed(1).replace('.', t('number.decimal'));
}

const KO = 1024;
const MO = KO * 1024;
const GO = MO * 1024;

/**
 * A size, in the unit that actually suits it.
 *
 * Kilobytes are not decoration: this formats the detection journal as well as
 * the clips, and a few kilobytes of history rendered against a megabyte floor
 * came out as "0,0 Mo" — a real amount of stored data displayed as none, on the
 * one screen whose job is to say what the app keeps. Anything above zero is at
 * least "1 Ko" for the same reason.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 ' + t('unit.kb');
  if (bytes >= GO) return decimal(bytes / GO) + ' ' + t('unit.gb');
  if (bytes >= 10 * MO) return Math.round(bytes / MO).toString() + ' ' + t('unit.mb');
  if (bytes >= MO) return decimal(bytes / MO) + ' ' + t('unit.mb');
  return Math.max(1, Math.round(bytes / KO)).toString() + ' ' + t('unit.kb');
}

/** `null` means "Toujours" — nothing ever expires on age alone. */
export function retentionDays(retention: Retention): number | null {
  switch (retention) {
    case '1 jour': return 1;
    case '7 jours': return 7;
    case '30 jours': return 30;
    case '90 jours': return 90;
    case 'Toujours': return null;
    default: return null;
  }
}

/**
 * How many days back a history period reaches, counting the current day as 0.
 * `null` means "Tout" — no lower bound.
 */
export function periodDays(period: Period): number | null {
  switch (period) {
    case "Aujourd'hui": return 0;
    case '7 jours': return 6;
    case '30 jours': return 29;
    case 'Tout': return null;
    default: return null;
  }
}

/**
 * Epoch-ms window a history period covers, as `[from, to)`.
 *
 * Derived once per filter pass instead of per event: the old form called
 * `daysAgo` on every row, allocating three `Date` objects each time, on a screen
 * whose provider re-renders while surveillance is running. `to` is bounded so an
 * event stamped in the future belongs to no period.
 */
export function periodRange(period: Period, now: number): { from: number; to: number } {
  const days = periodDays(period);
  return {
    from: days == null ? -Infinity : startOfDayBefore(now, days),
    to: startOfDayBefore(now, -1),
  };
}

/**
 * Longest a single clip may run.
 *
 * The cap ends a *file*, not a passage: a subject still in frame carries the
 * session into the next clip. It exists because an unbounded MP4 is one the
 * encoder eventually refuses, one no retention sweep can trim by halves, and
 * one a user cannot scrub. The `default` matters — `max` is restored from disk,
 * so an option removed in a later version must degrade to a sane length rather
 * than to `NaN`, which `setTimeout` fires on immediately.
 */
export function maxDurationMs(max: MaxDuration): number {
  switch (max) {
    case '1 min': return 60_000;
    case '2 min': return 120_000;
    case '5 min': return 300_000;
    case '10 min': return 600_000;
    case '15 min': return 900_000;
    case '20 min': return 1_200_000;
    default: return 120_000;
  }
}

export function postRollMs(post: PostRoll): number {
  switch (post) {
    case '5 s': return 5_000;
    case '10 s': return 10_000;
    case '30 s': return 30_000;
    default: return 10_000;
  }
}

export function qualityResolution(quality: Quality): { width: number; height: number } {
  switch (quality) {
    case '720p': return { width: 1280, height: 720 };
    case '1080p': return { width: 1920, height: 1080 };
    case '4K': return { width: 3840, height: 2160 };
    default: return { width: 1920, height: 1080 };
  }
}

/**
 * Target bitrates in **Mbps**, which is the unit `<Camera videoBitRate>` takes
 * as a raw number — Android multiplies it by 1e6 and hands the result to the
 * encoder. These used to be written in bits per second, so the camera was asked
 * for three million megabits: past `Int.MAX_VALUE`, so the value saturated and
 * the encoder got an unusable target instead of the rate the row promises.
 *
 * Chosen well below broadcast rates: this is surveillance footage on a phone,
 * where hours of retained clips matter more than pristine gradients.
 */
export function qualityBitRate(quality: Quality): number {
  switch (quality) {
    case '720p': return 3;
    case '1080p': return 6;
    case '4K': return 20;
    default: return 6;
  }
}

/**
 * Bytes a clip of `max` at `quality` is expected to occupy.
 *
 * What the encoder was *asked* for, not a measurement: `qualityBitRate` is the
 * target handed to the encoder, and a real file varies with how much the scene
 * moves. Thresholds built on this carry their own headroom rather than treating
 * it as exact.
 */
export function expectedClipBytes(quality: Quality, max: MaxDuration): number {
  const bytesPerSecond = (qualityBitRate(quality) * 1_000_000) / 8;
  return bytesPerSecond * (maxDurationMs(max) / 1000);
}

/**
 * Free space a volume must have before a recording may start.
 *
 * A flat 150 Mo was the bug: it admitted a clip that needs 2,2 Go — fifteen
 * minutes at 4K — so the encoder ran out of room mid-clip and the whole passage
 * was lost, which is the one thing this guard exists to prevent. It was already
 * wrong at five minutes in 4K (750 Mo); the longer options only made the gap
 * impossible to miss. Scaling with the settings is what keeps the guard honest
 * whatever the user picks.
 */
export function minFreeBytes(quality: Quality, max: MaxDuration): number {
  return MIN_FREE_BYTES + expectedClipBytes(quality, max);
}

/**
 * Free space below which auto-delete starts reclaiming.
 *
 * Never below {@link minFreeBytes}: reclaiming to a mark that still refuses a
 * recording would delete the user's history and leave the camera unable to
 * record anyway — the worst of both.
 */
export function lowSpaceBytes(quality: Quality, max: MaxDuration): number {
  return Math.max(LOW_SPACE_BYTES, minFreeBytes(quality, max));
}

/**
 * What becomes of a clip the encoder has just handed back.
 *
 * There are exactly three outcomes and no fourth. "Nothing" used to be the
 * unwritten fourth: a clip that arrived with no detection to attach it to was
 * simply ignored, leaving a video of an empty room on disk, invisible in the
 * app until the next launch swept it up.
 */
export type ClipOutcome =
  /** A detection claims it, and there is a file to attach. */
  | 'attach'
  /** A detection claims it, but the encoder produced nothing usable. */
  | 'event-only'
  /** Nothing claims it — the recording must not be kept. */
  | 'discard';

export function clipOutcome(claimed: boolean, bytes: number): ClipOutcome {
  if (!claimed) return 'discard';
  return bytes > 0 ? 'attach' : 'event-only';
}

/**
 * Name a clip after what triggered it and when: `Personne_2026-09-02_14-32-07.mp4`.
 *
 * VisionCamera names recordings itself, with an opaque unique string, so a
 * directory of clips said nothing about its own contents — you had to open the
 * app and match a file to a history row by hand. The timestamp here is the
 * event's own, not the moment the file happens to be renamed, so the two always
 * agree.
 *
 * Local time, and dashes rather than colons: this ends up on a filesystem, and
 * a person reading the list is in their own timezone, not UTC.
 */
export function clipFileName(kind: DetectionKind, at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  return `${kind}_${date}_${time}.mp4`;
}

/**
 * Id for a new event, given the last one minted.
 *
 * Ids were `Date.now()` alone. Clips are filed through an async rename, so two
 * finishing together produced the same id — duplicate `FlatList` keys, and a
 * delete or a retention sweep that removed both rows and unlinked a clip the
 * surviving event still pointed at. Monotonic, and still a timestamp in the
 * ordinary case.
 */
export function nextEventId(latestId: number, now: number): number {
  return Math.max(now, latestId + 1);
}

/**
 * Every file the given events own — clips and their stills.
 *
 * One place rather than four call sites listing `.path`: an event's files grew
 * from one to two, and each deletion site that kept saying `.path` would have
 * gone on leaving a still behind, invisible in the app and reclaimed by nothing
 * but the launch sweep.
 */
export function eventFiles(events: DetectionEvent[]): (string | null)[] {
  return events.flatMap(e => [e.path, e.thumbPath ?? null]);
}

export function totalBytes(events: DetectionEvent[]): number {
  return events.reduce((sum, e) => sum + (e.bytes > 0 ? e.bytes : 0), 0);
}

/**
 * Events past the retention window. Compares against the *start* of the
 * cutoff day so "1 jour" means "yesterday and earlier", not "24 h ago" —
 * otherwise a clip would disappear mid-morning on its own anniversary.
 */
export function expiredEvents(
  events: DetectionEvent[],
  retention: Retention,
  now: number,
): DetectionEvent[] {
  const days = retentionDays(retention);
  if (days == null) return [];
  const cutoff = startOfDayBefore(now, days - 1);
  return events.filter(e => e.timestamp < cutoff);
}

/**
 * Oldest events to delete to reclaim `bytesNeeded`, oldest first.
 * Events carrying no file (bytes 0) are skipped — dropping them frees nothing
 * and would silently erase history the user can still read.
 */
export function eventsToReclaim(events: DetectionEvent[], bytesNeeded: number): DetectionEvent[] {
  if (bytesNeeded <= 0) return [];
  const oldestFirst = events.filter(e => e.bytes > 0).sort((a, b) => a.timestamp - b.timestamp);
  const picked: DetectionEvent[] = [];
  let freed = 0;
  for (const e of oldestFirst) {
    if (freed >= bytesNeeded) break;
    picked.push(e);
    freed += e.bytes;
  }
  return picked;
}

/**
 * How many bytes auto-delete should reclaim to get back above the low-space mark.
 *
 * `target` is passed in rather than read from the constant: it depends on the
 * clip settings now, and a default here would let a caller silently reclaim to
 * a mark that cannot fit the clip it is about to record.
 */
export function bytesToReclaim(freeSpace: number, target: number): number {
  return Math.max(0, target - freeSpace);
}

export function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * The counter shown as "détections aujourd'hui". It used to be persisted and
 * only ever incremented, so it silently became a lifetime total.
 */
export function todayCount(stored: { count: number; day: number } | null, now: number): number {
  if (!stored) return 0;
  return sameDay(stored.day, now) ? stored.count : 0;
}

/**
 * One row of the history list: a day heading, or one to `perRow` events.
 *
 * Rows rather than a `FlatList` of events, because the list has to do two
 * things at once that `numColumns` cannot: group by day, and put two cards
 * side by side in landscape. `numColumns` also refuses to change on a live
 * list — it needs the list remounted through a `key` — so building the rows
 * here removes that trap along with the grouping.
 *
 * Pure, so the grouping is testable without rendering anything.
 */
/**
 * One line of the history: a day heading, or the cards that fit on a row.
 *
 * The grouping is done here rather than by `FlatList` because the two things
 * the list has to do at once — break on a calendar day, and pack `perRow` cards
 * per line — cannot both be `numColumns`: a day with three detections would put
 * the third one beside the first of the day before. Composing rows also drops
 * the `key`-remount that changing `numColumns` on a live list requires, so a
 * rotation now re-renders the history instead of rebuilding it.
 */
export type HistoryRow =
  | { kind: 'day'; key: string; day: number }
  | { kind: 'events'; key: string; events: DetectionEvent[] };

/** `events` newest first, as the history already holds them. */
export function historyRows(events: DetectionEvent[], perRow: number): HistoryRow[] {
  const rows: HistoryRow[] = [];
  let openDay: number | null = null;
  let pending: DetectionEvent[] = [];

  const flush = () => {
    if (!pending.length) return;
    rows.push({ kind: 'events', key: `e${pending[0].id}`, events: pending });
    pending = [];
  };

  for (const event of events) {
    const day = startOfDay(event.timestamp);
    if (day !== openDay) {
      flush();
      // The heading is the day itself; how it is worded — "Aujourd'hui",
      // "Hier", "28 août" — belongs to the screen, which has the locale.
      rows.push({ kind: 'day', key: `d${day}`, day });
      openDay = day;
    }
    pending.push(event);
    if (pending.length === Math.max(1, perRow)) flush();
  }
  flush();
  return rows;
}
