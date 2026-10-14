import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { Camera, VideoFile } from 'react-native-vision-camera';
import { MaxDuration } from '../state/types';
import { maxDurationMs } from './library';
import { deleteFile, deleteFiles, ensureRecordingsDir, fileSize, RECORDINGS_DIR } from './videoStore';

export interface Clip {
  /** Identity of the encoder invocation, retained across asynchronous finalisation. */
  recordingId: number;
  path: string;
  bytes: number;
  duration: number;
  thumbPath: string | null;
  /** Native buffered segments report their actual capture window. */
  startedAt?: number;
  endedAt?: number;
  continued?: boolean;
}

export const THUMBNAIL_QUALITY = 55;
export const FINALIZE_TIMEOUT_MS = 5000;
export const THUMBNAIL_TIMEOUT_MS = 1500;

export interface RecorderOptions {
  cameraRef: RefObject<Camera | null>;
  enabled: boolean;
  max: MaxDuration;
  onClip: (clip: Clip) => void;
  onError?: (message: string) => void;
  onRecovered?: () => void;
  onStarted?: (recordingId: number) => void;
  onMaxDuration?: () => void;
  onAbandoned?: (recordingId: number) => void;
  onEncoderFree?: (recordingId: number) => void;
}

export interface Recorder {
  isRecording: boolean;
  isReady?: boolean;
  start: (fromAt?: number) => boolean;
  stop: (untilAt?: number) => boolean;
  currentId: () => number | null;
  /** Buffered backends only persist frames through the last positive observation. */
  observe?: (untilAt: number) => void;
}

interface Invocation {
  id: number;
  stopping: boolean;
  completed: boolean;
  abandoned: boolean;
  thumb: Promise<string | null>;
  cap: ReturnType<typeof setTimeout> | null;
  finalize: ReturnType<typeof setTimeout> | null;
}

/** A snapshot may never resolve; it must not block the event carrying a video. */
function boundedThumbnail(snapshot: Promise<string | null>): Promise<string | null> {
  return new Promise(resolve => {
    let finished = false;
    const timer = setTimeout(() => { finished = true; resolve(null); }, THUMBNAIL_TIMEOUT_MS);
    snapshot.then(path => {
      if (finished) { deleteFile(path); return; }
      finished = true;
      clearTimeout(timer);
      resolve(path);
    });
  });
}

/** Legacy VisionCamera backend for users explicitly retaining post-roll. */
export function useRecorder(options: RecorderOptions): Recorder {
  const { cameraRef, enabled, max } = options;
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });
  const [isRecording, setIsRecording] = useState(false);
  const active = useRef<Invocation | null>(null);
  const sequence = useRef(0);
  const ready = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const prepare = () => {
      ensureRecordingsDir().then(() => { if (!cancelled) ready.current = true; })
        .catch(() => {
          if (cancelled) return;
          latest.current.onError?.("Dossier d'enregistrement inaccessible");
          retry = setTimeout(prepare, 1000);
        });
    };
    prepare();
    return () => { cancelled = true; if (retry != null) clearTimeout(retry); };
  }, []);

  const settle = useCallback((invocation: Invocation) => {
    if (invocation.cap != null) clearTimeout(invocation.cap);
    if (invocation.finalize != null) clearTimeout(invocation.finalize);
    invocation.cap = invocation.finalize = null;
    // A delayed callback from A must never settle B or cancel B's duration cap.
    if (active.current === invocation) {
      active.current = null;
      setIsRecording(false);
    }
  }, []);

  const abandon = useCallback((invocation: Invocation, message?: string) => {
    if (invocation.completed) return;
    invocation.completed = invocation.abandoned = true;
    settle(invocation);
    invocation.thumb.then(deleteFile);
    if (message) latest.current.onError?.(message);
    latest.current.onAbandoned?.(invocation.id);
  }, [settle]);

  const stop = useCallback((): boolean => {
    const invocation = active.current;
    if (!invocation || invocation.stopping) return false;
    invocation.stopping = true;
    if (invocation.cap != null) clearTimeout(invocation.cap);
    invocation.cap = null;
    invocation.finalize = setTimeout(() => abandon(invocation), FINALIZE_TIMEOUT_MS);
    try {
      const camera = cameraRef.current;
      if (!camera) { abandon(invocation); return false; }
      // VisionCamera returns a Promise. A synchronous try/catch alone misses rejection.
      Promise.resolve(camera.stopRecording()).catch(error => {
        abandon(invocation, error instanceof Error ? error.message : 'Arrêt impossible');
      });
      return true;
    } catch (error) {
      abandon(invocation, error instanceof Error ? error.message : 'Arrêt impossible');
      return false;
    }
  }, [abandon, cameraRef]);

  const start = useCallback((): boolean => {
    const camera = cameraRef.current;
    if (!camera || !enabled || !ready.current || active.current) return false;
    const invocation: Invocation = {
      id: ++sequence.current, stopping: false, completed: false, abandoned: false,
      thumb: Promise.resolve(null), cap: null, finalize: null,
    };
    active.current = invocation;
    setIsRecording(true);
    try {
      camera.startRecording({
        fileType: 'mp4', videoCodec: 'h264', path: RECORDINGS_DIR,
        onRecordingFinished: (video: VideoFile) => {
          if (invocation.completed) {
            // A callback after timeout still owns its files, never the next invocation.
            invocation.thumb.then(thumb => deleteFiles([video.path, thumb]));
            return;
          }
          invocation.completed = true;
          // Capture A's thumbnail before the callback can synchronously start B.
          const thumb = invocation.thumb;
          settle(invocation);
          latest.current.onEncoderFree?.(invocation.id);
          Promise.all([fileSize(video.path), thumb]).then(([bytes, thumbPath]) => {
            latest.current.onClip({ recordingId: invocation.id, path: video.path,
              bytes, duration: video.duration, thumbPath });
          });
        },
        onRecordingError: error => abandon(invocation, error.message),
      });
    } catch (error) {
      settle(invocation);
      latest.current.onError?.(error instanceof Error ? error.message : 'Enregistrement impossible');
      return false;
    }
    latest.current.onStarted?.(invocation.id);
    latest.current.onRecovered?.();
    // Some native wrappers throw before returning a promise: thumbnails remain optional.
    try {
      const snapshot = camera.takeSnapshot({ quality: THUMBNAIL_QUALITY, path: RECORDINGS_DIR })
        .then(photo => photo.path).catch(() => null);
      invocation.thumb = boundedThumbnail(snapshot);
    } catch { invocation.thumb = Promise.resolve(null); }
    invocation.cap = setTimeout(() => {
      invocation.cap = null;
      latest.current.onMaxDuration?.();
      stop();
    }, maxDurationMs(max));
    return true;
  }, [abandon, cameraRef, enabled, max, settle, stop]);

  useEffect(() => { if (!enabled && active.current) stop(); }, [enabled, stop]);
  useEffect(() => () => {
    const invocation = active.current;
    if (!invocation) return;
    if (invocation.cap != null) clearTimeout(invocation.cap);
    if (invocation.finalize != null) clearTimeout(invocation.finalize);
    if (!invocation.stopping) {
      try { Promise.resolve(cameraRef.current?.stopRecording()).catch(() => {}); } catch { /* torn down */ }
    }
    active.current = null;
  }, [cameraRef]);

  const currentId = useCallback(() => active.current?.id ?? null, []);
  return { isRecording, start, stop, currentId };
}
