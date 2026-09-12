import {
  CameraInfoDto,
  ConfigurationDto,
  DetectionEventDto,
  LatestEventsParams,
  McpError,
  SearchEventsParams,
  SearchEventsResultDto,
  StatisticsGroupDto,
  StatisticsParams,
  StatisticsResultDto,
  StatusDto,
  StorageDetailDto,
} from '../types';

export interface NovaGuardReadApiClientOptions {
  baseUrl?: string;
  authToken?: string;
  fetchFn?: typeof fetch;
  mockDataSource?: NovaGuardMockDataSource;
  requestTimeoutMs?: number;
  maxMediaBytes?: number;
}

export interface RawEvent {
  id: number;
  kind: 'Personne' | 'Animal';
  timestamp: number;
  dur: number;
  conf: number;
  path: string | null;
  bytes: number;
  thumbPath: string | null;
  thumbnailBuffer?: Buffer;
  videoBuffer?: Buffer;
}

export interface NovaGuardMockDataSource {
  surveillanceActive: boolean;
  camera: string;
  lastDetectionAt: number | null;
  detectionsToday: number;
  storage: { free: number; total: number };
  settings: {
    camera: string;
    person: boolean;
    animal: boolean;
    sens: string;
    threshold: number;
    preciseDetection: boolean;
    autoZoom: boolean;
    zone: any;
    quality: string;
    post: string;
    max: string;
    retention: string;
    autoDel: boolean;
    notif: boolean;
    notifDet: boolean;
    localStreamPin?: string;
  };
  events: RawEvent[];
}

export class NovaGuardReadApiClient {
  private baseUrl?: string;
  private authToken?: string;
  private fetchFn: typeof fetch;
  private mockDataSource?: NovaGuardMockDataSource;
  private readonly requestTimeoutMs: number;
  private readonly maxMediaBytes: number;

  constructor(options: NovaGuardReadApiClientOptions = {}) {
    this.baseUrl = options.baseUrl;
    this.authToken = options.authToken;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.mockDataSource = options.mockDataSource;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.maxMediaBytes = options.maxMediaBytes ?? 20 * 1024 * 1024;
  }

  public setMockDataSource(ds: NovaGuardMockDataSource) { this.mockDataSource = ds; }

  private mapRawEventToDto(event: RawEvent): DetectionEventDto {
    return {
      id: event.id,
      kind: event.kind,
      timestamp: new Date(event.timestamp).toISOString(),
      durationSeconds: event.dur,
      confidence: event.conf,
      hasVideo: Boolean(event.path && event.bytes > 0),
      videoResourceUri: event.path ? `novaguard://video/${event.id}` : null,
      thumbnailResourceUri: event.thumbPath ? `novaguard://thumbnail/${event.id}` : null,
      sizeBytes: event.bytes,
    };
  }

  public async getStatus(): Promise<StatusDto> {
    if (this.mockDataSource) {
      const ds = this.mockDataSource;
      const usedBytes = ds.events.reduce((sum, e) => sum + e.bytes, 0);
      return { surveillanceActive: ds.surveillanceActive, camera: ds.camera,
        lastDetectionAt: ds.lastDetectionAt ? new Date(ds.lastDetectionAt).toISOString() : null,
        detectionsToday: ds.detectionsToday,
        storage: { usedBytes, freeBytes: ds.storage.free, totalBytes: ds.storage.total } };
    }
    return this.httpRequest<StatusDto>('/api/v1/status');
  }

