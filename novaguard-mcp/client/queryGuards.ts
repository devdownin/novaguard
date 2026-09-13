import { McpError, SearchEventsParams, StatisticsParams } from '../types';

/**
 * The bounds a read request has to satisfy, whoever answers it.
 *
 * They belong to the request, not to the transport: a 90-day cap protects the
 * caller and the device from the same thing whether the events come off a
 * socket or out of a fixture. Left inside the HTTP client, they were applied
 * by whichever branch happened to run, so a second implementation would have
 * silently had none.
 */

export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 100;
export const SEARCH_MAX_OFFSET = 10_000;
export const LATEST_DEFAULT_LIMIT = 5;
export const LATEST_MAX_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
export const SEARCH_MAX_RANGE_MS = 90 * DAY_MS;

export interface ResolvedSearch {
  limit: number;
  offset: number;
  sort: 'timestamp_desc' | 'timestamp_asc';
  fromMs: number;
  toMs: number;
}

function parseTimestamp(value: string, field: 'from' | 'to'): number {
  const parsed = Date.parse(value);
  if (isNaN(parsed)) {
    throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Invalid '${field}' timestamp: ${value}`, 400);
  }
  return parsed;
}

export function resolveSearchParams(params: SearchEventsParams, now = Date.now()): ResolvedSearch {
  if (params.limit !== undefined && (params.limit < 1 || params.limit > SEARCH_MAX_LIMIT)) {
    throw new McpError('NOVAGUARD_LIMIT_EXCEEDED', `Limit must be between 1 and ${SEARCH_MAX_LIMIT}`, 400);
  }
  if (params.offset !== undefined && (params.offset < 0 || params.offset > SEARCH_MAX_OFFSET)) {
    throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Offset must be between 0 and ${SEARCH_MAX_OFFSET}`, 400);
  }

  // With no range given the window is the last 24 hours, not all of history:
  // an unbounded default would make the cheapest possible call the most
  // expensive one. `search_events` says so in its description.
  const fromMs = params.from ? parseTimestamp(params.from, 'from') : now - DAY_MS;
  const toMs = params.to ? parseTimestamp(params.to, 'to') : now;
  if (fromMs > toMs) {
    throw new McpError('NOVAGUARD_INVALID_ARGUMENT', "'from' date must be before 'to' date", 400);
  }
  if (toMs - fromMs > SEARCH_MAX_RANGE_MS) {
    throw new McpError('NOVAGUARD_RANGE_TOO_LARGE', 'Date range exceeds maximum of 90 days', 400);
  }

  return {
    limit: params.limit ?? SEARCH_DEFAULT_LIMIT,
    offset: params.offset ?? 0,
    sort: params.sort ?? 'timestamp_desc',
    fromMs,
    toMs,
  };
}

export function resolveLatestLimit(limit?: number): number {
  const resolved = limit ?? LATEST_DEFAULT_LIMIT;
  if (resolved < 1 || resolved > LATEST_MAX_LIMIT) {
    throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Limit must be between 1 and ${LATEST_MAX_LIMIT}`, 400);
  }
  return resolved;
}

export function resolveStatisticsRange(params: StatisticsParams): { fromMs: number; toMs: number } {
  if (!params.from || !params.to) {
    throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Both from and to parameters are required', 400);
  }
  const fromMs = parseTimestamp(params.from, 'from');
  const toMs = parseTimestamp(params.to, 'to');
  if (fromMs > toMs) {
    throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'from must be before to', 400);
  }
  return { fromMs, toMs };
}

export function assertEventId(eventId: number): void {
  if (typeof eventId !== 'number' || eventId < 0 || !Number.isInteger(eventId)) {
    throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'eventId must be a non-negative integer', 400);
  }
}
