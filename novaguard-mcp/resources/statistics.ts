import { NovaGuardReadApi } from '../api';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { McpError } from '../types';
import { startOfDaysBefore, startOfLocalDay } from '../calendar';

export async function readStatisticsResource(
  periodParam: string,
  client: NovaGuardReadApi,
  authorizer: Authorizer,
  context: SecurityContext
): Promise<{ mimeType: string; text: string }> {
  authorizer.authorize(context, ['novaguard:statistics:read', 'novaguard:read']);

  // Calendar days, not multiples of 86 400 000 ms: `7d` is the seven days the
  // history screen would show, each starting at local midnight, so a period
  // spanning a clock change still lines up with the day it names. The `a..b`
  // branch that used to sit here was unreachable — the sanitiser admits only
  // these three words — and it was the one that took its bounds from the URI.
  const now = new Date();
  const from =
    periodParam === 'today' ? startOfLocalDay(now) :
    periodParam === '7d' ? startOfDaysBefore(now, 6) :
    periodParam === '30d' ? startOfDaysBefore(now, 29) :
    null;
  if (!from) {
    throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Unsupported period parameter: ${periodParam}`, 400);
  }

  const stats = await client.getStatistics({ from: from.toISOString(), to: now.toISOString(), groupBy: 'kind' });

  return {
    mimeType: 'application/json',
    text: JSON.stringify(stats, null, 2),
  };
}
