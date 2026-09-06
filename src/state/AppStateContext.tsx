import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { Camera as VisionCamera } from 'react-native-vision-camera';
import { Camera as CameraModule, useCameraPermission, useMicrophonePermission } from 'react-native-vision-camera';
import {
  Camera, DetectionEvent, DetectionKind, DetectionZone, ExpandedSections, HistoryFilter, InfoPanel,
  MaxDuration, OnboardingStep, Period, PermissionOutcome, Permissions, PostRoll, Quality,
  Retention, Sensitivity, Settings, StorageInfo, Tab, VolumeSpace,
} from './types';
import {
  defaultDetToday, defaultEvents, defaultLastDetAt, defaultSettings,
} from './defaults';
import { dropStaleKeys, EMPTY_STORED_SIZE, storage, StoredSize } from './storage';
import { useForeground } from './useForeground';
import { useLatest } from '../utils/useLatest';
import { confirmTap } from '../utils/haptics';
import { FrameDetection } from '../ml/types';
import { confirmedTracksIfChanged, primaryTrack, Track, updateTracks } from '../ml/tracker';
import { SENSITIVITY_PROFILES, trackerOptionsFor } from '../ml/sensitivity';
import { detectionsInZone } from '../ml/zone';
import { Clip, useRecorder } from '../recording/useRecorder';
import {
  bytesToReclaim, clipFileName, clipOutcome, eventFiles, eventsToReclaim, expiredEvents, lowSpaceBytes,
  minFreeBytes, nextEventId, periodRange, postRollMs, sameDay, todayCount, totalBytes,
} from '../recording/library';
import {
  deleteFiles, orphanedRecordings, renameRecording, volumeSpace,
} from '../recording/videoStore';
import {
  dismissDetectionAlert, extractThumbnail, foregroundServiceError, hasNotificationPermission, notifyDetection,
  openAppSettings, openDetectionChannelSettings, requestNotificationPermission,
  startForegroundService, stopForegroundService,
} from '../surveillance/foregroundService';
import { alertContent, shouldAlert } from '../surveillance/alerts';
import { installFrameErrorGuard } from '../camera/frameErrorGuard';
import { FRAME_ERROR_PREFIX } from '../camera/frameErrors';
import {
  FrameStage, isCompleteFrame, isLaterStage, parseStage, stageDiagnosis,
} from '../camera/frameTrace';
import { countFrame, EMPTY_FRAME_RATE_WINDOW, FrameRateWindow } from '../camera/frameRate';
import {
  AutoTuneState, decisionChanged, IDLE_AUTO_TUNE, updateAutoTune,
} from '../camera/autoTune';
import { ClipGapStats, EMPTY_CLIP_GAP_STATS, recordGap } from '../recording/clipGap';
import { t } from '../i18n';

interface AppStateValue {
  hydrated: boolean;

  // navigation
  tab: Tab;
  setTab: (t: Tab) => void;

  // surveillance
  monitoring: boolean;
  /** What the current session is recording, or null. Survives the post-roll. */
  det: DetectionKind | null;
  detToday: number;
  /** When the last detection was committed, or null. Formatted at render. */
  lastDetAt: number | null;
  /** True only while a clip is actually being written to disk. */
  recording: boolean;
  /** Last recording failure, surfaced in the viewfinder instead of being swallowed. */
  recError: string | null;
  /**
   * Measured cost of a duration-cap cut, this session. Only a device can
   * answer this — see `clipGap.ts` — so the app measures itself.
   */
  clipGap: ClipGapStats;
  /**
   * What the app has given up on its own because the device is not analysing
   * as often as "Sensibilité" asked for — see `autoTune.ts`. Handed out as the
   * decision, not as the settings: `settings` stays what the user chose, and
   * the camera path merges the two through `tunedSettings`.
   */
  autoTune: AutoTuneState;
  storage: StorageInfo;
  /** Passed down to the Camera so the recorder can drive it. */
  cameraRef: React.RefObject<VisionCamera | null>;
  /**
   * False once the app is no longer on screen. Surveillance carries on; only
   * the work that exists to be looked at stops.
   */
  foreground: boolean;
  /** Camera runtime errors and model load failures, reported from CameraFeed. */
  reportCameraProblem: (message: string | null) => void;
  /** Called before each native call an analysed frame makes — see `frameTrace.ts`. */
  reportFrameStage: (stage: FrameStage) => void;
  toggleMonitoring: () => void;
  /** Called from the camera frame-processor (JS thread) with this frame's qualifying detections. */
  reportDetections: (detections: FrameDetection[], frameAspect: number) => void;

  // history
  events: DetectionEvent[];
  filter: HistoryFilter;
  setFilter: (f: HistoryFilter) => void;
  period: Period;
  setPeriod: (p: Period) => void;
  periodOpen: boolean;
  togglePeriodOpen: () => void;
  selected: number | null;
  /** The event `selected` names, resolved once for every consumer that needs it. */
  selectedEvent: DetectionEvent | null;
  selectEvent: (id: number | null) => void;

  // confirmations
  confirmDelete: boolean;
  askDelete: () => void;
  cancelDelete: () => void;
  doDelete: () => void;
  confirmWipe: boolean;
  askWipe: () => void;
  cancelWipe: () => void;
  doWipe: () => void;

  // setup
  settings: Settings;
  toggleSection: (key: keyof ExpandedSections) => void;
  cycleCamera: () => void;
  toggleResumeOnLaunch: () => void;
  toggleNight: () => void;
  togglePerson: () => void;
  toggleAnimal: () => void;
  toggleAutoZoom: () => void;
  toggleForceCpu: () => void;
  togglePreciseDetection: () => void;
  /**
   * True while the viewfinder is being used to draw the detection zone. The
   * camera runs and the auto-zoom does not, so what is drawn lands on an
   * untransformed preview — the only state in which view space and frame space
   * line up.
   */
  zoneEditing: boolean;
  beginZoneEdit: () => void;
  cancelZoneEdit: () => void;
  /** `null` clears the zone: the camera watches the whole frame again. */
  saveZone: (zone: DetectionZone | null) => void;
  setSensitivity: (s: Sensitivity) => void;
  setThreshold: (v: number) => void;
  cyclePost: () => void;
  cycleMax: () => void;
  cycleQuality: () => void;
  setRetention: (r: Retention) => void;
  toggleAutoDel: () => void;
  toggleNotif: () => void;
  toggleNotifDet: () => void;
  /** Sound and vibration live in Android's channel settings, not here. */
  openAlertSoundSettings: () => void;
  wipeAllVideos: () => void;

  // info panel (permissions / stored data)
  info: InfoPanel;
  /**
   * Bytes NovaGuard actually keeps in AsyncStorage, re-measured each time the
   * "Données stockées" panel opens. Zeroes until it has been.
   */
  storedSize: StoredSize;
  openInfo: (panel: Exclude<InfoPanel, null>) => void;
  closeInfo: () => void;

  // onboarding
  onb: OnboardingStep;
  perms: Permissions;
  onbNext: () => void;
  onbFinish: () => void;
  grantPermission: (key: keyof Permissions) => void;
}

