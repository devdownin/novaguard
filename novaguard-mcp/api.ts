import {
  CameraInfoDto,
  ConfigurationDto,
  DetectionEventDto,
  LatestEventsParams,
  SearchEventsParams,
  SearchEventsResultDto,
  StatisticsParams,
  StatisticsResultDto,
  StatusDto,
  StorageDetailDto,
} from './types';

/**
 * What the tools and resources need, without saying where it comes from.
 *
 * The client used to be one class holding both the HTTP path and a branch that
 * answered from an in-memory fixture, checked at the top of every method. Two
 * costs. A production object shipped with a switch that makes it serve invented
 * surveillance data — set the fixture by accident and the server answers
 * confidently about events that never happened. And the fixture branch was the
 * only path the suite ever took, so the HTTP path — the one that runs on a
 * device — was reached by almost no test at all.
 */
export interface NovaGuardReadApi {
  getStatus(): Promise<StatusDto>;
  searchEvents(params: SearchEventsParams): Promise<SearchEventsResultDto>;
  getEvent(eventId: number): Promise<DetectionEventDto>;
  getLatestEvents(params?: LatestEventsParams): Promise<DetectionEventDto[]>;
  getStatistics(params: StatisticsParams): Promise<StatisticsResultDto>;
  getStorage(): Promise<StorageDetailDto>;
  getConfiguration(): Promise<ConfigurationDto>;
  getCameraInfo(): Promise<CameraInfoDto>;
  getThumbnail(eventId: number, maxBytes?: number): Promise<{ mimeType: string; data: Buffer } | null>;
  getVideo(eventId: number, maxBytes?: number): Promise<{ mimeType: string; data: Buffer } | null>;

  /**
   * The upstream this implementation talks to, when it talks to one at all.
   *
   * Both members below are absent on an implementation with no network reach,
   * which is exactly what the server has to be able to tell: there is nothing
   * to vet and nothing to guard when no request leaves the process.
   */
  readonly endpoint?: string;
  guardRequests?(wrap: (fetchFn: typeof fetch) => typeof fetch): boolean;
}
