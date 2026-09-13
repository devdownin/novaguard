import { NovaGuardReadApi } from '../api';
import {
  assertEventId,
  resolveLatestLimit,
  resolveSearchParams,
  resolveStatisticsRange,
} from './queryGuards';
import {
  CameraInfoDto,
  ConfigurationDto,
  DetectionEventDto,
  LatestEventsParams,
  McpError,
  SearchEventsParams,
  SearchEventsResultDto,
  StatisticsParams,
  StatisticsResultDto,
  StatusDto,
  StorageDetailDto,
} from '../types';

export interface NovaGuardReadApiClientOptions {
  baseUrl?: string;
  authToken?: string;
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number;
  maxMediaBytes?: number;
}

export class NovaGuardReadApiClient implements NovaGuardReadApi {
  private baseUrl?: string;
  private authToken?: string;
  private fetchFn: typeof fetch;
  private guarded = false;
  private readonly requestTimeoutMs: number;
  private readonly maxMediaBytes: number;

  constructor(options: NovaGuardReadApiClientOptions = {}) {
    this.baseUrl = options.baseUrl;
    this.authToken = options.authToken;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.maxMediaBytes = options.maxMediaBytes ?? 20 * 1024 * 1024;
  }

  /** The configured upstream, for a caller that has to vet it before use. */
  public get endpoint(): string | undefined { return this.baseUrl; }

  /**
   * Wraps every outgoing request in a guard, once.
   *
   * The server used to reach in and reassign the private `fetchFn`. Two
   * servers sharing one client stacked two guards, so a request paid for the
   * upstream checks twice and redirects were handled by both — and the whole
   * thing broke silently the day the field was renamed or made truly private.
   * Refusing a second wrap makes the idempotence explicit instead of leaving
   * it to whoever calls this.
   */
  public guardRequests(wrap: (fetchFn: typeof fetch) => typeof fetch): boolean {
    if (this.guarded) return false;
    this.fetchFn = wrap(this.fetchFn);
    this.guarded = true;
    return true;
  }

  public async getStatus(): Promise<StatusDto> {
    return this.httpRequest<StatusDto>('/api/v1/status');
  }