/**
 * State that changes at the frame-processor rate, kept out of {@link AppStateValue}.
 *
 * Everything here is redrawn up to five times a second while surveillance runs.
 * Carrying it in the main context meant every consumer — the camera, the tab
 * bar, the sheets, the confirm dialogs — re-rendered at that rate, since a new
 * context value re-renders all of its consumers regardless of which field
 * changed. Only `DetectionOverlay` and `RecTimer` read any of it.
 */
export interface ViewfinderState {
  /** Every confirmed subject currently in frame, for the overlay. */
  tracks: Track[];
  /** Which of those tracks is driving the recording session. */
  primaryTrackId: number | null;
  /** Aspect ratio (w/h) of the uprighted camera frame, for mapping boxes onto the preview. */
  frameAspect: number;
  recSec: number;
  /**
   * Frames per second the camera is really being analysed at, averaged over
   * {@link FRAME_RATE_WINDOW_MS}. 0 until the first window closes.
   */
  frameRate: number;
}

/** The setters `reportDetections` drives, handed up by `ViewfinderProvider`. */
interface ViewfinderSink {
  setTracks: (update: (previous: Track[]) => Track[]) => void;
  setPrimaryTrackId: (id: number | null) => void;
  setFrameAspect: (aspect: number) => void;
  setRecSec: (seconds: number) => void;
  setFrameRate: (framesPerSecond: number) => void;
}

const AppStateCtx = createContext<AppStateValue | null>(null);
const ViewfinderCtx = createContext<ViewfinderState | null>(null);

/**
 * Owns the state that changes at the frame-processor rate.
 *
 * Splitting the context stopped every *consumer* re-rendering on a frame, but
 * the state itself still lived in `AppStateProvider`, so each detection
 * re-executed that 700-line body — forty `useCallback` dependency arrays and a
 * fifty-entry `useMemo` list, five times a second, to move one box. Holding it
 * here means a frame re-renders these twenty lines instead, and the parent's
 * `children` element is untouched so the app subtree below bails out.
 */
function ViewfinderProvider({
  sink, children,
}: { sink: React.RefObject<ViewfinderSink | null>; children: React.ReactNode }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [primaryTrackId, setPrimaryTrackId] = useState<number | null>(null);
  const [frameAspect, setFrameAspect] = useState(9 / 16);
  const [recSec, setRecSec] = useState(0);
  const [frameRate, setFrameRate] = useState(0);

  // `useState` setters are stable, so this is built once and the registration
  // never re-runs. Effects flush child-first, but a frame cannot be processed
  // before the camera below has mounted *and* the native session has delivered
  // one asynchronously — well after this commit — so the sink is always live by
  // the time `reportDetections` fires.
  const setters = useMemo<ViewfinderSink>(
    () => ({ setTracks, setPrimaryTrackId, setFrameAspect, setRecSec, setFrameRate }),
    [],
  );
  useEffect(() => {
    sink.current = setters;
    return () => { sink.current = null; };
  }, [setters, sink]);

  const value = useMemo<ViewfinderState>(
    () => ({ tracks, primaryTrackId, frameAspect, recSec, frameRate }),
    [tracks, primaryTrackId, frameAspect, recSec, frameRate],
  );

  return <ViewfinderCtx.Provider value={value}>{children}</ViewfinderCtx.Provider>;
}

function cycle<T>(options: readonly T[], current: T): T {
  const i = options.indexOf(current);
  return options[(i + 1) % options.length];
}

const CAMERA_OPTIONS: Camera[] = ['Arrière (1×)', 'Arrière (0,5×)', 'Avant'];
const POST_OPTIONS: PostRoll[] = ['5 s', '10 s', '30 s'];
const MAX_OPTIONS: MaxDuration[] = ['1 min', '2 min', '5 min', '10 min', '15 min'];
const QUALITY_OPTIONS: Quality[] = ['720p', '1080p', '4K'];

/**
 * How long surveillance has to keep running, *after its first frame*, before it
 * is worth resuming next launch.
 *
 * The countdown deliberately starts at the first frame rather than at the tap.
 * Everything fragile has to have already worked for a frame to arrive at all —
 * the foreground service, the camera session, the model, the frame-processor
 * worklet — and the clock used to start at hydration, which on a cold launch
 * spends its first 1.6 s behind the splash with no camera even mounted. A start
 * that never produces a frame now never asks to be repeated, which is the whole
 * point: `resumeOnLaunch` replaying a crash is what made this app unopenable.
 */
export const RESUME_ARM_MS = 8000;

/**
 * How often free space is re-measured, and auto-delete gets a chance to run.
 *
 * It used to ride the `events` array, so every detection cost a `getFSInfo`
 * round trip — a night of surveillance meant hundreds of them for a number
 * that only moves as clips are written. Reacting within half a minute is
 * enough: `MIN_FREE_BYTES` already refuses to open a recording on a volume
 * that is nearly full, so the disk cannot quietly overrun between sweeps.
 */
export const DISK_SWEEP_MS = 30_000;

/**
 * Prefixes of the viewfinder messages the camera owns, and may therefore clear
 * again when it recovers. Anything else there was put up by recording or by the
 * foreground service and is not the camera's to take down.
 */
const CAMERA_OWNED_ERROR = new RegExp(
  `^(${[t('error.prefix.camera'), t('error.prefix.model'), FRAME_ERROR_PREFIX].join('|')})`,
);

