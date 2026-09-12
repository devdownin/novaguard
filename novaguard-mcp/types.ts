export type DetectionKind = 'Personne' | 'Animal';

export type McpErrorCode =
  | 'NOVAGUARD_NOT_FOUND'
  | 'NOVAGUARD_INVALID_ARGUMENT'
  | 'NOVAGUARD_INVALID_REQUEST'
  | 'NOVAGUARD_RANGE_TOO_LARGE'
  | 'NOVAGUARD_LIMIT_EXCEEDED'
  | 'NOVAGUARD_MEDIA_UNAVAILABLE'
  | 'NOVAGUARD_MEDIA_FORBIDDEN'
  | 'NOVAGUARD_STORAGE_UNAVAILABLE'
  | 'NOVAGUARD_DEVICE_UNAVAILABLE'
  | 'NOVAGUARD_AUTH_REQUIRED'
  | 'NOVAGUARD_AUTH_FORBIDDEN';

export class McpError extends Error {
  public readonly code: McpErrorCode;
  public readonly status: number;

  constructor(code: McpErrorCode, message: string, status: number = 400) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.status = status;
    Object.setPrototypeOf(this, McpError.prototype);
  }
}

export interface DetectionEventDto {
  id: number;
  kind: DetectionKind;
  timestamp: string;
  durationSeconds: number;
  confidence: number;
  hasVideo: boolean;
  videoResourceUri: string | null;
  thumbnailResourceUri: string | null;
  sizeBytes: number;
}

export interface StorageStatsDto { usedBytes: number; freeBytes: number; totalBytes: number; }
export interface StatusDto {
  surveillanceActive: boolean;
  camera: string;
  lastDetectionAt: string | null;
  detectionsToday: number;
  storage: StorageStatsDto;
}
export interface StorageDetailDto extends StorageStatsDto { eventCount: number; videoCount: number; }
export interface SearchEventsParams {
  from?: string; to?: string; kind?: DetectionKind; minConfidence?: number; hasVideo?: boolean;
  limit?: number; offset?: number; sort?: 'timestamp_desc' | 'timestamp_asc';
}
export interface SearchEventsResultDto { events: DetectionEventDto[]; total: number; limit: number; offset: number; }
export interface LatestEventsParams { kind?: DetectionKind; limit?: number; }
export interface StatisticsParams { from: string; to: string; groupBy?: 'hour' | 'day' | 'kind'; }
export interface StatisticsGroupDto { key: string; count: number; persons: number; animals: number; }
export interface StatisticsResultDto {
  period: { from: string; to: string }; total: number; persons: number; animals: number;
  averageConfidence: number; withVideo: number; withoutVideo: number; groups?: StatisticsGroupDto[];
}
export interface ConfigurationDto {
  camera: string;
  detection: { person: boolean; animal: boolean; sensitivity: string; threshold: number; preciseDetection: boolean; autoZoom: boolean; zoneConfigured: boolean; };
  recording: { quality: string; postRoll: string; maxClipDuration: string; retention: string; automaticDeletion: boolean; };
  notifications: { enabled: boolean; detectionNotifications: boolean; };
}
export interface CameraInfoDto { camera: string; active: boolean; streamEnabled: boolean; }
export interface MediaResourceContent { mimeType: string; data: Buffer | string; }
