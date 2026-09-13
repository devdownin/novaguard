/**
 * Day boundaries, and what a page limit is allowed to hide.
 *
 * `jest.config.js` pins `TZ=Europe/Paris` precisely so this suite can fail:
 * under UTC, local and UTC midnight are the same instant and every assertion
 * below passes against the code it was written to catch.
 */

import { localDayRange, startOfDaysBefore, startOfLocalDay } from '../calendar';
import { readTimelineResource } from '../resources/timeline';
import { readStatisticsResource } from '../resources/statistics';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { InMemoryNovaGuardApi, NovaGuardMockDataSource, RawEvent } from '../testing/inMemoryApi';

const context: SecurityContext = { principal: 'p', scopes: ['novaguard:read'], isLoopback: true };
const authorizer = new Authorizer();

function apiWith(events: RawEvent[]) {
  const data: NovaGuardMockDataSource = {
    surveillanceActive: true, camera: 'Arrière (1×)', lastDetectionAt: null, detectionsToday: 0,
    storage: { free: 1, total: 2 }, settings: {} as any, events,
  };
  return new InMemoryNovaGuardApi(data);
}

const event = (at: Date, id: number): RawEvent => ({
  id, kind: 'Personne', timestamp: at.getTime(), dur: 5, conf: 0.9,
  path: `/clips/${id}.mp4`, bytes: 100, thumbPath: null,
});

describe('calendar arithmetic', () => {
  it('counts days, not multiples of 86 400 000 ms', () => {
    // Europe/Paris springs forward on the last Sunday of March: 30 March 2025
    // is a 23-hour day. Counting in days gives the 30th at its own midnight.
    const afterChange = new Date(2025, 2, 31, 12, 0, 0);
    const dayBefore = startOfDaysBefore(afterChange, 1);

    expect(dayBefore.getDate()).toBe(30);
    expect(dayBefore.getHours()).toBe(0);
    expect(startOfLocalDay(afterChange).getHours()).toBe(0);

    // Subtracting a fixed 86 400 000 ms from the 31st's midnight overshoots the
    // short day completely and lands on the 29th at 23:00 — a different day,
    // not merely a different hour. It is retention, a deletion, that hangs off
    // this arithmetic elsewhere in the app.
    const naive = new Date(startOfLocalDay(afterChange).getTime() - 24 * 60 * 60 * 1000);
    expect(naive.getDate()).toBe(29);
    expect(naive.getHours()).toBe(23);
  });

  it('covers a whole local day, last second included', () => {
    // The closed form was `23:59:59`, which drops the final second of every
    // day — a whole second of a surveillance camera's record, silently.
    const { from, to } = localDayRange('2025-06-15');
    expect(new Date(from).getHours()).toBe(0);
    expect(new Date(from).getDate()).toBe(15);

    const lastSecond = new Date(2025, 5, 15, 23, 59, 59, 999);
    expect(new Date(to).getTime()).toBeGreaterThanOrEqual(lastSecond.getTime());
    expect(new Date(to).getDate()).toBe(15);
  });
});

describe('the timeline resource', () => {
  it('holds the events of the local day it names', async () => {
    // In Paris, 23:30 local on the 15th is 21:30 UTC — inside the local day
    // and inside the UTC day. 00:30 local on the 16th is 22:30 UTC on the
    // 15th: a UTC-cut timeline put it on the wrong day, in both directions.
    const api = apiWith([
      event(new Date(2025, 5, 15, 23, 30), 1),
      event(new Date(2025, 5, 16, 0, 30), 2),
    ]);

    const res = await readTimelineResource('2025-06-15', api, authorizer, context);
    const payload = JSON.parse(res.text);

    expect(payload.events.map((e: any) => e.id)).toEqual([1]);
    expect(payload.events[0].time).toBe('23:30:00');
  });

  it('says when a day did not fit', async () => {
    // A day busier than the page limit came back looking like a quiet day,
    // the real count discarded with the rest of the page.
    const many = Array.from({ length: 130 }, (_, i) =>
      event(new Date(2025, 5, 15, 8, 0, 0, i), i + 1));

    const res = await readTimelineResource('2025-06-15', apiWith(many), authorizer, context);
    const payload = JSON.parse(res.text);

    expect(payload.events).toHaveLength(100);
    expect(payload.total).toBe(130);
    expect(payload.truncated).toBe(true);
  });

  it('does not claim truncation on a day that fits', async () => {
    const res = await readTimelineResource(
      '2025-06-15', apiWith([event(new Date(2025, 5, 15, 9, 0), 1)]), authorizer, context);
    const payload = JSON.parse(res.text);

    expect(payload.total).toBe(1);
    expect(payload.truncated).toBe(false);
  });
});

describe('the statistics resource', () => {
  it('starts today at local midnight', async () => {
    const now = new Date();
    const justAfterMidnight = startOfLocalDay(now);
    justAfterMidnight.setMinutes(justAfterMidnight.getMinutes() + 1);
    if (justAfterMidnight.getTime() > now.getTime()) return; // run before 00:01

    const res = await readStatisticsResource(
      'today', apiWith([event(justAfterMidnight, 1)]), authorizer, context);
    expect(JSON.parse(res.text).total).toBe(1);
  });

  it('counts 7d as seven calendar days, matching the on-device server', async () => {
    // `now - 7 × 86 400 000` and "the last seven calendar days" are different
    // windows, and the two servers used one each — so the same period name
    // answered differently depending on which half a client reached.
    const res = await readStatisticsResource('7d', apiWith([]), authorizer, context);
    const from = new Date(JSON.parse(res.text).period.from);

    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(from.getDate()).toBe(startOfDaysBefore(new Date(), 6).getDate());
  });

  it('refuses a period it does not name', async () => {
    await expect(readStatisticsResource('365d', apiWith([]), authorizer, context))
      .rejects.toMatchObject({ code: 'NOVAGUARD_INVALID_ARGUMENT' });
  });
});