  public async searchEvents(params: SearchEventsParams): Promise<SearchEventsResultDto> {
    if (params.limit !== undefined && (params.limit < 1 || params.limit > 100)) throw new McpError('NOVAGUARD_LIMIT_EXCEEDED', 'Limit must be between 1 and 100', 400);
    if (params.offset !== undefined && (params.offset < 0 || params.offset > 10000)) throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Offset must be between 0 and 10000', 400);
    const limit = params.limit ?? 20;
    const offset = params.offset ?? 0;
    const sort = params.sort ?? 'timestamp_desc';
    const nowMs = Date.now();
    let fromMs = nowMs - 24 * 60 * 60 * 1000;
    let toMs = nowMs;
    if (params.from) { const parsed = Date.parse(params.from); if (isNaN(parsed)) throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Invalid 'from' timestamp: ${params.from}`, 400); fromMs = parsed; }
    if (params.to) { const parsed = Date.parse(params.to); if (isNaN(parsed)) throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `Invalid 'to' timestamp: ${params.to}`, 400); toMs = parsed; }
    if (fromMs > toMs) throw new McpError('NOVAGUARD_INVALID_ARGUMENT', `'from' date must be before 'to' date`, 400);
    if (toMs - fromMs > 90 * 24 * 60 * 60 * 1000) throw new McpError('NOVAGUARD_RANGE_TOO_LARGE', 'Date range exceeds maximum of 90 days', 400);
    if (this.mockDataSource) {
      let filtered = this.mockDataSource.events.filter(e => e.timestamp >= fromMs && e.timestamp <= toMs);
      if (params.kind) filtered = filtered.filter(e => e.kind === params.kind);
      if (params.minConfidence !== undefined) filtered = filtered.filter(e => e.conf >= params.minConfidence!);
      if (params.hasVideo !== undefined) filtered = filtered.filter(e => Boolean(e.path && e.bytes > 0) === params.hasVideo);
      filtered.sort((a,b) => sort === 'timestamp_desc' ? b.timestamp-a.timestamp : a.timestamp-b.timestamp);
      return { events: filtered.slice(offset, offset + limit).map(e => this.mapRawEventToDto(e)), total: filtered.length, limit, offset };
    }
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
    if (typeof eventId !== 'number' || eventId < 0 || !Number.isInteger(eventId)) throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'eventId must be a non-negative integer', 400);
    if (this.mockDataSource) {
      const found = this.mockDataSource.events.find(e => e.id === eventId);
      if (!found) throw new McpError('NOVAGUARD_NOT_FOUND', `Event ${eventId} not found`, 404);
      return this.mapRawEventToDto(found);
    }
    return this.httpRequest<DetectionEventDto>(`/api/v1/events/${eventId}`);
  }

  public async getLatestEvents(params: LatestEventsParams = {}): Promise<DetectionEventDto[]> {
    const limit = params.limit ?? 5;
    if (limit < 1 || limit > 20) throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Limit must be between 1 and 20', 400);
    if (this.mockDataSource) {
      let list = [...this.mockDataSource.events];
      if (params.kind) list = list.filter(e => e.kind === params.kind);
      list.sort((a,b) => b.timestamp-a.timestamp);
      return list.slice(0, limit).map(e => this.mapRawEventToDto(e));
    }
    const query = new URLSearchParams();
    if (params.kind) query.set('kind', params.kind);
    query.set('limit', String(limit));
    return this.httpRequest<DetectionEventDto[]>(`/api/v1/events/latest?${query.toString()}`);
  }

  public async getStatistics(params: StatisticsParams): Promise<StatisticsResultDto> {
    if (!params.from || !params.to) throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Both from and to parameters are required', 400);
    const fromMs = Date.parse(params.from), toMs = Date.parse(params.to);
    if (isNaN(fromMs) || isNaN(toMs)) throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'Invalid from or to timestamp', 400);
    if (fromMs > toMs) throw new McpError('NOVAGUARD_INVALID_ARGUMENT', 'from must be before to', 400);
    if (this.mockDataSource) {
      const filtered = this.mockDataSource.events.filter(e => e.timestamp >= fromMs && e.timestamp <= toMs);
      const total = filtered.length;
      const persons = filtered.filter(e => e.kind === 'Personne').length;
      const animals = filtered.filter(e => e.kind === 'Animal').length;
      const withVideo = filtered.filter(e => Boolean(e.path && e.bytes > 0)).length;
      const groups = params.groupBy ? this.buildGroups(filtered, params.groupBy) : undefined;
      return { period: { from: params.from, to: params.to }, total, persons, animals,
        averageConfidence: total ? Number((filtered.reduce((s,e)=>s+e.conf,0)/total).toFixed(2)) : 0,
        withVideo, withoutVideo: total-withVideo, groups };
    }
    const query = new URLSearchParams({ from: params.from, to: params.to });
    if (params.groupBy) query.set('groupBy', params.groupBy);
    return this.httpRequest<StatisticsResultDto>(`/api/v1/statistics?${query.toString()}`);
  }

  private buildGroups(filtered: RawEvent[], groupBy: 'hour' | 'day' | 'kind'): StatisticsGroupDto[] {
    const groupMap = new Map<string, { count: number; persons: number; animals: number }>();
    for (const e of filtered) {
      const d = new Date(e.timestamp);
      const key = groupBy === 'kind' ? e.kind : groupBy === 'day' ? d.toISOString().split('T')[0] : `${d.toISOString().split('T')[0]}T${String(d.getUTCHours()).padStart(2,'0')}:00`;
      const existing = groupMap.get(key) || { count: 0, persons: 0, animals: 0 };
      existing.count++; if (e.kind === 'Personne') existing.persons++; if (e.kind === 'Animal') existing.animals++;
      groupMap.set(key, existing);
    }
    return Array.from(groupMap.entries()).map(([key,val]) => ({ key, ...val }));
  }

  public async getStorage(): Promise<StorageDetailDto> {
    if (this.mockDataSource) {
      const ds = this.mockDataSource, usedBytes = ds.events.reduce((sum,e)=>sum+e.bytes,0);
      return { usedBytes, freeBytes: ds.storage.free, totalBytes: ds.storage.total, eventCount: ds.events.length, videoCount: ds.events.filter(e=>Boolean(e.path&&e.bytes>0)).length };
    }
    return this.httpRequest<StorageDetailDto>('/api/v1/storage');
  }

  public async getConfiguration(): Promise<ConfigurationDto> {
    if (this.mockDataSource) {
      const s = this.mockDataSource.settings;
      return { camera:s.camera, detection:{person:s.person,animal:s.animal,sensitivity:s.sens,threshold:s.threshold,preciseDetection:s.preciseDetection,autoZoom:s.autoZoom,zoneConfigured:Boolean(s.zone)}, recording:{quality:s.quality,postRoll:s.post,maxClipDuration:s.max,retention:s.retention,automaticDeletion:s.autoDel}, notifications:{enabled:s.notif,detectionNotifications:s.notifDet} };
    }
    return this.httpRequest<ConfigurationDto>('/api/v1/configuration');
  }

  public async getCameraInfo(): Promise<CameraInfoDto> {
    if (this.mockDataSource) return { camera:this.mockDataSource.camera, active:this.mockDataSource.surveillanceActive, streamEnabled:Boolean(this.mockDataSource.settings.localStreamPin) };
    return this.httpRequest<CameraInfoDto>('/api/v1/camera');
  }

  public async getThumbnail(eventId: number): Promise<{ mimeType:string; data:Buffer } | null> {
    if (this.mockDataSource) {
      const found = this.mockDataSource.events.find(e=>e.id===eventId);
      if (!found || !found.thumbPath) throw new McpError('NOVAGUARD_MEDIA_UNAVAILABLE', `Thumbnail for event ${eventId} unavailable`, 404);
      return { mimeType:'image/jpeg', data:found.thumbnailBuffer || Buffer.from('mock-thumbnail-bytes') };
    }
    return this.httpBinaryRequest(`/api/v1/events/${eventId}/thumbnail`, 'image/jpeg');
  }

  public async getVideo(eventId: number): Promise<{ mimeType:string; data:Buffer } | null> {
    if (this.mockDataSource) {
      const found = this.mockDataSource.events.find(e=>e.id===eventId);
      if (!found || !found.path || found.bytes===0) throw new McpError('NOVAGUARD_MEDIA_UNAVAILABLE', `Video for event ${eventId} unavailable`, 404);
      return { mimeType:'video/mp4', data:found.videoBuffer || Buffer.from('mock-video-bytes') };
    }
    return this.httpBinaryRequest(`/api/v1/events/${eventId}/video`, 'video/mp4');
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

  private async httpBinaryRequest(path: string, expectedMime: string): Promise<{mimeType:string;data:Buffer}> {
    if (!this.baseUrl) throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE','No baseUrl configured for NovaGuard read API',503);
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
      if (contentLength && Number(contentLength) > this.maxMediaBytes) {
        throw new McpError('NOVAGUARD_MEDIA_TOO_LARGE', `Media exceeds maximum size of ${this.maxMediaBytes} bytes`, 413);
      }
      const arrayBuf = await res.arrayBuffer();
      if (arrayBuf.byteLength > this.maxMediaBytes) {
        throw new McpError('NOVAGUARD_MEDIA_TOO_LARGE', `Media exceeds maximum size of ${this.maxMediaBytes} bytes`, 413);
      }
      return { mimeType:expectedMime, data:Buffer.from(arrayBuf) };
    } catch (err:any) {
      if (err instanceof McpError) throw err;
      throw new McpError('NOVAGUARD_DEVICE_UNAVAILABLE','Failed to retrieve media',503);
    }
  }
}
