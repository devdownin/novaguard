import { NovaGuardReadApi } from '../api';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { localDayRange, localTimeOf } from '../calendar';

/** Matches the on-device server, so one day means one thing on both. */
const TIMELINE_LIMIT = 100;

export async function readTimelineResource(
  dateStr: string,
  client: NovaGuardReadApi,
  authorizer: Authorizer,
  context: SecurityContext
): Promise<{ mimeType: string; text: string }> {
  authorizer.authorize(context, ['novaguard:events:read', 'novaguard:read']);

  const { from, to } = localDayRange(dateStr);

  const searchResult = await client.searchEvents({
    from,
    to,
    limit: TIMELINE_LIMIT,
    sort: 'timestamp_asc',
  });

  const compactEvents = searchResult.events.map((e) => ({
    id: e.id,
    time: localTimeOf(e.timestamp),
    kind: e.kind,
    confidence: e.confidence,
    durationSeconds: e.durationSeconds,
  }));

  // `total` and `truncated` are the point of this shape. The page limit was
  // applied and the real count thrown away, so a day busier than the limit came
  // back looking like a quiet day — on a surveillance camera, the one wrong
  // answer that reads as a right one.
  const payload = {
    date: dateStr,
    events: compactEvents,
    total: searchResult.total,
    truncated: searchResult.total > compactEvents.length,
  };

  return {
    mimeType: 'application/json',
    text: JSON.stringify(payload, null, 2),
  };
}
