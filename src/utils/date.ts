import { t } from '../i18n';
/** Twelve abbreviations in one string, so a translator moves one entry. */
const MONTHS = t('date.months').split(',');

export function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Midnight `days` calendar days before the day `ts` falls in.
 *
 * Walks days with `setDate` rather than subtracting 86 400 000 ms: across a
 * daylight-saving change the ms form lands an hour off, which drags the wrong
 * evening's clips into a retention sweep or a history filter.
 */
export function startOfDayBefore(ts: number, days: number): number {
  const d = new Date(startOfDay(ts));
  d.setDate(d.getDate() - days);
  return d.getTime();
}

/** Whole calendar days between `ts` and now (0 = today, 1 = yesterday, …). */
export function daysAgo(ts: number): number {
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  return Math.round((today - day) / 86400000);
}

/**
 * "Aujourd'hui, 08:42" / "Hier, 22:31" / "28 août, 11:20", and their English
 * equivalents — where the day and month swap places, which is why the third
 * form is a template rather than a concatenation.
 */
export function formatWhen(ts: number): string {
  const d = new Date(ts);
  const time = formatTimeOfDay(ts);
  const diff = daysAgo(ts);
  if (diff === 0) return t('date.today', { time });
  if (diff === 1) return t('date.yesterday', { time });
  return t('date.other', { day: d.getDate(), month: MONTHS[d.getMonth()], time });
}

/**
 * "08:42" — the clock alone.
 *
 * What a card in a list grouped by day is actually saying: the day is on the
 * heading above it, and repeating it on every card in the group is words that
 * carry nothing. The surveillance screen, which shows one instant with no
 * heading over it, still needs `formatWhen`.
 */
export function formatTimeOfDay(ts: number): string {
  const d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/**
 * The same three forms without the time: "Aujourd'hui", "Hier", "28 août".
 *
 * A day heading has no use for a clock — the clip's own time is on its card —
 * and stripping it off `formatWhen` would mean a regex over a translated
 * string, which the next language breaks silently.
 */
export function formatDay(ts: number): string {
  const diff = daysAgo(ts);
  if (diff === 0) return t('date.dayToday');
  if (diff === 1) return t('date.dayYesterday');
  const d = new Date(ts);
  return t('date.dayOther', { day: d.getDate(), month: MONTHS[d.getMonth()] });
}

/** "01/09 14:32:07" */
export function formatClock(d: Date): string {
  return (
    pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
  );
}

/**
 * "0:18" / "2:05". Clips can now run to the configured maximum (up to 5 min),
 * so seconds have to carry over instead of being padded straight onto "0:".
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return Math.floor(total / 60) + ':' + pad(total % 60);
}
