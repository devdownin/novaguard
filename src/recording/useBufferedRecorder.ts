import { useCallback, useEffect, useRef, useState } from 'react';
import { NativeEventEmitter, NativeModules } from 'react-native';
import { MaxDuration, Quality } from '../state/types';
import { maxDurationMs, qualityBitRate } from './library';
import { Clip, Recorder, RecorderOptions } from './useRecorder';

interface NativeRecorder {
  startCapture(audio: boolean, bitrate: number): Promise<void>;
  stopCapture(): Promise<void>;
  begin(id: number, fromAt: number, maxMs: number): Promise<void>;
  observe(id: number, untilAt: number): void;
  end(id: number, untilAt: number): Promise<void>;
  addListener(name: string): void;
  removeListeners(count: number): void;
}
interface NativeClip extends Clip { error?: string; encoderFree?: boolean; warning?: string }
// Native events can outlive a provider mount; identities are unique within the JS runtime.
let nextRecordingId = 0;

/** One continuous encoder; only confirmed-presence samples are muxed to disk. */
export function useBufferedRecorder(options: RecorderOptions & {
  audio: boolean; quality: Quality; max: MaxDuration;
}): Recorder {
  const [native] = useState<NativeRecorder | undefined>(() => NativeModules.PresenceRecorder);
  const latest = useRef(options);
  useEffect(() => { latest.current = options; });
  const inflight = useRef(new Set<number>());
  const revisions = useRef(new Map<number, number | undefined>());
  const active = useRef<{ id: number; stopping: boolean } | null>(null);
  const ready = useRef(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!native) return undefined;
    const subscription = new NativeEventEmitter(native).addListener('PresenceRecorderClip', (clip: NativeClip) => {
      const ownsRevision = revisions.current.get(clip.recordingId) === latest.current.retryKey;
      if (clip.encoderFree) {
        if (active.current?.id === clip.recordingId) {
          active.current = null;
          setIsRecording(false);
          if (clip.error && ownsRevision) latest.current.onError?.(clip.error);
          latest.current.onEncoderFree?.(clip.recordingId);
        } else if (ownsRevision && active.current == null && inflight.current.has(clip.recordingId) && clip.error) {
          latest.current.onError?.(clip.error);
        }
        return;
      }
      if (clip.error) {
        if (clip.recordingId === 0) { latest.current.onError?.(clip.error); return; }
        if (!inflight.current.delete(clip.recordingId)) return;
        revisions.current.delete(clip.recordingId);
        if (active.current?.id === clip.recordingId) {
          active.current = null;
          setIsRecording(false);
          if (ownsRevision) latest.current.onError?.(clip.error);
        } else if (active.current == null && ownsRevision) latest.current.onError?.(clip.error);
        latest.current.onAbandoned?.(clip.recordingId);
        return;
      }
      latest.current.onClip(clip);
      if (!clip.continued) {
        inflight.current.delete(clip.recordingId);
        revisions.current.delete(clip.recordingId);
      }
      if (!clip.continued && active.current?.id === clip.recordingId) {
        active.current = null;
        setIsRecording(false);
        latest.current.onEncoderFree?.(clip.recordingId);
      }
      if (clip.warning && active.current == null && ownsRevision) latest.current.onError?.(clip.warning);
    });
    return () => subscription.remove();
  }, [native]);

  useEffect(() => {
    let cancelled = false;
    ready.current = false;
    setIsReady(false);
    if (!options.enabled) {
      native?.stopCapture().catch(error => latest.current.onError?.(String(error)));
      return undefined;
    }
    if (!native) {
      latest.current.onError?.('Capture tamponnée indisponible : reconstruisez l’application Android');
      return undefined;
    }
    let retry: ReturnType<typeof setTimeout> | null = null;
    const prepare = () => {
      native.startCapture(options.audio, qualityBitRate(options.quality) * 1_000_000)
        .then(() => {
          if (!cancelled) { ready.current = true; setIsReady(true); latest.current.onRecovered?.(); }
        })
        .catch(error => {
          if (cancelled) return;
          latest.current.onError?.(String(error));
          retry = setTimeout(prepare, 1000);
        });
    };
    prepare();
    return () => {
      cancelled = true;
      ready.current = false;
      if (retry != null) clearTimeout(retry);
      native.stopCapture().catch(() => {});
    };
  }, [native, options.enabled, options.audio, options.quality, options.retryKey]);

  const start = useCallback((fromAt = Date.now()) => {
    if (!native || !latest.current.enabled || !ready.current || active.current) return false;
    const id = --nextRecordingId;
    active.current = { id, stopping: false };
    inflight.current.add(id);
    revisions.current.set(id, latest.current.retryKey);
    setIsRecording(true);
    latest.current.onStarted?.(id);
    native.begin(id, fromAt, maxDurationMs(latest.current.max)).then(() => {
      if (active.current?.id === id) latest.current.onRecovered?.();
    }).catch(error => {
      if (!inflight.current.delete(id)) return;
      revisions.current.delete(id);
      if (active.current?.id === id) {
        active.current = null;
        setIsRecording(false);
        latest.current.onError?.(String(error));
      }
      latest.current.onAbandoned?.(id);
    });
    return true;
  }, [native]);
  const stop = useCallback((untilAt = Date.now()) => {
    const invocation = active.current;
    if (!native || !invocation || invocation.stopping) return false;
    invocation.stopping = true;
    // Selection is closed immediately; finalisation belongs to this id, not the next presence.
    active.current = null;
    setIsRecording(false);
    native.end(invocation.id, untilAt).catch(error => {
      if (!inflight.current.delete(invocation.id)) return;
      const ownsRevision = revisions.current.get(invocation.id) === latest.current.retryKey;
      revisions.current.delete(invocation.id);
      if (active.current == null && ownsRevision) latest.current.onError?.(String(error));
      latest.current.onAbandoned?.(invocation.id);
    });
    return true;
  }, [native]);
  const observe = useCallback((untilAt: number) => {
    const invocation = active.current;
    if (invocation && !invocation.stopping) native?.observe(invocation.id, untilAt);
  }, [native]);
  const currentId = useCallback(() => active.current?.id ?? null, []);
  return { isRecording, isReady, start, stop, observe, currentId };
}
