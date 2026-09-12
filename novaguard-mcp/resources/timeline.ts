import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';

export async function readTimelineResource(
  dateStr: string,
  client: NovaGuardReadApiClient,
  authorizer: Authorizer,
  context: SecurityContext
): Promise<{ mimeType: string; text: string }> {
  authorizer.authorize(context, ['novaguard:events:read', 'novaguard:read']);

  const startOfDay = `${dateStr}T00:00:00Z`;
  const endOfDay = `${dateStr}T23:59:59Z`;

  const searchResult = await client.searchEvents({
    from: startOfDay,
    to: endOfDay,
    limit: 100,
    sort: 'timestamp_asc',
  });

  const compactEvents = searchResult.events.map((e) => {
    const timeStr = new Date(e.timestamp).toISOString().split('T')[1].substring(0, 8);
    return {
      id: e.id,
      time: timeStr,
      kind: e.kind,
      confidence: e.confidence,
      durationSeconds: e.durationSeconds,
    };
  });

  const payload = {
    date: dateStr,
    events: compactEvents,
  };

  return {
    mimeType: 'application/json',
    text: JSON.stringify(payload, null, 2),
  };
}
