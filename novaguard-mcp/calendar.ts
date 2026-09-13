/**
 * Day boundaries, in local calendar days.
 *
 * NovaGuard computes its own boundaries this way — retention, the history
 * screen's periods, the daily detection counter — because subtracting a fixed
 * 86 400 000 ms moves the boundary by an hour across a daylight-saving change,
 * and it is a deletion that hangs off it. These resources did not: the timeline
 * cut its day at UTC midnight while `statistics/today` cut it at local
 * midnight, so the same calendar day meant two things inside one server, and a
 * third thing again next to the on-device server, which is local throughout.
 *
 * `jest.config.js` pins `TZ=Europe/Paris` so a test of this can fail at all.
 */

/** Local midnight opening the day `date` falls in. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Local midnight opening the day `days` calendar days before `date`.
 *
 * Counted in days rather than in milliseconds, so a period that spans a clock
 * change still starts at midnight.
 */
export function startOfDaysBefore(date: Date, days: number): Date {
  const start = startOfLocalDay(date);
  start.setDate(start.getDate() - days);
  return start;
}

/**
 * The half-open range covering one `YYYY-MM-DD` local calendar day.
 *
 * Half-open because the closed form was `23:59:59`, which drops anything in
 * the last second of the day — a whole second of a surveillance camera's
 * record, silently, every day.
 */
export function localDayRange(dateStr: string): { from: string; to: string } {
  const [year, month, day] = dateStr.split('-').map(Number);
  const from = new Date(year, month - 1, day);
  const to = new Date(year, month - 1, day + 1);
  return { from: from.toISOString(), to: new Date(to.getTime() - 1).toISOString() };
}

/** `HH:MM:SS` in local time, matching the day the range was built in. */
export function localTimeOf(iso: string): string {
  const at = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}
