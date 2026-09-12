import { NovaGuardReadApiClient } from '../client/NovaGuardReadApiClient';
import { Authorizer } from '../security/authorization';
import { SecurityContext } from '../security/authentication';
import { McpError } from '../types';

export async function readStatisticsResource(
  periodParam: string,
  client: NovaGuardReadApiClient,
  authorizer: Authorizer,
  context: SecurityContext
): Promise<{ mimeType: string; text: string }> {
  authorizer.authorize(context, ['novaguard:statistics:read', 'novaguard:read']);

  const now = new Date();
  let fromStr: string;
  let toStr: string = now.toISOString();

  if (periodParam === 'today') {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    fromStr = today.toISOString();
  } else if (periodParam === '7d') {
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    fromStr = d7.toISOString();
  } else if (periodParam === '30d') {
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    fromStr = d30.toISOString();
  } else if (periodParam.includes('..')) {
    const [f, t] = periodParam.split('..');
    fromStr = f;
    toStr = t;
  } else {
    throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Unsupported period parameter: ${periodParam}`, 400);
  }

  const stats = await client.getStatistics({ from: fromStr, to: toStr, groupBy: 'kind' });

  return {
    mimeType: 'application/json',
    text: JSON.stringify(stats, null, 2),
  };
}