// Sessions now follow the tracker: one opens when a subject is *confirmed*
// (seen on consecutive frames) and closes when every track has been dropped,
// which is what stops a single lucky frame from writing a history event and
// stops a brief occlusion from splitting one passage into two.

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);

  const [tab, setTab] = useState<Tab>('cam');

  const [monitoring, setMonitoring] = useState(false);
  /** True once the camera has delivered a frame for the current session. */
  const [sawFrame, setSawFrame] = useState(false);
  const sawFrameRef = useRef(false);
  const [det, setDet] = useState<DetectionKind | null>(null);
  // Frame-rate state lives in `ViewfinderProvider` below; the provider reaches
  // its setters through this sink, so a detection never re-renders this body.
  const viewfinder = useRef<ViewfinderSink | null>(null);
  const [detToday, setDetToday] = useState(defaultDetToday);
  const [lastDetAt, setLastDetAt] = useState(defaultLastDetAt);
  const [recError, setRecError] = useState<string | null>(null);
  const [volume, setVolume] = useState<VolumeSpace>({ free: 0, total: 0 });
  /**
   * Asks the OS what is free and publishes it.
   *
   * Every path that deletes a clip owes a call to this **after** the unlink has
   * resolved: `getFSInfo` reports what the volume holds at the instant it is
   * asked, so measuring alongside a delete still in flight returns the space
   * the file is about to give back, and the figure on screen then sat wrong
   * until the next 30 s sweep happened to correct it.
   */
  const refreshVolume = useCallback(async () => setVolume(await volumeSpace()), []);
  /**
   * Surveillance runs with the screen off — that is the whole point of the
   * foreground service — so nothing about detection or recording reads this.
   * It gates only the work whose sole product is something on screen.
   */
  const foreground = useForeground();
  // Changes only at a cap boundary — minutes apart — so it costs the frame path
  // nothing to hold it in ordinary state.
  const [clipGap, setClipGap] = useState<ClipGapStats>(EMPTY_CLIP_GAP_STATS);
  /**
   * Published on decisions only. The fold behind it runs on every closed
   * frame-rate window — twice a second's worth of evidence — and this setter
   * re-renders the provider body, so `decisionChanged` is what keeps a
   * measurement from costing a render.
   */
  const [autoTune, setAutoTune] = useState<AutoTuneState>(IDLE_AUTO_TUNE);

  const [events, setEvents] = useState<DetectionEvent[]>(defaultEvents);
  const [filter, setFilter] = useState<HistoryFilter>('Toutes');
  const [period, setPeriod] = useState<Period>("Aujourd'hui");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const [settings, setSettings] = useState<Settings>(defaultSettings);

  const [info, setInfo] = useState<InfoPanel>(null);

  const [onb, setOnb] = useState<OnboardingStep>(null);
  const cameraPermission = useCameraPermission();
  const microphonePermission = useMicrophonePermission();
  // POST_NOTIFICATIONS has no vision-camera hook; it is read once and then
  // updated by grantPermission. Nothing else can change it while we run.
  const [notifGranted, setNotifGranted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    hasNotificationPermission().then(granted => {
      if (!cancelled) setNotifGranted(granted);
    });
    return () => { cancelled = true; };
  }, []);

  const perms: Permissions = useMemo(() => ({
    cam: cameraPermission.hasPermission,
    mic: microphonePermission.hasPermission,
    notif: notifGranted,
  }), [cameraPermission.hasPermission, microphonePermission.hasPermission, notifGranted]);

  // ── hydrate from disk ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [s, storedEvents, dt, ld, wasMonitoring, onboarded, lastStage] = await Promise.all([
        storage.loadSettings(),
        storage.loadEvents(),
        storage.loadDetToday(),
        storage.loadLastDetAt(),
        storage.loadMonitoring(),
        storage.loadOnboardingComplete(),
        storage.loadFrameStage(),
      ]);
      if (cancelled) return;
      // Merged over the defaults rather than used as-is: a settings object
      // written by an older version is missing every field added since, and
      // spreading it whole would leave those undefined.
      const restored = s ? { ...defaultSettings, ...s } : defaultSettings;
      setSettings(restored);
      const ev = storedEvents.value;
      if (ev) {
        setEvents(ev);
        lastEventIdRef.current = ev.reduce((max, e) => Math.max(max, e.id), 0);
      }
      // A history we could not read is not an empty history. Both the orphan
      // sweep below and the write-back effect would treat it as one — the
      // sweep deleting every clip on disk, the write-back replacing the stored
      // list with `[]` — so a single unreadable key would destroy every
      // recording the user has, silently, at launch. Hold both off instead,
      // and say so rather than showing an empty Historique with no explanation.
      eventsWritableRef.current = storedEvents.ok;
      if (!storedEvents.ok) setRecError(t('error.historyUnreadable'));
      // A stage left behind is a session that never finished a frame. The kind
      // of failure this catches — a segfault inside libyuv, LiteRT or ML Kit —
      // ends the process with nothing on screen and nothing in the log the user
      // can reach, so this is the only account of it they will ever get.
      else {
        const diagnosis = stageDiagnosis(parseStage(lastStage));
        if (diagnosis) setRecError(diagnosis);
      }
      setDetToday(todayCount(dt, Date.now()));
      if (typeof ld === 'number') setLastDetAt(ld);
      setOnb(onboarded ? null : 'intro');

      // Surveillance picks up where it left off. Gated on the camera permission
      // because a foreground service of type camera cannot be started without
      // it, and on onboarding being done so a first launch is never hijacked.
      // Read imperatively rather than through the hook's value: this effect
      // must run exactly once, and depending on the hook would re-run the whole
      // hydration every time the permission changed.
      const camGranted = CameraModule.getCameraPermissionStatus() === 'granted';
      if (onboarded && restored.resumeOnLaunch && wasMonitoring && camGranted) {
        setMonitoring(true);
      }
      setHydrated(true);

      // Clips left behind by a crash between the encoder closing a file and the
      // event being written would otherwise take up space nothing accounts for.
      if (storedEvents.ok) {
        // Both paths: the sweep deletes everything in the directory that no
        // event claims, and a still is in there next to its clip.
        const orphans = await orphanedRecordings(eventFiles(ev ?? []));
        if (orphans.length) await deleteFiles(orphans);
      }
      await dropStaleKeys();
    })();
    return () => { cancelled = true; };
  }, []);

  // ── persist on change (skip the initial hydration write) ───────────
  useEffect(() => { if (hydrated) storage.saveSettings(settings); }, [hydrated, settings]);
  /** False once a read failed, so nothing overwrites a history we cannot see. */
  const eventsWritableRef = useRef(true);
  useEffect(() => {
    if (hydrated && eventsWritableRef.current) storage.saveEvents(events);
  }, [hydrated, events]);
  useEffect(() => {
    if (hydrated) storage.saveDetToday({ count: detToday, day: Date.now() });
  }, [hydrated, detToday]);
  useEffect(() => { if (hydrated && lastDetAt != null) storage.saveLastDetAt(lastDetAt); }, [hydrated, lastDetAt]);
  /**
   * Remember that surveillance was on — but only once it has proved survivable.
   *
   * Writing it the instant the button is pressed turns any crash during startup
   * into a trap the user cannot get out of: the crash persists `true`, the next
   * launch auto-resumes because of it, and the app dies again before anyone can
   * reach the setting that would stop it. Arming the flag a few seconds in
   * means a start that fails never asks to be repeated, while a session that
   * ran fine and was cut short still comes back.
   */
  useEffect(() => {
    if (!hydrated) return undefined;
    if (!monitoring) {
      storage.saveMonitoring(false);
      return undefined;
    }
    // Nothing to arm until the camera has actually produced a frame.
    if (!sawFrame) return undefined;
    const arm = setTimeout(() => storage.saveMonitoring(true), RESUME_ARM_MS);
    return () => clearTimeout(arm);
  }, [hydrated, monitoring, sawFrame]);

  // ── midnight rollover ───────────────────────────────────────────────
  // The displayed clock is not state here: it changes every second and only one
  // Text renders it, so `LiveClock` owns its own tick. This effect keeps only
  // the part that is app state — rolling the daily counter over for a session
  // left running overnight, which hydration alone would catch a launch too late.
  const dayRef = useRef(Date.now());
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      if (!sameDay(dayRef.current, now)) {
        dayRef.current = now;
        setDetToday(0);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // ── recording ────────────────────────────────────────────────────────
  const cameraRef = useRef<VisionCamera | null>(null);

  // Active-session bookkeeping. Refs (not state) because reportDetections
  // fires many times a second and only some updates should trigger a render.
  const sessionKindRef = useRef<DetectionKind | null>(null);
  const sessionStartRef = useRef(0);
  /**
   * When the *current clip* began, as opposed to the passage.
   *
   * The duration cap ends a file without ending the session, so the two drift
   * apart: the on-screen counter follows the passage, while the event written
   * for each clip describes only that clip.
   */
  const segmentStartRef = useRef(0);
  const sessionMaxConfRef = useRef(0);
  const tracksRef = useRef<Track[]>([]);
  /**
   * Set while a stop is in flight, so the arriving clip knows what it belongs to.
   *
   * `rollover` says the stop came from the duration cap with the subject still
   * in frame: the clip is filed as its own event, but the passage is not over,
   * so the session survives it and the next clip opens as soon as this one is
   * filed.
   */
  const pendingRef = useRef<
    { kind: DetectionKind; dur: number; conf: number; rollover: boolean } | null
  >(null);
  /** Post-roll: keep rolling for a moment after the last subject leaves. */
  const postRollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the last detection alert went out, for the cooldown. */
  const lastAlertRef = useRef<number | null>(null);
  /** Rolling count behind the measured frame rate. */
  const frameWindowRef = useRef<FrameRateWindow>({ ...EMPTY_FRAME_RATE_WINDOW });
  /** The self-tuning state the frame path folds into; `autoTune` is its published half. */
  const autoTuneRef = useRef<AutoTuneState>(IDLE_AUTO_TUNE);
  /**
   * Last event id minted. Owned here rather than derived from `events[0]`,
   * which would only be the highest id while the list happens to be sorted
   * newest-first — an invariant nothing enforces, least of all the bare
   * `JSON.parse` that restores it from disk.
   */
  const lastEventIdRef = useRef(0);
  // Everything `reportDetections` reads that changes while it runs goes through
  // a ref, so its identity — and the frame processor worklet's — survives. Free
  // space comes from the measurement, not from `store`, which folds in a value
  // derived from `events` that this path has no use for. Declared up here
  // because the recording callbacks below read them too.
  const freeSpaceRef = useLatest(volume.free);
  const settingsRef = useLatest(settings);
  // Through a ref like everything else the frame path reads: taking it as a
  // dependency would rebuild the worklet every time the app is backgrounded.
  const foregroundRef = useLatest(foreground);
  // Declared here rather than beside its own callbacks, because the frame path
  // below reads it and has to be defined after everything it touches.
  const [zoneEditing, setZoneEditing] = useState(false);
  const zoneEditingRef = useLatest(zoneEditing);
  /**
   * The recorder's own `start` and `stop`, reached through refs.
   *
   * The recorder takes `onClip` and the cap hook as options, so it is built
   * below the callbacks that need to drive it back — one of the two directions
   * has to be indirect.
   */
  const startRecordingRef = useRef<() => boolean>(() => false);
  const stopRecordingRef = useRef<() => boolean>(() => false);
  /** When the cap issued its stop, so the gap that follows can be measured. */
  const cutAtRef = useRef<number | null>(null);

  /**
   * Whether the volume can hold the clip that is about to be written.
   *
   * Both the opening of a session and the roll into the next clip ask this, and
   * they must ask the same question: a passage that outlives its cap used to
   * re-check space only because the session was rebuilt at every cut, so making
   * the session survive the cut quietly removed the check from long passages.
   * A free space of 0 means "not measured yet", not "full".
   */
  const hasRoomToRecord = useCallback(() => {
    const free = freeSpaceRef.current;
    if (free <= 0) return true;
    return free >= minFreeBytes(settingsRef.current.quality, settingsRef.current.max);
  }, [freeSpaceRef, settingsRef]);

  const commitEvent = useCallback((
    kind: DetectionKind, dur: number, c: number, clip: Clip | null, at: number = Date.now(),
  ) => {
    const now = at;
    setDetToday(v => v + 1);
    setLastDetAt(now);
    // Minted outside the updater: React may invoke an updater twice, and an id
    // that advanced on each invocation would not be the one that got committed.
    const id = nextEventId(lastEventIdRef.current, now);
    lastEventIdRef.current = id;
    setEvents(evs => [
      {
        id,
        kind,
        timestamp: now,
        // Prefer the encoder's own duration: it counts what is actually in the
        // file, including the post-roll, which our session timer does not.
        dur: clip && clip.duration > 0 ? Math.round(clip.duration) : dur,
        conf: c,
        path: clip ? clip.path : null,
        bytes: clip ? clip.bytes : 0,
        thumbPath: clip ? clip.thumbPath : null,
      },
      ...evs,
    ]);
    return id;
  }, []);

  /**
   * Puts a still on an event that was filed without one.
   *
   * Separate from `commitEvent` because it lands later and may not land at all:
   * the event is the record, the picture is what makes the list usable.
   */
  const attachThumbnail = useCallback((id: number, thumbPath: string) => {
    setEvents(evs => {
      // The event may be gone — deleted, or reclaimed by the retention sweep,
      // while the frame was being decoded. `map` could not revive it either
      // way; what this avoids is the *new array*, which is a re-render of the
      // history and a rewrite of the whole journal to AsyncStorage for a change
      // that did not happen. The still it belonged to is left to the next disk
      // sweep, which is what reclaims a file no event claims.
      if (!evs.some(e => e.id === id)) return evs;
      return evs.map(e => (e.id === id ? { ...e, thumbPath } : e));
    });
  }, []);

  const clearSession = useCallback(() => {
    sessionKindRef.current = null;
    setDet(null);
    viewfinder.current?.setRecSec(0);
  }, []);

  /** Describes the clip being closed, not the passage that may outlive it. */
  const sessionMeta = useCallback(() => ({
    kind: sessionKindRef.current as DetectionKind,
    dur: Math.max(1, Math.round((Date.now() - segmentStartRef.current) / 1000)),
    conf: Math.round(sessionMaxConfRef.current * 100),
  }), []);

  /**
   * Opens the next clip of a passage the duration cap has just cut.
   *
   * A refused start is the one case that must not be swallowed: the session
   * would stay open with nothing being written, and `reportDetections` only
   * starts a recording when it *opens* a session — so the rest of the passage
   * would go to disk nowhere. Closing the session instead hands the next frame
   * a clean slate to reopen from.
   */
  const openNextSegment = useCallback((): boolean => {
    // A long passage fills the disk like any other write. Closing the session
    // hands the next frame back to the ordinary opening path, which is the one
    // place that decides what a refusal looks like.
    if (!hasRoomToRecord()) {
      setRecError('Espace insuffisant pour enregistrer');
      clearSession();
      return false;
    }
    if (startRecordingRef.current()) return true;
    clearSession();
    return false;
  }, [clearSession, hasRoomToRecord]);

  /**
   * Files the finished clip against the detection that caused it, under a name
   * that says which and when.
   *
   * Every clip must end up either attached to an event or deleted. A recording
   * nothing refers to is a video of an empty room taking up a user's storage,
   * invisible in the app and only swept away at the next launch — this used to
   * be the silent third outcome here.
   */
  const onClip = useCallback((clip: Clip) => {
    const pending = pendingRef.current;
    pendingRef.current = null;

    const meta = pending ?? (sessionKindRef.current != null ? sessionMeta() : null);

    switch (clipOutcome(meta != null, clip.bytes)) {
      case 'discard':
        // A stop that raced the session ending, or the component going away
        // mid-clip. Nothing will ever point at these files.
        deleteFiles([clip.path, clip.thumbPath]);
        return;

      case 'event-only':
        // The encoder produced an empty file. Keep the sighting, drop the husk:
        // an unplayable 0-byte row in the history is worse than none.
        if (!pending) clearSession();
        deleteFiles([clip.path, clip.thumbPath]);
        commitEvent(meta!.kind, meta!.dur, meta!.conf, null);
        return;

      case 'attach': {
        if (!pending) clearSession();
        const at = Date.now();
        renameRecording(clip.path, clipFileName(meta!.kind, at)).then(path => {
          const id = commitEvent(meta!.kind, meta!.dur, meta!.conf, { ...clip, path }, at);
          // The snapshot taken as the clip opened is the better picture — it is
          // the frame that says why the clip exists — but it needs a preview to
          // screenshot, and there is none with the screen off. That is most of
          // what a surveillance phone does, so those clips fall back to reading
          // the file, which does not care what the screen was doing.
          //
          // Deliberately after the rename and deliberately not awaited: the
          // still is written beside the clip's *final* path, so `eventFiles`
          // deletes the pair by name, and an event never waits on a decode.
          if (clip.thumbPath == null) {
            extractThumbnail(path).then(thumb => { if (thumb) attachThumbnail(id, thumb); });
          }
        });
      }
    }
  }, [attachThumbnail, clearSession, commitEvent, sessionMeta]);

  /**
   * The encoder has released the camera. If the cap cut this clip with the
   * subject still in frame, the next one opens here — before the byte count is
   * read back, which is a bridge round trip nobody is being filmed during.
   */
  const onEncoderFree = useCallback(() => {
    const pending = pendingRef.current;
    const cutAt = cutAtRef.current;
    cutAtRef.current = null;
    if (!(pending?.rollover && sessionKindRef.current != null)) return;

    // Both readings are taken around the call itself, so nothing between them
    // is anything but the work being measured.
    const freeAt = Date.now();
    const opened = openNextSegment();
    if (cutAt == null || !opened) return;
    setClipGap(previous => recordGap(previous, {
      finalizeMs: freeAt - cutAt,
      restartMs: Date.now() - freeAt,
    }));
  }, [openNextSegment]);

  /**
   * The clip a stop was waiting on never arrived — the encoder did not answer
   * within `FINALIZE_TIMEOUT_MS`. Nothing else will write the event that clip
   * was carrying, and if the passage is still running it now has no recording.
   */
  const onClipAbandoned = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    if (pending.rollover && sessionKindRef.current != null) openNextSegment();
    commitEvent(pending.kind, pending.dur, pending.conf, null);
  }, [commitEvent, openNextSegment]);

  /**
   * The duration cap has expired with the subject still in frame.
   *
   * A clip has to end — the cap is what keeps a passage from becoming one
   * unbounded file — but the passage has not. Closing the clip *here*, rather
   * than letting the recorder stop behind the session's back, is what makes the
   * difference: the clip leaves with the metadata of the segment it holds, the
   * session keeps its kind, its start time and its alert cooldown, and `onClip`
   * opens the next clip the moment this one is filed. Left to the recorder, the
   * session was instead torn down and rebuilt from the next frame — which reset
   * the on-screen counter, dropped the detection badge, re-fired the
   * notification, and, if the subject happened to leave during finalisation,
   * discarded the clip as unclaimed.
   */
  const rollSegment = useCallback(() => {
    if (sessionKindRef.current == null) return;
    const meta = sessionMeta();
    // Nothing was actually being written (no permission, disk full): there is no
    // clip to close, so there is nothing to roll over to either.
    const cutAt = Date.now();
    if (!stopRecordingRef.current()) return;
    cutAtRef.current = cutAt;
    pendingRef.current = { ...meta, rollover: true };
    // The next clip's window starts now. Confidence restarts from whatever is in
    // frame at this instant so each event describes its own clip.
    const primary = primaryTrack(tracksRef.current);
    segmentStartRef.current = Date.now();
    sessionMaxConfRef.current = primary ? primary.maxConfidence : 0;
  }, [sessionMeta]);

  const recorder = useRecorder({
    cameraRef,
    enabled: monitoring && perms.cam,
    max: settings.max,
    onClip,
    onError: setRecError,
    onMaxDuration: rollSegment,
    onAbandoned: onClipAbandoned,
    onEncoderFree,
  });
  // Depend on the two callbacks rather than the recorder object: it is a fresh
  // literal every render, and `reportDetections` feeds the frame processor's
  // dependency list — an identity that churned every render would rebuild the
  // worklet several times a second.
  const { isRecording, start: startRecording, stop: stopRecording } = recorder;
  // Written on commit rather than during render: no clip can land, and no cap
  // can expire, before the recorder has been started — which needs a commit.
  useEffect(() => { startRecordingRef.current = startRecording; }, [startRecording]);
  useEffect(() => { stopRecordingRef.current = stopRecording; }, [stopRecording]);

  const cancelPostRoll = useCallback(() => {
    if (postRollRef.current) {
      clearTimeout(postRollRef.current);
      postRollRef.current = null;
    }
  }, []);

  /** Ends the session now, without waiting out the post-roll. */
  const endSession = useCallback(() => {
    if (sessionKindRef.current == null) return;
    cancelPostRoll();
    const meta = sessionMeta();
    clearSession();

    // A cap-driven cut may still be in flight. Its clip already carries an
    // event, so all this has to do is cancel the continuation — stopping again
    // would answer false and mint a second, file-less event for a segment that
    // recorded nothing, while the real clip landed to a closed session and was
    // deleted as unclaimed.
    if (pendingRef.current) {
      pendingRef.current = { ...pendingRef.current, rollover: false };
      return;
    }

    if (stopRecording()) {
      pendingRef.current = { ...meta, rollover: false };   // the clip carries the event
    } else {
      // Nothing was recording (no permission, disk full, camera gone). The
      // sighting still happened, so keep it — just without a file.
      commitEvent(meta.kind, meta.dur, meta.conf, null);
    }
  }, [cancelPostRoll, clearSession, commitEvent, sessionMeta, stopRecording]);

  const reportDetections = useCallback((detections: FrameDetection[], aspect: number) => {
    const now = Date.now();
    /**
     * The viewfinder's state, or nothing when it cannot be seen.
     *
     * Every setter below feeds an overlay, a counter or a chip — display and
     * nothing else. Pushing them from the background re-rendered
     * `ViewfinderProvider` up to five times a second to move a box on a screen
     * that is off. The tracking, the session and the recording below are
     * deliberately *not* behind this: an energy saving that costs a detection
     * is not a saving.
     */
    const shown = foregroundRef.current ? viewfinder.current : null;
    // Set before anything else can return: the zone editor draws against this
    // aspect, and analysing a frame is the only way to learn it.
    shown?.setFrameAspect(aspect);
    // The camera also runs while the zone is being drawn, and none of what it
    // sees then is surveillance — tracking it would open a session, and with it
    // a recording, on a screen whose buttons say "Annuler".
    if (zoneEditingRef.current) return;
    // Through a ref so this stays a once-per-session write: `setSawFrame` is a
    // stable setter, so arming the resume flag costs the frame path nothing and
    // leaves this callback's identity — and the worklet's — untouched.
    if (!sawFrameRef.current) {
      sawFrameRef.current = true;
      setSawFrame(true);
    }
    // What "Sensibilité" asked for is a target; this is what the device manages.
    const measured = countFrame(frameWindowRef.current, now);
    if (measured != null) {
      shown?.setFrameRate(measured);
      // Outside the `shown` guard on purpose: the preview is off with the
      // screen, which is most of a surveillance phone's life, and that is
      // exactly when a device falling behind matters most.
      const previous = autoTuneRef.current;
      const tuned = updateAutoTune(
        previous,
        { measured, target: SENSITIVITY_PROFILES[settingsRef.current.sens].fps },
        settingsRef.current,
      );
      if (tuned !== previous) {
        autoTuneRef.current = tuned;
        if (decisionChanged(previous, tuned)) setAutoTune(tuned);
      }
    }

    // The user's threshold is the tracker's entry gate, not the detector's
    // filter: `interpretDetections` now hands over everything above a low floor
    // so a track already open can survive the weak looks a real subject produces
    // when they turn away or step into shadow. Read through the ref like every
    // other setting on this path — a dependency here would rebuild the worklet.
    // The zone comes first: a detection outside it is not a subject, so it
    // must not open a track, keep one alive, or hold off a post-roll.
    const watched = detectionsInZone(detections, settingsRef.current.zone);
    const next = updateTracks(tracksRef.current, watched, now,
      trackerOptionsFor(settingsRef.current.sens, settingsRef.current.threshold));
    tracksRef.current = next;
    // Keep the previous array when nothing moved: every other setter here
    // already bails on `Object.is`, so this is what makes a still scene free.
    shown?.setTracks(prev => confirmedTracksIfChanged(prev, next));

    const primary = primaryTrack(next);
    shown?.setPrimaryTrackId(primary ? primary.id : null);

    if (primary) {
      cancelPostRoll();
      if (sessionKindRef.current == null) {
        sessionKindRef.current = primary.kind;
        sessionStartRef.current = now;
        segmentStartRef.current = now;
        sessionMaxConfRef.current = primary.maxConfidence;
        shown?.setRecSec(0);
        // Refuse to start on a nearly full volume rather than letting the
        // encoder fail mid-clip and lose the whole passage.
        if (!hasRoomToRecord()) {
          setRecError('Espace insuffisant pour enregistrer');
        } else {
          setRecError(null);
          startRecording();
        }

        // Alert on the *opening* of a session, not on the event written when it
        // closes: the point of a surveillance alert is that someone is there
        // now, not that someone was there for the last thirty seconds.
        if (shouldAlert(settingsRef.current, lastAlertRef.current, now)) {
          lastAlertRef.current = now;
          const { title, body } = alertContent(primary.kind, now);
          notifyDetection(title, body);
        }
      } else {
        sessionMaxConfRef.current = Math.max(sessionMaxConfRef.current, primary.maxConfidence);
        shown?.setRecSec(Math.floor((now - sessionStartRef.current) / 1000));
      }
      setDet(primary.kind);
      return;
    }

    // No confirmed subject left in frame. The tracker has already given each one
    // its grace period; the post-roll now keeps the camera rolling a little
    // longer so the clip doesn't cut the moment someone steps out of frame.
    if (sessionKindRef.current != null && postRollRef.current == null) {
      postRollRef.current = setTimeout(() => {
        postRollRef.current = null;
        endSession();
      }, postRollMs(settingsRef.current.post));
    }
  }, [cancelPostRoll, endSession, foregroundRef, hasRoomToRecord, settingsRef, startRecording, zoneEditingRef]);

  const toggleMonitoring = useCallback(() => {
    // Felt, not just seen: this is the action a phone is propped up and left
    // for, and the one most often taken without looking at the screen. Fired
    // here rather than in the button so it follows the action itself — the
    // permission path below can end without any state change, and a tick that
    // said "started" there would be a lie.
    confirmTap();
    // Closing the session has to happen outside the updater: React may invoke
    // an updater twice, which would commit the same event — and its clip — twice.
    if (monitoring) {
      endSession();
      tracksRef.current = [];
      viewfinder.current?.setTracks(() => []);
      sawFrameRef.current = false;
      setSawFrame(false);
      frameWindowRef.current = { ...EMPTY_FRAME_RATE_WINDOW };
      viewfinder.current?.setFrameRate(0);
      // The verdict belongs to a session: what a phone can hold up depends on
      // the format it is recording, how warm it already is and what else is
      // running. Carrying a step over would keep a capability off long after
      // the reason for taking it away is gone.
      autoTuneRef.current = IDLE_AUTO_TUNE;
      setAutoTune(IDLE_AUTO_TUNE);
      setMonitoring(false);
      return;
    }

    // Starting without the camera permission used to take the whole app down:
    // the foreground service claims the `camera` type, Android requires the
    // permission to be held at that moment, and the resulting SecurityException
    // is thrown inside the service — nowhere a caller can catch it. Ask instead.
    if (!cameraPermission.hasPermission) {
      setRecError(t('error.grantCamera'));
      cameraPermission.requestPermission().then(granted => {
        // Carry on rather than making the user find the button again.
        if (granted) {
          setRecError(null);
          setMonitoring(true);
        }
      });
      return;
    }
    setRecError(null);
    setMonitoring(true);
  }, [cameraPermission, endSession, monitoring]);

  useEffect(() => cancelPostRoll, [cancelPostRoll]);

  // The foreground service is what lets the camera keep running once the app
  // leaves the screen; without it Android cuts capture and may kill the process.
  useEffect(() => {
    if (monitoring) {
      startForegroundService();
      // The service starts on its own stack, so a refusal cannot come back as a
      // thrown error here. Read it back a moment later and say so, rather than
      // leaving surveillance looking active while Android has shut it down.
      const check = setTimeout(() => {
        const reason = foregroundServiceError();
        if (reason) setRecError(`Surveillance en arrière-plan refusée : ${reason}`);
      }, 1200);
      return () => clearTimeout(check);
    }
    stopForegroundService();
    // A "person detected" alert left standing after surveillance is off says
    // something that is no longer true.
    dismissDetectionAlert();
    lastAlertRef.current = null;
  }, [monitoring]);

  // Leaving a "surveillance active" notification behind after the process is
  // gone would be worse than not showing one at all.
  useEffect(() => stopForegroundService, []);

  // ── retention ────────────────────────────────────────────────────────
  // Rides the library, because deciding what has expired is pure arithmetic.
  // Pruning `events` re-runs this until there is nothing left to drop.
  useEffect(() => {
    if (!hydrated) return undefined;
    const expired = expiredEvents(events, settings.retention, Date.now());
    if (!expired.length) return undefined;

    let cancelled = false;
    const ids = new Set(expired.map(e => e.id));
    deleteFiles(eventFiles(expired)).then(() => {
      if (cancelled) return;
      setEvents(evs => evs.filter(e => !ids.has(e.id)));
      refreshVolume();
    });
    return () => { cancelled = true; };
  }, [hydrated, events, settings.retention, refreshVolume]);

  // ── disk pressure ────────────────────────────────────────────────────
  // On its own cadence rather than the library's: measuring costs a native
  // call, and reclaiming is not something a single new clip can make urgent.
  const eventsRef = useLatest(events);
  const sweepDisk = useCallback(async () => {
    const space = await volumeSpace();
    setVolume(space);

    if (!settingsRef.current.autoDel || space.free <= 0) return;
    const needed = bytesToReclaim(
      space.free,
      lowSpaceBytes(settingsRef.current.quality, settingsRef.current.max),
    );
    if (needed <= 0) return;

    const victims = eventsToReclaim(eventsRef.current, needed);
    if (!victims.length) return;
    const ids = new Set(victims.map(e => e.id));
    await deleteFiles(eventFiles(victims));
    setEvents(evs => evs.filter(e => !ids.has(e.id)));
    // Re-measure rather than assume: the next sweep must decide against what
    // the volume actually reports, or it would keep reclaiming against a
    // free-space figure the deletions have already made stale.
    await refreshVolume();
  }, [eventsRef, refreshVolume, settingsRef]);

  useEffect(() => {
    if (!hydrated) return undefined;
    sweepDisk();
    const iv = setInterval(sweepDisk, DISK_SWEEP_MS);
    return () => clearInterval(iv);
  }, [hydrated, sweepDisk]);

  const store = useMemo<StorageInfo>(
    () => ({ ...volume, used: totalBytes(events) }),
    [events, volume],
  );

  // ── history ──────────────────────────────────────────────────────────
  const togglePeriodOpen = useCallback(() => setPeriodOpen(v => !v), []);
  const selectEvent = useCallback((id: number | null) => setSelected(id), []);

  const askDelete = useCallback(() => setConfirmDelete(true), []);
  const cancelDelete = useCallback(() => setConfirmDelete(false), []);
  const selectedEvent = useMemo(
    () => events.find(e => e.id === selected) ?? null,
    [events, selected],
  );
  const doDelete = useCallback(() => {
    const files = selectedEvent ? eventFiles([selectedEvent]) : [];
    setEvents(evs => evs.filter(e => e.id !== selected));
    setSelected(null);
    setConfirmDelete(false);
    // Chained, not fired alongside: the sweep measures the volume, and it used
    // to do so while this very unlink was still in flight — so "Espace" kept
    // showing the deleted clip's bytes as taken until the periodic sweep, up to
    // 30 s later. `doWipe` below already did it this way.
    deleteFiles(files).then(sweepDisk);
  }, [selected, selectedEvent, sweepDisk]);

  const askWipe = useCallback(() => setConfirmWipe(true), []);
  const cancelWipe = useCallback(() => setConfirmWipe(false), []);
  const doWipe = useCallback(() => {
    deleteFiles(eventFiles(events)).then(sweepDisk);
    setEvents([]);
    setConfirmWipe(false);
  }, [events, sweepDisk]);
  const wipeAllVideos = askWipe;

  // ── setup ────────────────────────────────────────────────────────────
  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(s => ({ ...s, ...patch }));
  }, []);

  const toggleSection = useCallback((key: keyof ExpandedSections) => {
    setSettings(s => ({ ...s, exp: { ...s.exp, [key]: !s.exp[key] } }));
  }, []);

  const cycleCamera = useCallback(() => patchSettings({ camera: cycle(CAMERA_OPTIONS, settings.camera) }), [patchSettings, settings.camera]);
  const cyclePost = useCallback(() => patchSettings({ post: cycle(POST_OPTIONS, settings.post) }), [patchSettings, settings.post]);
  const cycleMax = useCallback(() => patchSettings({ max: cycle(MAX_OPTIONS, settings.max) }), [patchSettings, settings.max]);
  const cycleQuality = useCallback(() => patchSettings({ quality: cycle(QUALITY_OPTIONS, settings.quality) }), [patchSettings, settings.quality]);

  const toggleResumeOnLaunch = useCallback(
    () => patchSettings({ resumeOnLaunch: !settings.resumeOnLaunch }),
    [patchSettings, settings.resumeOnLaunch],
  );
  const toggleNight = useCallback(() => patchSettings({ night: !settings.night }), [patchSettings, settings.night]);
  const togglePerson = useCallback(() => patchSettings({ person: !settings.person }), [patchSettings, settings.person]);
  const toggleAnimal = useCallback(() => patchSettings({ animal: !settings.animal }), [patchSettings, settings.animal]);
  const toggleAutoZoom = useCallback(() => patchSettings({ autoZoom: !settings.autoZoom }), [patchSettings, settings.autoZoom]);
  const toggleForceCpu = useCallback(() => patchSettings({ forceCpu: !settings.forceCpu }), [patchSettings, settings.forceCpu]);
  const toggleAutoDel = useCallback(() => patchSettings({ autoDel: !settings.autoDel }), [patchSettings, settings.autoDel]);
  const toggleNotif = useCallback(() => patchSettings({ notif: !settings.notif }), [patchSettings, settings.notif]);
  const toggleNotifDet = useCallback(() => patchSettings({ notifDet: !settings.notifDet }), [patchSettings, settings.notifDet]);
  const openAlertSoundSettings = useCallback(() => openDetectionChannelSettings(), []);

  /** The furthest stage this session has entered. */
  const frameStageRef = useRef<FrameStage | null>(null);
  /**
   * Records the call the analysis is about to make, keeping the furthest one.
   *
   * The worklet reports every stage of every frame — five frames a second, for
   * as long as surveillance runs — so this is on the hot path and does almost
   * nothing after the first complete frame: the last stage is also the furthest
   * one, so once it is reached nothing compares later and every call stops on
   * the second line. Walking back would be worse than noise; a crash in
   * inference would be blamed on the next frame's resize.
   */
  const reportFrameStage = useCallback((stage: FrameStage) => {
    if (!isLaterStage(stage, frameStageRef.current)) return;
    frameStageRef.current = stage;

    if (isCompleteFrame(stage)) {
      // A frame made it end to end. Whatever the last session died in, this one
      // has just proved survivable — so drop the record, and take the diagnosis
      // down through the same ownership check a camera error clears by, which
      // leaves a recording or foreground-service message alone.
      storage.clearFrameStage();
      setRecError(prev => (prev && CAMERA_OWNED_ERROR.test(prev) ? null : prev));
      return;
    }
    storage.saveFrameStage(stage);
  }, []);

  const reportCameraProblem = useCallback((message: string | null) => {
    // Only clears what it set: a camera that recovers must not wipe an unrelated
    // recording or foreground-service message.
    setRecError(prev => (message ?? (prev && CAMERA_OWNED_ERROR.test(prev) ? null : prev)));
  }, []);

  // A frame-processor error that escapes the worklet's own `try` — a closure the
  // runtime refuses to copy, say — still reaches React Native's fatal reporter
  // and closes the app. Downgrade exactly those; everything else keeps crashing.
  useEffect(() => installFrameErrorGuard(reportCameraProblem), [reportCameraProblem]);

  const togglePreciseDetection = useCallback(
    () => patchSettings({ preciseDetection: !settingsRef.current.preciseDetection }),
    [patchSettings, settingsRef],
  );

  // Drawing happens on the viewfinder, so the camera tab has to be the one on
  // screen — the row that starts this lives in Setup.
  const beginZoneEdit = useCallback(() => { setTab('cam'); setZoneEditing(true); }, []);
  const cancelZoneEdit = useCallback(() => setZoneEditing(false), []);
  const saveZone = useCallback((zone: DetectionZone | null) => {
    setZoneEditing(false);
    patchSettings({ zone });
  }, [patchSettings]);

  // Leaving the camera tab abandons the drawing: the editor is off screen, and
  // the camera would otherwise be left running for it.
  useEffect(() => {
    if (tab !== 'cam') setZoneEditing(false);
  }, [tab]);

  const setSensitivity = useCallback((s: Sensitivity) => patchSettings({ sens: s }), [patchSettings]);
  const setThreshold = useCallback((v: number) => patchSettings({ threshold: v }), [patchSettings]);
  const setRetention = useCallback((r: Retention) => patchSettings({ retention: r }), [patchSettings]);

  // ── info panel ───────────────────────────────────────────────────────
  const [storedSize, setStoredSize] = useState<StoredSize>(EMPTY_STORED_SIZE);
  const openInfo = useCallback((panel: Exclude<InfoPanel, null>) => {
    setInfo(panel);
    // On opening rather than on a timer: it is read once, by someone who just
    // asked, and reading every key has no business on any hot path.
    if (panel === 'data') storage.measure().then(setStoredSize);
  }, []);
  const closeInfo = useCallback(() => setInfo(null), []);

  // ── onboarding ───────────────────────────────────────────────────────
  const onbNext = useCallback(() => setOnb('perms'), []);
  const onbFinish = useCallback(() => {
    setOnb(null);
    storage.saveOnboardingComplete(true);
  }, []);
  /**
   * Asks the OS for one permission, and falls back to settings when it won't ask.
   *
   * Android stops showing the dialog once a permission has been refused for
   * good: the request then resolves having displayed nothing, so a button
   * wired straight to it looks broken. `blocked` is that case, and the only
   * way back from it is the app's own settings page.
   *
   * VisionCamera answers its two requests with a bare boolean, so the status
   * is read back afterwards to tell a refusal from a refusal that sticks.
   */
  const grantPermission = useCallback(async (key: keyof Permissions) => {
    let outcome: PermissionOutcome;

    if (key === 'cam') {
      outcome = await cameraPermission.requestPermission()
        ? 'granted'
        : CameraModule.getCameraPermissionStatus() === 'denied' ? 'blocked' : 'denied';
    } else if (key === 'mic') {
      outcome = await microphonePermission.requestPermission()
        ? 'granted'
        : CameraModule.getMicrophonePermissionStatus() === 'denied' ? 'blocked' : 'denied';
    } else {
      outcome = await requestNotificationPermission();
      setNotifGranted(outcome === 'granted');
    }

    if (outcome === 'blocked') openAppSettings();
  }, [cameraPermission, microphonePermission]);

  const value = useMemo<AppStateValue>(() => ({
    hydrated,
    tab, setTab,
    monitoring, det, detToday, lastDetAt,
    recording: isRecording, recError, clipGap, autoTune, storage: store, cameraRef, foreground, reportCameraProblem, reportFrameStage,
    toggleMonitoring, reportDetections,
    events, filter, setFilter, period, setPeriod, periodOpen, togglePeriodOpen, selected, selectedEvent, selectEvent,
    confirmDelete, askDelete, cancelDelete, doDelete,
    confirmWipe, askWipe, cancelWipe, doWipe,
    settings, toggleSection, cycleCamera, toggleResumeOnLaunch, toggleNight, togglePerson, toggleAnimal, toggleAutoZoom, toggleForceCpu,
    togglePreciseDetection, zoneEditing, beginZoneEdit, cancelZoneEdit, saveZone,
    setSensitivity, setThreshold, cyclePost, cycleMax, cycleQuality, setRetention,
    toggleAutoDel, toggleNotif, toggleNotifDet, openAlertSoundSettings, wipeAllVideos,
    info, storedSize, openInfo, closeInfo,
    onb, perms, onbNext, onbFinish, grantPermission,
  }), [
    hydrated, tab, monitoring, det, detToday, lastDetAt,
    isRecording, recError, clipGap, autoTune, store, cameraRef, foreground, reportCameraProblem, reportFrameStage, toggleMonitoring, reportDetections,
    events, filter, period, periodOpen, togglePeriodOpen, selected, selectedEvent, selectEvent,
    confirmDelete, askDelete, cancelDelete, doDelete, confirmWipe, askWipe, cancelWipe, doWipe,
    settings, toggleSection, cycleCamera, toggleResumeOnLaunch, toggleNight, togglePerson, toggleAnimal, toggleAutoZoom, toggleForceCpu,
    togglePreciseDetection, zoneEditing, beginZoneEdit, cancelZoneEdit, saveZone,
    setSensitivity, setThreshold, cyclePost, cycleMax, cycleQuality, setRetention,
    toggleAutoDel, toggleNotif, toggleNotifDet, openAlertSoundSettings, wipeAllVideos,
    info, storedSize, openInfo, closeInfo, onb, perms, onbNext, onbFinish, grantPermission,
  ]);

  return (
    <AppStateCtx.Provider value={value}>
      <ViewfinderProvider sink={viewfinder}>{children}</ViewfinderProvider>
    </AppStateCtx.Provider>
  );
}

export function useViewfinderState(): ViewfinderState {
  const ctx = useContext(ViewfinderCtx);
  if (!ctx) throw new Error('useViewfinderState must be used within AppStateProvider');
  return ctx;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateCtx);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}

export function useFilteredEvents(): { shown: DetectionEvent[]; totalCount: number } {
  const { events, filter, period } = useAppState();
  const shown = useMemo(() => {
    const { from, to } = periodRange(period, Date.now());
    return events.filter(e => {
      if (filter === 'Personnes' && e.kind !== 'Personne') return false;
      if (filter === 'Animaux' && e.kind !== 'Animal') return false;
      return e.timestamp >= from && e.timestamp < to;
    });
  }, [events, filter, period]);
  return { shown, totalCount: events.length };
}
