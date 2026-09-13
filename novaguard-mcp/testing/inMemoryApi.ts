import { NovaGuardReadApi } from '../api';
import {
  assertEventId,
  resolveLatestLimit,
  resolveSearchParams,
  resolveStatisticsRange,
} from '../client/queryGuards';
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

/**
 * One event as NovaGuard stores it, before any of it is fit to return.
 *
 * `path` and `thumbPath` are the reason the DTO is built field by field rather
 * than spread: `mcp.md` §14 forbids returning a raw filesystem path, and a
 * caller gets a `novaguard://` URI instead.
 */
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

/**
 * A read API backed by a fixture, for tests.
 *
 * It lives here, outside the client, because a production object must not carry
 * a switch that makes it answer with invented surveillance data. It shares the
 * request guards rather than reimplementing them, so a range or a page size
 * refused against a device is refused here too — a fixture that accepts more
 * than the real thing is a test that proves nothing.
 *
 * It has no `endpoint` and no `guardRequests`: nothing leaves the process, so
 * there is nothing to vet and nothing to wrap.
 */
export class InMemoryNovaGuardApi implements NovaGuardReadApi {
  constructor(private data: NovaGuardMockDataSource) {}

  public setData(data: NovaGuardMockDataSource) { this.data = data; }

  private toDto(event: RawEvent): DetectionEventDto {
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

  private get usedBytes(): number {
    return this.data.events.reduce((sum, e) => sum + e.bytes, 0);
  }

  public async getStatus(): Promise<StatusDto> {
    return {
      surveillanceActive: this.data.surveillanceActive,
      camera: this.data.camera,
      lastDetectionAt: this.data.lastDetectionAt ? new Date(this.data.lastDetectionAt).toISOString() : null,
      detectionsToday: this.data.detectionsToday,
      storage: { usedBytes: this.usedBytes, freeBytes: this.data.storage.free, totalBytes: this.data.storage.total },
    };
  }

  public async searchEvents(params: SearchEventsParams): Promise<SearchEventsResultDto> {
    const { limit, offset, sort, fromMs, toMs } = resolveSearchParams(params);

    let filtered = this.data.events.filter(e => e.timestamp >= fromMs && e.timestamp <= toMs);
    if (params.kind) filtered = filtered.filter(e => e.kind === params.kind);
    if (params.minConfidence !== undefined) filtered = filtered.filter(e => e.conf >= params.minConfidence!);
    if (params.hasVideo !== undefined) filtered = filtered.filter(e => Boolean(e.path && e.bytes > 0) === params.hasVideo);
    filtered.sort((a, b) => (sort === 'timestamp_desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp));

    return {
      events: filtered.slice(offset, offset + limit).map(e => this.toDto(e)),
      total: filtered.length,
      limit,
      offset,
    };
  }

  public async getEvent(eventId: number): Promise<DetectionEventDto> {
    assertEventId(eventId);
    const found = this.data.events.find(e => e.id === eventId);
    if (!found) throw new McpError('NOVAGUARD_NOT_FOUND', `Event ${eventId} not found`, 404);
    return this.toDto(found);
  }

  public async getLatestEvents(params: LatestEventsParams = {}): Promise<DetectionEventDto[]> {
    const limit = resolveLatestLimit(params.limit);
    let list = [...this.data.events];
    if (params.kind) list = list.filter(e => e.kind === params.kind);
    list.sort((a, b) => b.timestamp - a.timestamp);
    return list.slice(0, limit).map(e => this.toDto(e));
  }

  public async getStatistics(params: StatisticsParams): Promise<StatisticsResultDto> {
    const { fromMs, toMs } = resolveStatisticsRange(params);
    const filtered = this.data.events.filter(e => e.timestamp >= fromMs && e.timestamp <= toMs);
    const total = filtered.length;
    const persons = filtered.filter(e => e.kind === 'Personne').length;
    const withVideo = filtered.filter(e => Boolean(e.path && e.bytes > 0)).length;

    return {
      period: { from: params.from, to: params.to },
      total,
      persons,
      animals: total - persons,
      averageConfidence: total ? Number((filtered.reduce((s, e) => s + e.conf, 0) / total).toFixed(2)) : 0,
      withVideo,
      withoutVideo: total - withVideo,
      groups: params.groupBy ? this.buildGroups(filtered, params.groupBy) : undefined,
    };
  }

  private buildGroups(filtered: RawEvent[], groupBy: 'hour' | 'day' | 'kind'): StatisticsGroupDto[] {
    const groups = new Map<string, { count: number; persons: number; animals: number }>();
    for (const event of filtered) {
      const at = new Date(event.timestamp);
      const day = at.toISOString().split('T')[0];
      const key = groupBy === 'kind' ? event.kind
        : groupBy === 'day' ? day
        : `${day}T${String(at.getUTCHours()).padStart(2, '0')}:00`;
      const bucket = groups.get(key) || { count: 0, persons: 0, animals: 0 };
      bucket.count += 1;
      if (event.kind === 'Personne') bucket.persons += 1; else bucket.animals += 1;
      groups.set(key, bucket);
    }
    return Array.from(groups.entries()).map(([key, value]) => ({ key, ...value }));
  }

  public async getStorage(): Promise<StorageDetailDto> {
    return {
      usedBytes: this.usedBytes,
      freeBytes: this.data.storage.free,
      totalBytes: this.data.storage.total,
      eventCount: this.data.events.length,
      videoCount: this.data.events.filter(e => Boolean(e.path && e.bytes > 0)).length,
    };
  }

  public async getConfiguration(): Promise<ConfigurationDto> {
    const s = this.data.settings;
    return {
      camera: s.camera,
      detection: {
        person: s.person, animal: s.animal, sensitivity: s.sens, threshold: s.threshold,
        preciseDetection: s.preciseDetection, autoZoom: s.autoZoom, zoneConfigured: Boolean(s.zone),
      },
      recording: {
        quality: s.quality, postRoll: s.post, maxClipDuration: s.max,
        retention: s.retention, automaticDeletion: s.autoDel,
      },
      notifications: { enabled: s.notif, detectionNotifications: s.notifDet },
    };
  }

  public async getCameraInfo(): Promise<CameraInfoDto> {
    return {
      camera: this.data.camera,
      active: this.data.surveillanceActive,
      streamEnabled: Boolean(this.data.settings.localStreamPin),
    };
  }

  public async getThumbnail(eventId: number): Promise<{ mimeType: string; data: Buffer }> {
    const found = this.data.events.find(e => e.id === eventId);
    if (!found || !found.thumbPath) {
      throw new McpError('NOVAGUARD_MEDIA_UNAVAILABLE', `Thumbnail for event ${eventId} unavailable`, 404);
    }
    return { mimeType: 'image/jpeg', data: found.thumbnailBuffer || Buffer.from('mock-thumbnail-bytes') };
  }

  public async getVideo(eventId: number): Promise<{ mimeType: string; data: Buffer }> {
    const found = this.data.events.find(e => e.id === eventId);
    if (!found || !found.path || found.bytes === 0) {
      throw new McpError('NOVAGUARD_MEDIA_UNAVAILABLE', `Video for event ${eventId} unavailable`, 404);
    }
    return { mimeType: 'video/mp4', data: found.videoBuffer || Buffer.from('mock-video-bytes') };
  }
}