  public async searchEvents(params: SearchEventsParams): Promise<SearchEventsResultDto> {
    const { limit, offset, sort } = resolveSearchParams(params);
    const query = new URLSearchParams();
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.kind) query.set('kind', params.kind);
    if (params.minConfidence !== undefined) query.set('minConfidence', String(params.minConfidence));
    if (params.hasVideo !== undefined) query.set('hasVideo', String(params.hasVideo));
    query.set('limit', String(limit)); query.set('offset', String(offset)); query.set('sort', sort);
    return this.httpRequest<SearchEventsResultDto>(`/api/v1/events?${query.toString()}`);
  }

  public async getEvent(eventId: number): Promise<DetectionEventDto> {
    assertEventId(eventId);
    return this.httpRequest<DetectionEventDto>(`/api/v1/events/${eventId}`);
  }

  public async getLatestEvents(params: LatestEventsParams = {}): Promise<DetectionEventDto[]> {
    const limit = resolveLatestLimit(params.limit);
    const query = new URLSearchParams();
    if (params.kind) query.set('kind', params.kind);
    query.set('limit', String(limit));
    return this.httpRequest<DetectionEventDto[]>(`/api/v1/events/latest?${query.toString()}`);
  }

  public async getStatistics(params: StatisticsParams): Promise<StatisticsResultDto> {
    resolveStatisticsRange(params);
    const query = new URLSearchParams({ from: params.from, to: params.to });
    if (params.groupBy) query.set('groupBy', params.groupBy);
    return this.httpRequest<StatisticsResultDto>(`/api/v1/statistics?${query.toString()}`);
  }

  public async getStorage(): Promise<StorageDetailDto> {
    return this.httpRequest<StorageDetailDto>('/api/v1/storage');
  }

  public async getConfiguration(): Promise<ConfigurationDto> {
    return this.httpRequest<ConfigurationDto>('/api/v1/configuration');
  }

  public async getCameraInfo(): Promise<CameraInfoDto> {
    return this.httpRequest<CameraInfoDto>('/api/v1/camera');
  }

  public async getThumbnail(eventId: number, maxBytes?: number): Promise<{ mimeType:string; data:Buffer } | null> {
    assertEventId(eventId);
    return this.httpBinaryRequest(`/api/v1/events/${eventId}/thumbnail`, 'image/jpeg', maxBytes);
  }

  public async getVideo(eventId: number, maxBytes?: number): Promise<{ mimeType:string; data:Buffer } | null> {
    assertEventId(eventId);
    return this.httpBinaryRequest(`/api/v1/events/${eventId}/video`, 'video/mp4', maxBytes);
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new McpError('NOVAGUARD_TIMEOUT', 'NovaGuard API request timed out', 504);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async httpRequest<T>(path: string): Promise<T> {
    if (!this.baseUrl) throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE', 'No baseUrl configured for NovaGuard read API', 503);
    const headers: Record<string,string> = { Accept:'application/json' };
    if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, { headers });
      if (!res.ok) {
        if (res.status===404) throw new McpError('NOVAGUARD_NOT_FOUND','Resource not found',404);
        if (res.status===401) throw new McpError('NOVAGUARD_AUTH_REQUIRED','Authentication required',401);
        if (res.status===403) throw new McpError('NOVAGUARD_AUTH_FORBIDDEN','Access forbidden',403);
        throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE',`Upstream API returned status ${res.status}`,502);
      }
      return await res.json() as T;
    } catch (err:any) {
      if (err instanceof McpError) throw err;
      throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE','Failed to connect to NovaGuard API',503);
    }
  }

  /**
   * `maxBytes` is the caller's ceiling, not just this client's.
   *
   * The server rejects a thumbnail over 2 MB and a clip over 20 MB, and used
   * to do it *after* the whole body had been read into memory under the
   * client's own 20 MB cap — so an oversized thumbnail was downloaded in full
   * and then thrown away, ten times larger than anything that could have been
   * returned. Handing the real ceiling down means the stream aborts at it.
   */
  private async httpBinaryRequest(path: string, expectedMime: string, maxBytes?: number): Promise<{mimeType:string;data:Buffer}> {
    if (!this.baseUrl) throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE','No baseUrl configured for NovaGuard read API',503);
    const limit = Math.min(this.maxMediaBytes, maxBytes ?? this.maxMediaBytes);
    const headers: Record<string,string> = {};
    if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, { headers });
      if (!res.ok) {
        if (res.status===404) throw new McpError('NOVAGUARD_MEDIA_UNAVAILABLE','Media file not found or expired',404);
        if (res.status===401) throw new McpError('NOVAGUARD_AUTH_REQUIRED','Authentication required',401);
        if (res.status===403) throw new McpError('NOVAGUARD_AUTH_FORBIDDEN','Access forbidden',403);
        throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE',`Upstream API returned status ${res.status}`,502);
      }
      const contentLength = res.headers.get('content-length');
      if (contentLength) {
        const parsedLength = Number(contentLength);
        if (!Number.isFinite(parsedLength) || parsedLength < 0) {
          throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE', 'Invalid upstream Content-Length', 502);
        }
        if (parsedLength > limit) {
          throw new McpError('NOVAGUARD_MEDIA_TOO_LARGE', `Media exceeds maximum size of ${limit} bytes`, 413);
        }
      }
      if (!res.body) throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE', 'Upstream media response has no body', 502);

      const reader = res.body.getReader();
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          totalBytes += value.byteLength;
          if (totalBytes > limit) {
            await reader.cancel();
            throw new McpError('NOVAGUARD_MEDIA_TOO_LARGE', `Media exceeds maximum size of ${limit} bytes`, 413);
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      return { mimeType:expectedMime, data:Buffer.concat(chunks, totalBytes) };
    } catch (err:any) {
      if (err instanceof McpError) throw err;
      throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE','Failed to retrieve media',503);
    }
  }
}
