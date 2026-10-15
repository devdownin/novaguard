import { Passage } from './passages';
import { startOfDay } from '../utils/date';

export interface DaySummary {
  /** Passages that began today. */
  count: number;
  /** Start of the latest of them, or null. */
  lastAt: number | null;
  /** Passages per local hour, 0–23. */
  perHour: number[];
}

/**
 * Today at a glance, by passage — the unit the history lists — never by clip:
 * a passage split over three files is still one visit.
 */
export function daySummary(passages: readonly Passage[], now: number): DaySummary {
  const from = startOfDay(now);
  const perHour = new Array<number>(24).fill(0);
  let count = 0;
  let lastAt: number | null = null;
  for (const { summary } of passages) {
    if (summary.timestamp < from || summary.timestamp > now) continue;
    count++;
    perHour[new Date(summary.timestamp).getHours()]++;
    if (lastAt == null || summary.timestamp > lastAt) lastAt = summary.timestamp;
  }
  return { count, lastAt, perHour };
}
