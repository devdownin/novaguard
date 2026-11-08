import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { Linking } from 'react-native';
import type { Camera as VisionCamera } from 'react-native-vision-camera';
import { Camera as CameraModule, useCameraPermission, useMicrophonePermission } from 'react-native-vision-camera';
import {
  AgentNote, Camera, DetectionEvent, DetectionKind, SubjectSample, DetectionZone, ExpandedSections, HistoryFilter, InfoPanel,
  MaxDuration, OnboardingStep, Period, PermissionOutcome, Permissions, PostRoll, PresenceMode, Quality,
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
import { rememberScenery, SceneryMark, withoutScenery } from '../ml/scenery';
import { confirmedTracksIfChanged, primaryTrack, Track, updateTracks } from '../ml/tracker';
import { calibrationProbes, NO_PROBES, Probe } from '../ml/calibration';
import { acknowledgeMove, IDLE_WATCH, TamperWatch, watchScene } from '../surveillance/tamper';
import { trackerOptionsFor } from '../ml/sensitivity';
import { detectionsInZone, withExclusion } from '../ml/zone';
import { Clip, useRecorder } from '../recording/useRecorder';
import { useBufferedRecorder } from '../recording/useBufferedRecorder';
import { TOLERANCE_OPTIONS, usesBufferedCapture } from '../recording/presenceMode';
import { serviceNotice, statusIsFault, SurveillanceStatus, surveillanceStatusOf } from '../surveillance/status';
import {
  bytesToReclaim, clipFileName, clipOutcome, eventFiles, eventsToReclaim, expiredEvents, keptEventIds, lowSpaceBytes,
  minFreeBytes, nextEventId, periodRange, postRollMs, sameDay, todayCount, totalBytes,
} from '../recording/library';
import {
  deleteFiles, orphanedRecordings, renameRecording, volumeSpace,
} from '../recording/videoStore';
import {
  batteryLevel, canConfirmIdentity, confirmIdentity, dismissDetectionAlert, extractThumbnail,
  foregroundServiceError,
  hasNotificationPermission, isCharging, notifyDetection, openAppSettings,
  openDetectionChannelSettings, requestNotificationPermission, startForegroundService,
  stopForegroundService, thermalStatus,
} from '../surveillance/foregroundService';
import {
  LocalServerStatus, generateLocalStreamPin, startLocalStreamServer, stopLocalStreamServer,
} from '../surveillance/localStreamServer';
import {
  McpServerStatus, MCP_SERVER_STOPPED, generateMcpToken as mintMcpToken,
  answerMcpAuthorization, buildMcpDiagnostics, getMcpServerStatus, onMcpCommand, onMcpControlRevoked, pushMcpSnapshot, resolveMcpCommand, revokeMcpGrant as revokeNativeMcpGrant, startMcpRelay, startMcpServer, stopMcpRelay, stopMcpServer,
} from '../surveillance/mcpServer';
import { executeMcpCommand } from '../surveillance/mcpCommands';
import { normalizeRelayUrl } from '../surveillance/relayAddress';
import { McpAuthPrompt } from '../components/McpAuthPrompt';
import { AGENT_LOG_KEY, AgentAction, appendAgentAction, parseAgentLog } from '../surveillance/agentLog';
import { agentControlLive, controlExpiry, nextLifetime } from '../surveillance/mcpControl';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { alertContent, passageIdFromUrl, shouldAlert } from '../surveillance/alerts';
import { installFrameErrorGuard } from '../camera/frameErrorGuard';
import { FRAME_ERROR_PREFIX } from '../camera/frameErrors';
import {
  FrameStage, isCompleteFrame, isLaterStage, parseStage, stageDiagnosis,
} from '../camera/frameTrace';
import {
  cameraDeliveredFrame, cameraFailed, CameraHealth, cameraRetried, HEALTHY_CAMERA, retryDelayFor,
} from '../camera/cameraHealth';
import { countFrame, EMPTY_FRAME_RATE_WINDOW, FrameRateWindow } from '../camera/frameRate';
import {
  AutoTuneState, decisionChanged, expectedTarget, IDLE_AUTO_TUNE, seedFrom, seedsWith,
  tunedSettings, updateAutoTune,
} from '../camera/autoTune';
import { AutoTuneLog, emptyAutoTuneLog, pushSample, sampleSteps } from '../camera/autoTuneLog';
import { DeviceLoad, deviceLoadOf, UNKNOWN_DEVICE_LOAD } from '../camera/deviceLoad';
import { ClipGapStats, EMPTY_CLIP_GAP_STATS, recordGap } from '../recording/clipGap';
import { RawSample, recordSubject, trailSince } from '../recording/subjectTrail';
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
  surveillanceStatus: SurveillanceStatus;
  captureRevision: number;
  retryCapture: () => void;
  /** The changed field of view is intended: watch it from now on. */
  acknowledgeMove: () => void;
  openCaptureSettings: () => void;
  openStorageSettings: () => void;
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
  /**
   * The windows behind that decision, for the screen that draws them.
   *
   * Handed out as the buffer rather than as state on purpose: one sample lands
   * per closed frame-rate window, on the frame path, and publishing that would
   * re-render every consumer twice a second. The one screen that reads it polls
   * while it is open — see `AutoTuneSheet`.
   */
  autoTuneLog: React.RefObject<AutoTuneLog>;
  /**
   * Heat and power as the platform reports them, re-read on a slow interval
   * while monitoring — the cause behind a cadence that collapsed. A ref for
   * the same reason as the log: nothing on screen depends on it changing, and
   * the frame path reads it.
   */
  deviceLoad: React.RefObject<DeviceLoad>;
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
  /**
   * The capture session died — an incoming call, another app taking the camera.
   * Distinct from `reportCameraProblem`, which also carries model failures and
   * frame-processor errors: those leave the session running, this one does not.
   */
  reportCameraError: (message: string) => void;
  /** Whether the camera is delivering, or is down and being restarted. */
  cameraHealth: CameraHealth;
  /** False for the moment a restart takes: what unmounts the dead session. */
  cameraActive: boolean;
  /** Called before each native call an analysed frame makes — see `frameTrace.ts`. */
  reportFrameStage: (stage: FrameStage) => void;
  toggleMonitoring: () => void;
  /** Called from the camera frame-processor (JS thread) with this frame's qualifying detections. */
  /** `scene` is the analysis's scene sample (`sceneSample`), for the tamper watch. */
  reportDetections: (detections: FrameDetection[], frameAspect: number, capturedAt?: number, scene?: number[]) => void;

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
  /** True while the recordings are behind the device's own lock (see `IdentityCheck.kt`). */
  historyLocked: boolean;
  /** Raises the system prompt; resolves whether the history opened. */
  unlockHistory: () => Promise<boolean>;
  /** False on a device with no screen lock, where the setting would protect nothing. */
  identityAvailable: boolean;

  // confirmations
  /** Holds or releases the selected passage as evidence (see `keptEventIds`). */
  toggleKeep: () => void;
  setAgentNote: (eventId: number, note: AgentNote | null) => void;
  confirmDelete: boolean;
  askDelete: () => void;
  cancelDelete: () => void;
  doDelete: () => void;
  /** Events a bulk delete is waiting on the user to confirm, or null. */
  pendingBulkDelete: number[] | null;
  askDeleteMany: (ids: number[]) => void;
  cancelDeleteMany: () => void;
  doDeleteMany: () => void;
  confirmWipe: boolean;
  askWipe: () => void;
  cancelWipe: () => void;
  doWipe: () => void;

  // setup
  settings: Settings;
  toggleSection: (key: keyof ExpandedSections) => void;
  cycleCamera: () => void;
  toggleResumeOnLaunch: () => void;
  toggleLockHistory: () => void;
  toggleNight: () => void;
  togglePerson: () => void;
  toggleAnimal: () => void;
  toggleAutoZoom: () => void;
  toggleAutoTune: () => void;
  toggleForceCpu: () => void;
  toggleCalibration: () => void;
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
  /** What the editor draws while `zoneEditing`: the watched zone, or one more zone to ignore. */
  zoneEditKind: 'zone' | 'exclusion';
  beginExclusionEdit: () => void;
  /** Adds an ignored zone, dropping the oldest past `MAX_EXCLUSIONS`. */
  saveExclusion: (zone: DetectionZone) => void;
  clearExclusions: () => void;
  setSensitivity: (s: Sensitivity) => void;
  setThreshold: (v: number) => void;
  setAnimalThreshold: (v: number) => void;
  cyclePost: () => void;
  setPresenceMode: (mode: PresenceMode) => void;
  cycleTolerance: () => void;
  cycleMax: () => void;
  cycleQuality: () => void;
  setRetention: (r: Retention) => void;
  toggleAutoDel: () => void;
  toggleNotif: () => void;
  toggleNotifDet: () => void;
  toggleNotifPicture: () => void;
  toggleQuietHours: () => void;
  setQuietStart: (hour: number) => void;
  setQuietEnd: (hour: number) => void;
  toggleLocalStream: () => void;
  localStreamStatus: LocalServerStatus;
  toggleMcpServer: () => void;
  generateMcpToken: () => void;
  clearMcpToken: () => void;
  toggleMcpControl: () => void;
  generateMcpControlToken: () => void;
  clearMcpControlToken: () => void;
  cycleMcpControlTtl: () => void;
  toggleMcpLiveFrame: () => void;
  toggleMcpTls: () => void;
  toggleMcpCloud: () => void;
  toggleMcpCloudLiveFrame: () => void;
  /** Saves the relay address as typed; false, and nothing saved, when it is not an acceptable one. Empty clears it. */
  setMcpRelayUrl: (typed: string) => boolean;
  revokeMcpGrant: (id: string) => void;
  /** Control calls made by agents, newest first (`agentLog.ts`). */
  agentLog: AgentAction[];
  /** Live state of the native MCP server, or MCP_SERVER_STOPPED when it is off. */
  mcpStatus: McpServerStatus;
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
  /** Calibration mode only: what the detector saw that is not a subject, and why. */
  probes: Probe[];
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
  setProbes: (update: (previous: Probe[]) => Probe[]) => void;
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
  const [probes, setProbes] = useState<Probe[]>(NO_PROBES);
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
    () => ({ setTracks, setProbes, setPrimaryTrackId, setFrameAspect, setRecSec, setFrameRate }),
    [],
  );
  useEffect(() => {
    sink.current = setters;
    return () => { sink.current = null; };
  }, [setters, sink]);

  const value = useMemo<ViewfinderState>(
    () => ({ tracks, probes, primaryTrackId, frameAspect, recSec, frameRate }),
    [tracks, probes, primaryTrackId, frameAspect, recSec, frameRate],
  );

  return <ViewfinderCtx.Provider value={value}>{children}</ViewfinderCtx.Provider>;
}

function cycle<T>(options: readonly T[], current: T): T {
  const i = options.indexOf(current);
  return options[(i + 1) % options.length];
}

const CAMERA_OPTIONS: Camera[] = ['Arrière (1×)', 'Arrière (0,5×)', 'Avant'];
const POST_OPTIONS: PostRoll[] = ['0 s', '5 s', '10 s', '30 s'];
const MAX_OPTIONS: MaxDuration[] = ['1 min', '2 min', '5 min', '10 min', '15 min', '20 min'];
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
 * Reconciles what is on disk with what this version knows about.
 *
 * Both directions matter, and only one of them used to. A settings object
 * written by an older version is **missing** every field added since, so the
 * defaults have to sit underneath — that part was always here. But it also
 * **carries** every field since removed, and a plain spread kept those: they
 * stayed in state, were written back on the next save, and outlived the code
 * that read them. Keeping only keys the defaults name settles both, and is
 * what lets a setting actually be deleted rather than merely ignored.
 */
export function mergeStoredSettings(stored: Partial<Settings>): Settings {
  const merged = { ...defaultSettings };
  for (const key of Object.keys(defaultSettings) as (keyof Settings)[]) {
    const value = stored[key];
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  if (stored.tolerance === undefined && merged.post !== '0 s') merged.tolerance = merged.post;
  return merged;
}

/**
 * How often the native MCP server's own counters are read back.
 *
 * Two seconds is a Setup screen refreshing a "last request" line, not a
 * measurement: nothing depends on the value being current, and the interval
 * only runs while the server is enabled.
 */
const MCP_STATUS_POLL_MS = 2_000;

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
 * How often heat and power are re-read.
 *
 * Three native calls, so not on the frame path: thermal status moves over
 * minutes, and a reading per analysed frame would cost five bridge round trips
 * a second for a value that changes at walking pace. Only while monitoring —
 * with the camera off there is nothing for it to explain.
 */
export const DEVICE_LOAD_SWEEP_MS = 10_000;

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
  /** See `cameraHealth.ts`: the session can be taken from us at any moment. */
  const [recovery, setRecovery] = useState(HEALTHY_CAMERA);
  const recoveryRef = useRef(HEALTHY_CAMERA);
  const [cameraActive, setCameraActive] = useState(true);
  const [det, setDet] = useState<DetectionKind | null>(null);
  // Frame-rate state lives in `ViewfinderProvider` below; the provider reaches
  // its setters through this sink, so a detection never re-renders this body.
  const viewfinder = useRef<ViewfinderSink | null>(null);
  const [detToday, setDetToday] = useState(defaultDetToday);
  const [lastDetAt, setLastDetAt] = useState(defaultLastDetAt);
  const [recError, setRecError] = useState<string | null>(null);
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);
  const [analysisStalled, setAnalysisStalled] = useState(false);
  // Its own owner, like capture and detection faults: a camera recovering must
  // not clear a covered lens, nor the reverse.
  const tamperRef = useRef<TamperWatch>(IDLE_WATCH);
  const [tamper, setTamper] = useState<{ obstructed: boolean; moved: boolean }>({ obstructed: false, moved: false });
  const publishTamper = useCallback((watch: TamperWatch) => {
    const obstructed = watch.obstructed;
    const moved = watch.movedAt != null;
    setTamper(prev => (prev.obstructed === obstructed && prev.moved === moved ? prev : { obstructed, moved }));
  }, []);
  const acknowledgeMoveCb = useCallback(() => {
    tamperRef.current = acknowledgeMove(tamperRef.current);
    publishTamper(tamperRef.current);
  }, [publishTamper]);
  const analysisStalledRef = useRef(false);
  const lastAnalysisAtRef = useRef<number | null>(null);
  const [captureRevision, setCaptureRevision] = useState(0);
  const [recordingProblem, setRecordingProblem] = useState<string | null>(null);
  const recordingRecovered = useCallback(() => setRecordingProblem(null), []);
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
  const refreshVolume = useCallback(async () => {
    const space = await volumeSpace();
    setVolume(prev => (prev.free === space.free && prev.total === space.total ? prev : space));
  }, []);
  /**
   * Surveillance runs with the screen off — that is the whole point of the
   * foreground service — so nothing about detection or recording reads this.
   * It gates only the work whose sole product is something on screen.
   */
  const foreground = useForeground();
  // Changes only at a cap boundary — minutes apart — so it costs the frame path
  // nothing to hold it in ordinary state.
  const [clipGap, setClipGap] = useState<ClipGapStats>(EMPTY_CLIP_GAP_STATS);
  /** The analysis step the previous launch never came back from, for `get_diagnostics`. */
  const [crashedStage, setCrashedStage] = useState<FrameStage | null>(null);
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
      const [s, storedEvents, dt, ld, wasMonitoring, onboarded, lastStage, seeds] = await Promise.all([
        storage.loadSettings(),
        storage.loadEvents(),
        storage.loadDetToday(),
        storage.loadLastDetAt(),
        storage.loadMonitoring(),
        storage.loadOnboardingComplete(),
        storage.loadFrameStage(),
        storage.loadAutoTuneSeeds(),
      ]);
      if (cancelled) return;
      autoTuneSeedsRef.current = seeds;
      const restored = s ? mergeStoredSettings(s) : defaultSettings;
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
        const stage = parseStage(lastStage);
        const diagnosis = stageDiagnosis(stage);
        if (diagnosis) setCrashedStage(stage);
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
  const passageIdRef = useRef<string | undefined>(undefined);
  const passageSerialRef = useRef(0);
  const sessionKindsRef = useRef(new Set<DetectionKind>());
  /**
   * The track the session opened on.
   *
   * Kept so the session's label can follow that track's own change of mind —
   * the tracker revises what it holds a subject to be as the looks accumulate
   * (see `evidence` in `tracker.ts`) — without ever following a *different*
   * subject: a dog wandering in while someone is being filmed can become the
   * primary track on its own, and the passage this clip and this history entry
   * describe is still the person's.
   */
  const sessionTrackIdRef = useRef<number | null>(null);
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
  const sceneryRef = useRef<SceneryMark[]>([]);
  /**
   * The subject currently being followed, so `primaryTrack` can keep it rather
   * than reshuffling two people who score within a hundredth of each other.
   */
  const primaryIdRef = useRef<number | null>(null);
  /**
   * Set while a stop is in flight, so the arriving clip knows what it belongs to.
   *
   * `rollover` says the stop came from the duration cap with the subject still
   * in frame: the clip is filed as its own event, but the passage is not over,
   * so the session survives it and the next clip opens as soon as this one is
   * filed.
   */
  type PendingClip = {
    kind: DetectionKind; dur: number; conf: number; rollover: boolean; passageId?: string; startedAt?: number; kinds?: DetectionKind[];
    subject?: SubjectSample[];
  };
  /** Where the session's subject has been, a sample a second — see `subjectTrail.ts`. */
  const subjectTrailRef = useRef<RawSample[]>([]);
  const pendingRef = useRef(new Map<number, PendingClip>());
  const recordingMetaRef = useRef(new Map<number, PendingClip>());
  const sessionRecordingIdRef = useRef<number | null>(null);
  const recordingIdRef = useRef<() => number | null>(() => null);
  const nextRecordingAttemptRef = useRef(0);
  const lastClosedAtRef = useRef(0);
  const lastPositiveAtRef = useRef(0);
  const positiveStartRef = useRef(new Map<number, number>());
  /** Post-roll: keep rolling for a moment after the last subject leaves. */
  const postRollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the last detection alert went out, for the cooldown. */
  const lastAlertRef = useRef<number | null>(null);
  /** Rolling count behind the measured frame rate. */
  const frameWindowRef = useRef<FrameRateWindow>({ ...EMPTY_FRAME_RATE_WINDOW });
  /** The self-tuning state the frame path folds into; `autoTune` is its published half. */
  const autoTuneRef = useRef<AutoTuneState>(IDLE_AUTO_TUNE);
  /** One entry per closed window, bounded, never rendered from directly. */
  const autoTuneLogRef = useRef<AutoTuneLog>(emptyAutoTuneLog());
  /** Heat and power, polled while monitoring; "unknown" everywhere else. */
  const deviceLoadRef = useRef<DeviceLoad>(UNKNOWN_DEVICE_LOAD);
  /**
   * What previous sessions had to give up, per recording quality, as read at
   * hydration. Held in a ref because a session starts on a tap: an await there
   * would leave the first windows running on a state the disk was about to
   * replace.
   */
  const autoTuneSeedsRef = useRef<Record<string, string[]> | null>(null);
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
  const [zoneEditKind, setZoneEditKind] = useState<'zone' | 'exclusion'>('zone');
  const zoneEditingRef = useLatest(zoneEditing);
  const monitoringRef = useLatest(monitoring);
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
    kind: DetectionKind, dur: number, c: number, clip: Clip | null, at: number = Date.now(), passageId?: string, kinds?: DetectionKind[],
    subject?: SubjectSample[],
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
        ...(passageId ? { passageId } : {}),
        ...(kinds?.length ? { kinds } : {}),
        // Only with a clip: it says where to look in a file, and there is none otherwise.
        ...(clip && subject?.length ? { subject } : {}),
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
    passageIdRef.current = undefined;
    sessionKindsRef.current = new Set();
    sessionTrackIdRef.current = null;
    sessionRecordingIdRef.current = null;
    subjectTrailRef.current = [];
    setDet(null);
    viewfinder.current?.setRecSec(0);
  }, []);

  /** Describes the clip being closed, not the passage that may outlive it. */
  const sessionMeta = useCallback(() => ({
    kind: sessionKindRef.current as DetectionKind,
    passageId: passageIdRef.current,
    kinds: [...sessionKindsRef.current],
    startedAt: segmentStartRef.current,
    dur: Math.max(1, Math.round((Date.now() - segmentStartRef.current) / 1000)),
    conf: Math.round(sessionMaxConfRef.current * 100),
    subject: trailSince(subjectTrailRef.current, segmentStartRef.current),
  }), []);

  const onRecordingStarted = useCallback((id: number) => {
    sessionRecordingIdRef.current = id;
    if (sessionKindRef.current != null) recordingMetaRef.current.set(id, { ...sessionMeta(), rollover: false });
  }, [sessionMeta]);

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
      setRecordingProblem(t('error.storage'));
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
    const pending = pendingRef.current.get(clip.recordingId);
    pendingRef.current.delete(clip.recordingId);
    const ownsActive = sessionRecordingIdRef.current === clip.recordingId;
    const meta = pending ?? recordingMetaRef.current.get(clip.recordingId) ?? null;
    if (!clip.continued) recordingMetaRef.current.delete(clip.recordingId);
    if (meta && !clip.continued && clip.endedAt != null) lastClosedAtRef.current = Math.max(lastClosedAtRef.current, clip.endedAt);

    switch (clipOutcome(meta != null, clip.bytes)) {
      case 'discard':
        // A stop that raced the session ending, or the component going away
        // mid-clip. Nothing will ever point at these files.
        deleteFiles([clip.path, clip.thumbPath]);
        return;

      case 'event-only':
        // The encoder produced an empty file. Keep the sighting, drop the husk:
        // an unplayable 0-byte row in the history is worse than none.
        if (!pending && ownsActive && !clip.continued) clearSession();
        deleteFiles([clip.path, clip.thumbPath]);
        commitEvent(meta!.kind, meta!.dur, meta!.conf, null, meta!.startedAt, meta!.passageId, meta!.kinds);
        return;

      case 'attach': {
        if (!pending && ownsActive && !clip.continued) clearSession();
        const at = clip.startedAt ?? meta!.startedAt ?? Date.now();
        renameRecording(clip.path, clipFileName(meta!.kind, at)).then(path => {
          const id = commitEvent(meta!.kind, meta!.dur, meta!.conf, { ...clip, path }, at, meta!.passageId, meta!.kinds, meta!.subject);
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
  }, [attachThumbnail, clearSession, commitEvent]);

  /**
   * The encoder has released the camera. If the cap cut this clip with the
   * subject still in frame, the next one opens here — before the byte count is
   * read back, which is a bridge round trip nobody is being filmed during.
   */
  const onEncoderFree = useCallback((recordingId: number) => {
    const pending = pendingRef.current.get(recordingId);
    const cutAt = cutAtRef.current;
    cutAtRef.current = null;
    if (!(pending?.rollover && sessionKindRef.current != null && sessionRecordingIdRef.current === recordingId)) return;
    if (usesBufferedCapture(settingsRef.current.post) !== (recordingId < 0)) return;

    // Both readings are taken around the call itself, so nothing between them
    // is anything but the work being measured.
    const freeAt = Date.now();
    const opened = openNextSegment();
    if (cutAt == null || !opened) return;
    setClipGap(previous => recordGap(previous, {
      finalizeMs: freeAt - cutAt,
      restartMs: Date.now() - freeAt,
    }));
  }, [openNextSegment, settingsRef]);

  /**
   * The clip a stop was waiting on never arrived — the encoder did not answer
   * within `FINALIZE_TIMEOUT_MS`. Nothing else will write the event that clip
   * was carrying, and if the passage is still running it now has no recording.
   */
  const onClipAbandoned = useCallback((recordingId: number) => {
    recordingMetaRef.current.delete(recordingId);
    const pending = pendingRef.current.get(recordingId);
    pendingRef.current.delete(recordingId);
    if (!pending) {
      // A mid-recording error must release the presence session for a bounded retry.
      nextRecordingAttemptRef.current = performance.now() + 1000;
      return;
    }
    if (pending.rollover && sessionKindRef.current != null && sessionRecordingIdRef.current === recordingId &&
      (usesBufferedCapture(settingsRef.current.post) === (recordingId < 0))) openNextSegment();
    commitEvent(pending.kind, pending.dur, pending.conf, null, pending.startedAt, pending.passageId, pending.kinds);
  }, [commitEvent, openNextSegment, settingsRef]);

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
    const id = recordingIdRef.current();
    if (id != null) pendingRef.current.set(id, { ...meta, rollover: true });
    // The next clip's window starts now. Confidence restarts from whatever is in
    // frame at this instant so each event describes its own clip.
    const primary = primaryTrack(tracksRef.current, primaryIdRef.current);
    segmentStartRef.current = Date.now();
    sessionMaxConfRef.current = primary ? primary.maxConfidence : 0;
    subjectTrailRef.current = subjectTrailRef.current.filter(sample => sample.at >= segmentStartRef.current);
  }, [sessionMeta]);

  const legacyRecorder = useRecorder({
    cameraRef,
    enabled: monitoring && perms.cam && !usesBufferedCapture(settings.post),
    max: settings.max,
    retryKey: captureRevision,
    onClip,
    onStarted: onRecordingStarted,
    onError: setRecordingProblem, onRecovered: recordingRecovered,
    onMaxDuration: rollSegment,
    onAbandoned: onClipAbandoned,
    onEncoderFree,
  });
  const bufferedRecorder = useBufferedRecorder({
    cameraRef, retryKey: captureRevision, enabled: monitoring && perms.cam && usesBufferedCapture(settings.post),
    audio: perms.mic, quality: settings.quality, max: settings.max,
    onClip, onStarted: onRecordingStarted, onError: setRecordingProblem, onRecovered: recordingRecovered, onAbandoned: onClipAbandoned, onEncoderFree,
  });
  const recorder = usesBufferedCapture(settings.post) ? bufferedRecorder : legacyRecorder;
  const observeRef = useRef(recorder.observe);
  useEffect(() => { observeRef.current = recorder.observe; }, [recorder.observe]);
  // Depend on the two callbacks rather than the recorder object: it is a fresh
  // literal every render, and `reportDetections` feeds the frame processor's
  // dependency list — an identity that churned every render would rebuild the
  // worklet several times a second.
  const { isRecording, start: startRecording, stop: stopRecording } = recorder;
  // Written on commit rather than during render: no clip can land, and no cap
  // can expire, before the recorder has been started — which needs a commit.
  useEffect(() => { startRecordingRef.current = startRecording; }, [startRecording]);
  useEffect(() => { stopRecordingRef.current = stopRecording; }, [stopRecording]);
  useEffect(() => { recordingIdRef.current = recorder.currentId; }, [recorder.currentId]);

  const cancelPostRoll = useCallback(() => {
    if (postRollRef.current) {
      clearTimeout(postRollRef.current);
      postRollRef.current = null;
    }
  }, []);

  /** Ends the session now, without waiting out the post-roll. */
  const endSession = useCallback((untilAt = lastPositiveAtRef.current) => {
    if (sessionKindRef.current == null) return;
    cancelPostRoll();
    const meta = sessionMeta();
    const activeId = recordingIdRef.current();
    const id = activeId ?? sessionRecordingIdRef.current;
    clearSession();

    // A cap-driven cut may still be in flight. Its clip already carries an
    // event, so all this has to do is cancel the continuation — stopping again
    // would answer false and mint a second, file-less event for a segment that
    // recorded nothing, while the real clip landed to a closed session and was
    // deleted as unclaimed.
    const pending = id != null ? pendingRef.current.get(id) : undefined;
    if (id != null && pending) {
      pendingRef.current.set(id, { ...pending, rollover: false });
      return;
    }

    if (activeId == null && id != null && recordingMetaRef.current.has(id)) {
      pendingRef.current.set(id, { ...meta, rollover: false });
      return;
    }
    if (stopRecording(untilAt)) {
      if (id != null) pendingRef.current.set(id, { ...meta, rollover: false });   // the clip carries the event
    } else {
      // Nothing was recording (no permission, disk full, camera gone). The
      // sighting still happened, so keep it — just without a file.
      commitEvent(meta.kind, meta.dur, meta.conf, null, meta.startedAt, meta.passageId, meta.kinds);
    }
  }, [cancelPostRoll, clearSession, commitEvent, sessionMeta, stopRecording]);

  const retryCapture = useCallback(() => {
    if (!monitoringRef.current || !perms.cam) return;
    endSession();
    tracksRef.current = [];
    sceneryRef.current = [];
    tamperRef.current = IDLE_WATCH;
    publishTamper(IDLE_WATCH);
    positiveStartRef.current.clear();
    primaryIdRef.current = null;
    viewfinder.current?.setTracks(() => []);
    viewfinder.current?.setProbes(() => NO_PROBES);
    sawFrameRef.current = false;
    setSawFrame(false);
    frameWindowRef.current = { ...EMPTY_FRAME_RATE_WINDOW };
    viewfinder.current?.setFrameRate(0);
    lastAnalysisAtRef.current = null;
    analysisStalledRef.current = false;
    setAnalysisStalled(false);
    setCameraProblem(null);
    setRecError(null);
    recoveryRef.current = HEALTHY_CAMERA;
    setRecovery(HEALTHY_CAMERA);
    setCameraActive(true);
    nextRecordingAttemptRef.current = 0;
    setCaptureRevision(value => value + 1);
  }, [endSession, monitoringRef, perms.cam, publishTamper]);

  const reportDetections = useCallback((detections: FrameDetection[], aspect: number, capturedAt?: number, scene?: number[]) => {
    const now = Date.now();
    const frameAt = capturedAt ?? now;
    const attemptAt = performance.now();
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
    if (zoneEditingRef.current || !monitoringRef.current) return;
    lastAnalysisAtRef.current = attemptAt;
    if (analysisStalledRef.current) {
      analysisStalledRef.current = false;
      setAnalysisStalled(false);
    }
    // Through a ref so this stays a once-per-session write: `setSawFrame` is a
    // stable setter, so arming the resume flag costs the frame path nothing and
    // leaves this callback's identity — and the worklet's — untouched.
    if (!sawFrameRef.current) {
      sawFrameRef.current = true;
      setSawFrame(true);
    }
    // An image is the only proof the camera came back: a session that mounts
    // and then delivers nothing looks exactly like the failure it replaced.
    if (recoveryRef.current.health !== 'healthy') {
      recoveryRef.current = cameraDeliveredFrame(recoveryRef.current);
      setRecovery(recoveryRef.current);
      setCameraProblem(null);
    }
    // What "Sensibilité" asked for is a target; this is what the device manages.
    const measured = countFrame(frameWindowRef.current, now);
    if (measured != null) {
      shown?.setFrameRate(measured);
      // Outside the `shown` guard on purpose: the preview is off with the
      // screen, which is most of a surveillance phone's life, and that is
      // exactly when a device falling behind matters most.
      const previous = autoTuneRef.current;
      // The cadence asked for *during* that window, which the tuner itself can
      // have lowered: read from the state the window ran under, not from the
      // one the fold is about to produce.
      const target = expectedTarget(settingsRef.current, previous);
      const tuned = updateAutoTune(
        previous, { measured, target, load: deviceLoadRef.current }, settingsRef.current,
      );
      if (tuned !== previous) {
        autoTuneRef.current = tuned;
        if (decisionChanged(previous, tuned)) {
          setAutoTune(tuned);
          // Written on decisions only, which are minutes apart at worst: this
          // is the app's own reading of the phone, kept so the next session on
          // this format does not re-pay the seconds it took to learn it.
          if (tuned.applied !== previous.applied) {
            const seeds = seedsWith(
              autoTuneSeedsRef.current, settingsRef.current.quality, tuned.applied,
            );
            autoTuneSeedsRef.current = seeds;
            storage.saveAutoTuneSeeds(seeds);
          }
        }
      }
      // Recorded after the fold, so the window carries the state it ends in —
      // and per step, so a capability the user switched off is never drawn as
      // one the app took away.
      pushSample(autoTuneLogRef.current, {
        measured,
        target,
        steps: sampleSteps(autoTuneRef.current, settingsRef.current),
      });
    }

    // The user's threshold is the tracker's entry gate, not the detector's
    // filter: `interpretDetections` now hands over everything above a low floor
    // so a track already open can survive the weak looks a real subject produces
    // when they turn away or step into shadow. Read through the ref like every
    // other setting on this path — a dependency here would rebuild the worklet.
    // The zone comes first: a detection outside it is not a subject, so it
    // must not open a track, keep one alive, or hold off a post-roll.
    const watched = detectionsInZone(detections, settingsRef.current.zone, settingsRef.current.exclusions);
    // Through the tuned settings: "Sensibilité" moves three things together
    // (see `sensitivity.ts`), so a notch the tuner steps down has to reach
    // `confirmAfter` and the start score as well as the cadence — otherwise it
    // buys frames and pays for them in corroboration it can no longer afford.
    const running = tunedSettings(settingsRef.current, autoTuneRef.current);
    const next = updateTracks(tracksRef.current, watched, frameAt,
      trackerOptionsFor(running.sens, running.threshold, running.animalThreshold));
    tracksRef.current = next;
    // Scenery — a confirmed subject that has not moved for minutes, a coat or a
    // poster as far as the camera can tell — neither opens nor holds a session,
    // and is not drawn as a detection. Tracked all the same, so the first move
    // brings it back (see `scenery.ts`).
    sceneryRef.current = rememberScenery(sceneryRef.current, next, frameAt);
    const live = withoutScenery(next, sceneryRef.current, frameAt);
    // Keep the previous array when nothing moved: every other setter here
    // already bails on `Object.is`, so this is what makes a still scene free.
    shown?.setTracks(prev => confirmedTracksIfChanged(prev, live));
    // Off, this keeps the empty array and costs nothing; on, it is a
    // diagnostic and re-renders the overlay leaf on each look by design.
    if (scene) {
      const watch = watchScene(tamperRef.current, scene, next.some(track => track.confirmed), frameAt);
      if (watch !== tamperRef.current) {
        tamperRef.current = watch;
        publishTamper(watch);
      }
    }
    const calibrating = settingsRef.current.calibration;
    shown?.setProbes(prev => (calibrating
      ? calibrationProbes(watched, next, live)
      : prev.length === 0 ? prev : NO_PROBES));

    for (const track of next) {
      if (track.misses === 0 && !positiveStartRef.current.has(track.id)) positiveStartRef.current.set(track.id, frameAt);
      if (track.misses !== 0) positiveStartRef.current.delete(track.id);
    }
    const liveIds = new Set(next.map(track => track.id));
    for (const id of positiveStartRef.current.keys()) if (!liveIds.has(id)) positiveStartRef.current.delete(id);
    const observed = usesBufferedCapture(settingsRef.current.post) ? live.filter(track => track.misses === 0) : live;
    const primary = primaryTrack(observed, primaryIdRef.current);
    primaryIdRef.current = primary ? primary.id : null;
    shown?.setPrimaryTrackId(primaryIdRef.current);

    // A delayed positive after the tolerance expired belongs to a new interval.
    const toleranceMs = postRollMs(settingsRef.current.post);
    if (usesBufferedCapture(settingsRef.current.post) && postRollRef.current != null &&
      frameAt >= lastPositiveAtRef.current + toleranceMs) {
      endSession(lastPositiveAtRef.current + toleranceMs);
    }
    if (primary) {
      lastPositiveAtRef.current = frameAt;
      cancelPostRoll();
      if (sessionKindRef.current == null) {
        if (attemptAt < nextRecordingAttemptRef.current) return;
        sessionKindRef.current = primary.kind;
        passageIdRef.current = `${Date.now()}-${++passageSerialRef.current}-${Math.random().toString(36).slice(2, 10)}`;
        sessionTrackIdRef.current = primary.id;
        sessionKindsRef.current = new Set(observed.filter(track => track.confirmed).map(track => track.kind));
        sessionStartRef.current = Math.max(positiveStartRef.current.get(primary.id) ?? frameAt, lastClosedAtRef.current);
        segmentStartRef.current = sessionStartRef.current;
        sessionMaxConfRef.current = primary.maxConfidence;
        subjectTrailRef.current = [];
        shown?.setRecSec(0);
        // Refuse to start on a nearly full volume rather than letting the
        // encoder fail mid-clip and lose the whole passage.
        if (!hasRoomToRecord()) {
          setRecordingProblem(t('error.storage'));
          nextRecordingAttemptRef.current = attemptAt + 1000;
        } else if (!startRecording(sessionStartRef.current)) {
          nextRecordingAttemptRef.current = attemptAt + 1000;
        }

        // Alert on the *opening* of a session, not on the event written when it
        // closes: the point of a surveillance alert is that someone is there
        // now, not that someone was there for the last thirty seconds.
        if (shouldAlert(settingsRef.current, lastAlertRef.current, now)) {
          lastAlertRef.current = now;
          const { title, body } = alertContent(primary.kind, now);
          notifyDetection(title, body, passageIdRef.current ?? '', settingsRef.current.notifPicture);
        }
      } else {
        if (recordingIdRef.current() == null && attemptAt >= nextRecordingAttemptRef.current) {
          nextRecordingAttemptRef.current = attemptAt + 1000;
          if (hasRoomToRecord()) startRecording(sessionStartRef.current);
          else setRecordingProblem(t('error.storage'));
        }
        // A subject the detector first read as an animal and then, on the next
        // looks, as a person is one the tracker relabels — and the label a
        // session opened with is the one the notification used and the one the
        // history entry keeps for good. Following the revision on the *same*
        // track is what makes the correction reach the clip's own name and the
        // journal, instead of stopping at the badge on screen.
        if (primary.id === sessionTrackIdRef.current) sessionKindRef.current = primary.kind;
        sessionMaxConfRef.current = Math.max(sessionMaxConfRef.current, primary.maxConfidence);
        shown?.setRecSec(Math.floor((now - sessionStartRef.current) / 1000));
      }
      recordSubject(subjectTrailRef.current, frameAt, primary.box);
      const recordingId = recordingIdRef.current();
      for (const track of observed) if (track.confirmed) sessionKindsRef.current.add(track.kind);
      if (recordingId != null && sessionKindRef.current != null) {
        recordingMetaRef.current.set(recordingId, { ...sessionMeta(), rollover: false });
      }
      observeRef.current?.(frameAt);
      setDet(primary.kind);
      return;
    }

    if (settingsRef.current.post === '0 s') {
      // A missed look is not an absence: at 3-5 i/s the detector drops a real
      // subject for a frame all the time, and closing on it split one passage
      // into a string of sub-second files. While the tracker still holds a
      // confirmed track the window stays open and the next positive extends it;
      // once the track is let go the file still ends at the last positive look.
      if (live.some(track => track.confirmed)) return;
      lastClosedAtRef.current = frameAt;
      endSession();
      return;
    }

    if (usesBufferedCapture(settingsRef.current.post) && sessionKindRef.current != null) {
      const deadline = lastPositiveAtRef.current + toleranceMs;
      observeRef.current?.(Math.min(frameAt, deadline));
      if (frameAt >= deadline) { endSession(deadline); return; }
      if (postRollRef.current == null) {
        postRollRef.current = setTimeout(() => { postRollRef.current = null; endSession(deadline); }, deadline - frameAt);
      }
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
  }, [cancelPostRoll, endSession, foregroundRef, hasRoomToRecord, monitoringRef, publishTamper, sessionMeta, settingsRef, startRecording, zoneEditingRef]);

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
      sceneryRef.current = [];
      tamperRef.current = IDLE_WATCH;
      publishTamper(IDLE_WATCH);
      primaryIdRef.current = null;
      viewfinder.current?.setTracks(() => []);
      viewfinder.current?.setProbes(() => NO_PROBES);
      sawFrameRef.current = false;
      setSawFrame(false);
      lastAnalysisAtRef.current = null;
      analysisStalledRef.current = false;
      setAnalysisStalled(false);
      recoveryRef.current = HEALTHY_CAMERA;
      setRecovery(HEALTHY_CAMERA);
      setCameraActive(true);
      frameWindowRef.current = { ...EMPTY_FRAME_RATE_WINDOW };
      viewfinder.current?.setFrameRate(0);
      // The verdict belongs to a session: what a phone can hold up depends on
      // the format it is recording, how warm it already is and what else is
      // running. Carrying a step over would keep a capability off long after
      // the reason for taking it away is gone.
      autoTuneRef.current = IDLE_AUTO_TUNE;
      autoTuneLogRef.current = emptyAutoTuneLog();
      deviceLoadRef.current = UNKNOWN_DEVICE_LOAD;
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
    setRecordingProblem(null);
    setMonitoring(true);
  }, [cameraPermission, endSession, monitoring, publishTamper]);

  useEffect(() => cancelPostRoll, [cancelPostRoll]);
  // No delivered analysis is a fault, never evidence of an empty room.
  useEffect(() => {
    if (!monitoring) return undefined;
    const timer = setInterval(() => {
      const lastAnalysisAt = lastAnalysisAtRef.current;
      if (lastAnalysisAt != null && performance.now() - lastAnalysisAt > 3000) {
        analysisStalledRef.current = true;
        setAnalysisStalled(true);
        endSession();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [endSession, monitoring, settings.post]);

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
  }, [monitoring, captureRevision]);

  /**
   * The camera is down: say so where it can be read, and take it back.
   *
   * Both halves matter and neither is cosmetic. The notification is the only
   * surface a surveillance phone shows — its screen is off — so leaving it on
   * "surveillance active" is the app asserting something false for as long as
   * the interruption lasts. And the restart is what ends the interruption: the
   * app that took the camera gives it back, usually within seconds, and only a
   * delivered frame proves we have it again (see `cameraHealth.ts`).
   */
  useEffect(() => {
    if (!monitoring) return undefined;
    if (recovery.health === 'healthy') {
      // The shared status effect owns the standing notification.
      return undefined;
    }

    if (cameraActive) return undefined;
    const retry = setTimeout(() => {
      recoveryRef.current = cameraRetried(recoveryRef.current);
      setRecovery(recoveryRef.current);
      setCameraActive(true);
    }, retryDelayFor(recovery.attempts));
    return () => clearTimeout(retry);
  }, [monitoring, recovery, cameraActive]);

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
    setVolume(prev => (prev.free === space.free && prev.total === space.total ? prev : space));

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

  /**
   * A session starts where the last one on this format ended up — not with its
   * verdict, only with what it had to give up. Everything else about the
   * decision (what was tried and failed, the evidence, the pending
   * verification) is session-scoped and stays behind: a phone that has cooled
   * down, or been handed a lighter quality, gives it all back from the first
   * sustained stretch of full cadence.
   */
  useEffect(() => {
    if (!monitoring) return;
    const seeded = seedFrom(
      autoTuneSeedsRef.current, settingsRef.current.quality, settingsRef.current,
    );
    autoTuneRef.current = seeded;
    setAutoTune(seeded);
  }, [monitoring, settingsRef]);

  useEffect(() => {
    if (!monitoring) {
      deviceLoadRef.current = UNKNOWN_DEVICE_LOAD;
      return undefined;
    }
    const read = () => {
      deviceLoadRef.current = deviceLoadOf(thermalStatus(), batteryLevel(), isCharging());
    };
    read();
    const iv = setInterval(read, DEVICE_LOAD_SWEEP_MS);
    return () => clearInterval(iv);
  }, [monitoring]);

  const store = useMemo<StorageInfo>(
    () => ({ ...volume, used: totalBytes(events) }),
    [events, volume],
  );

  // ── history ──────────────────────────────────────────────────────────
  /**
   * Cleared whenever the app leaves the screen, never persisted: the lock is
   * there for the moment somebody else picks the phone up, and a session that
   * survived that moment would be the lock unlocking itself.
   */
  const [historyUnlocked, setHistoryUnlocked] = useState(false);
  const [identityAvailable] = useState(canConfirmIdentity);
  const historyLocked = settings.lockHistory && !historyUnlocked;
  const historyLockedRef = useLatest(historyLocked);

  useEffect(() => {
    if (!foreground) setHistoryUnlocked(false);
  }, [foreground]);

  /**
   * Opens the history, asking the device who is holding it.
   *
   * Answers true without a prompt when there is nothing to open — the setting
   * is off, or this session already confirmed — so every caller can await it
   * unconditionally and none has to know the rule.
   */
  const unlockHistory = useCallback(async () => {
    if (!historyLockedRef.current) return true;
    const confirmed = await confirmIdentity(t('hist.locked.prompt'), t('hist.locked.prompt.sub'));
    if (confirmed) setHistoryUnlocked(true);
    return confirmed;
  }, [historyLockedRef]);

  const togglePeriodOpen = useCallback(() => setPeriodOpen(v => !v), []);
  /**
   * The lock lives here rather than on the history screen: the camera screen's
   * "Dernière" counter opens the same sheet in one tap, and a lock the shortcut
   * walked past would be decoration.
   */
  const selectEvent = useCallback((id: number | null) => {
    if (id == null || !historyLockedRef.current) {
      setSelected(id);
      return;
    }
    unlockHistory().then(confirmed => { if (confirmed) setSelected(id); });
  }, [historyLockedRef, unlockHistory]);

  // A tap on a detection alert opens its passage. Through `selectEvent`, so a
  // locked history still asks first: the link comes from a notification any
  // app could fake an intent for, and it must not open a clip on its own. A
  // passage still being recorded has no clip yet — the history is the answer.
  const openPassageLink = useCallback((url: string | null | undefined) => {
    const passageId = passageIdFromUrl(url);
    if (passageId == null) return;
    setTab('hist');
    const latest = eventsRef.current.filter(e => e.passageId === passageId)
      .reduce<DetectionEvent | null>((best, e) => (best == null || e.timestamp > best.timestamp ? e : best), null);
    if (latest) selectEvent(latest.id);
  }, [eventsRef, selectEvent]);
  const initialLinkRef = useRef(false);
  useEffect(() => {
    if (!hydrated) return undefined;
    if (!initialLinkRef.current) {
      initialLinkRef.current = true;
      Linking.getInitialURL().then(openPassageLink).catch(() => {});
    }
    const subscription = Linking.addEventListener('url', ({ url }) => openPassageLink(url));
    return () => subscription.remove();
  }, [hydrated, openPassageLink]);

  const askDelete = useCallback(() => setConfirmDelete(true), []);
  const cancelDelete = useCallback(() => setConfirmDelete(false), []);
  const selectedEvent = useMemo(
    () => events.find(e => e.id === selected) ?? null,
    [events, selected],
  );
  /** Keeps or releases the whole passage `eventId` belongs to, as the detail sheet does. */
  const setKept = useCallback((eventId: number, kept: boolean) => {
    setEvents(evs => {
      const passageId = evs.find(e => e.id === eventId)?.passageId;
      return evs.map(e => (e.id === eventId || (passageId != null && e.passageId === passageId)) ? { ...e, kept } : e);
    });
  }, []);

  /** An agent's verdict on one event (`annotate_event`), or null to clear it — the owner's gesture. */
  const setAgentNote = useCallback((eventId: number, note: AgentNote | null) => {
    setEvents(evs => {
      if (!evs.some(e => e.id === eventId)) return evs;
      return evs.map(e => {
        if (e.id !== eventId) return e;
        if (note) return { ...e, agentNote: note };
        const rest = { ...e };
        delete rest.agentNote;
        return rest;
      });
    });
  }, []);

  const toggleKeep = useCallback(() => {
    if (!selectedEvent) return;
    const keep = !keptEventIds(events).has(selectedEvent.id);
    const passageId = selectedEvent.passageId;
    setEvents(evs => evs.map(e => (e.id === selectedEvent.id || (passageId != null && e.passageId === passageId))
      ? { ...e, kept: keep } : e));
  }, [events, selectedEvent]);

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

  const [pendingBulkDelete, setPendingBulkDelete] = useState<number[] | null>(null);
  const askDeleteMany = useCallback((ids: number[]) => setPendingBulkDelete(ids.length ? ids : null), []);
  const cancelDeleteMany = useCallback(() => setPendingBulkDelete(null), []);
  const doDeleteMany = useCallback(() => {
    if (!pendingBulkDelete) return;
    const ids = new Set(pendingBulkDelete);
    const victims = events.filter(e => ids.has(e.id));
    setEvents(evs => evs.filter(e => !ids.has(e.id)));
    if (selected != null && ids.has(selected)) setSelected(null);
    setPendingBulkDelete(null);
    // Chained like `doDelete`: the sweep must measure after the unlink.
    deleteFiles(eventFiles(victims)).then(sweepDisk);
  }, [events, pendingBulkDelete, selected, sweepDisk]);

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

  const openCaptureSettings = useCallback(() => {
    setSettings(value => ({ ...value, exp: { ...value.exp, rec: true } }));
    setTab('setup');
  }, []);
  const openStorageSettings = useCallback(() => {
    setSettings(value => ({ ...value, exp: { ...value.exp, sto: true } }));
    setTab('setup');
    refreshVolume();
  }, [refreshVolume]);

  const toggleSection = useCallback((key: keyof ExpandedSections) => {
    setSettings(s => ({ ...s, exp: { ...s.exp, [key]: !s.exp[key] } }));
  }, []);

  const cycleCamera = useCallback(() => patchSettings({ camera: cycle(CAMERA_OPTIONS, settings.camera) }), [patchSettings, settings.camera]);
  const cyclePost = useCallback(() => patchSettings({ post: cycle(POST_OPTIONS, settings.post) }), [patchSettings, settings.post]);
  const setPresenceMode = useCallback((mode: PresenceMode) => {
    const post = mode === 'strict' ? '0 s' : settings.tolerance;
    if (post === settings.post) return;
    endSession();
    positiveStartRef.current.clear();
    patchSettings({ post });
  }, [endSession, patchSettings, settings.post, settings.tolerance]);
  const cycleTolerance = useCallback(() => {
    const tolerance = cycle(TOLERANCE_OPTIONS, settings.tolerance);
    endSession();
    positiveStartRef.current.clear();
    patchSettings({ tolerance, ...(settings.post === '0 s' ? {} : { post: tolerance }) });
  }, [endSession, patchSettings, settings.post, settings.tolerance]);
  const cycleMax = useCallback(() => patchSettings({ max: cycle(MAX_OPTIONS, settings.max) }), [patchSettings, settings.max]);
  const cycleQuality = useCallback(() => patchSettings({ quality: cycle(QUALITY_OPTIONS, settings.quality) }), [patchSettings, settings.quality]);

  const toggleResumeOnLaunch = useCallback(
    () => patchSettings({ resumeOnLaunch: !settings.resumeOnLaunch }),
    [patchSettings, settings.resumeOnLaunch],
  );
  const toggleLockHistory = useCallback(() => {
    // Switching it on locks the history now, not at the next launch: the person
    // setting it is in Réglages, not in the recordings, and a switch that says
    // "locked" over an open history is a switch that lied for one session.
    setHistoryUnlocked(false);
    patchSettings({ lockHistory: !settings.lockHistory });
  }, [patchSettings, settings.lockHistory]);
  const toggleNight = useCallback(() => patchSettings({ night: !settings.night }), [patchSettings, settings.night]);
  const togglePerson = useCallback(() => patchSettings({ person: !settings.person }), [patchSettings, settings.person]);
  const toggleAnimal = useCallback(() => patchSettings({ animal: !settings.animal }), [patchSettings, settings.animal]);
  const toggleAutoZoom = useCallback(() => patchSettings({ autoZoom: !settings.autoZoom }), [patchSettings, settings.autoZoom]);
  /**
   * Switching it off hands back whatever it had taken at the next window, in
   * `updateAutoTune`; the published state is cleared here so the screens do not
   * keep naming a step that is already back.
   */
  const toggleAutoTune = useCallback(() => {
    const enabled = !settings.autoTune;
    patchSettings({ autoTune: enabled });
    if (!enabled) {
      autoTuneRef.current = IDLE_AUTO_TUNE;
      setAutoTune(IDLE_AUTO_TUNE);
    }
  }, [patchSettings, settings.autoTune]);
  const toggleForceCpu = useCallback(() => patchSettings({ forceCpu: !settings.forceCpu }), [patchSettings, settings.forceCpu]);
  const toggleCalibration = useCallback(() => patchSettings({ calibration: !settings.calibration }), [patchSettings, settings.calibration]);
  const toggleAutoDel = useCallback(() => patchSettings({ autoDel: !settings.autoDel }), [patchSettings, settings.autoDel]);
  const toggleNotif = useCallback(() => patchSettings({ notif: !settings.notif }), [patchSettings, settings.notif]);
  const toggleNotifDet = useCallback(() => patchSettings({ notifDet: !settings.notifDet }), [patchSettings, settings.notifDet]);
  const toggleNotifPicture = useCallback(() => patchSettings({ notifPicture: !settings.notifPicture }), [patchSettings, settings.notifPicture]);
  const toggleQuietHours = useCallback(() => patchSettings({ quietHours: !settings.quietHours }), [patchSettings, settings.quietHours]);
  const setQuietStart = useCallback((hour: number) => patchSettings({ quietStart: hour }), [patchSettings]);
  const setQuietEnd = useCallback((hour: number) => patchSettings({ quietEnd: hour }), [patchSettings]);
  const openAlertSoundSettings = useCallback(() => openDetectionChannelSettings(), []);

  const [mcpStatus, setMcpStatus] = useState<McpServerStatus>(MCP_SERVER_STOPPED);

  const toggleMcpServer = useCallback(() => {
    patchSettings({ mcpEnabled: !settings.mcpEnabled });
  }, [patchSettings, settings.mcpEnabled]);

  /**
   * Starts and stops the native server with the setting.
   *
   * This effect is the whole of what `mcpEnabled` means. Without it the switch
   * wrote a value nobody read: the section announced a URL, offered a token
   * and copied a client configuration, and no socket existed at either end of
   * it — the inert-section failure this repository has shipped once already.
   */
  useEffect(() => {
    if (!hydrated) return;
    if (settings.mcpEnabled) {
      startMcpServer(
        settings.mcpPort, settings.mcpToken, settings.mcpControlToken, settings.mcpControlEnabled, settings.mcpControlExpiresAt,
        settings.mcpTls,
      ).then(setMcpStatus).catch(() => {
        setMcpStatus({ ...MCP_SERVER_STOPPED, port: settings.mcpPort });
      });
    } else {
      stopMcpServer().then(() => setMcpStatus({ ...MCP_SERVER_STOPPED, port: settings.mcpPort }));
    }
  }, [hydrated, settings.mcpEnabled, settings.mcpPort, settings.mcpToken, settings.mcpControlToken, settings.mcpControlEnabled, settings.mcpControlExpiresAt, settings.mcpTls]);

  /**
   * The last time a client actually asked something.
   *
   * Polled rather than pushed: the count lives in the native server, which has
   * no reason to cross the bridge on every request — and a bridge event per
   * request is a way for a busy client to drive re-renders of the whole tree.
   */
  useEffect(() => {
    if (!hydrated || !settings.mcpEnabled) return;
    const iv = setInterval(() => { getMcpServerStatus().then(setMcpStatus).catch(() => {}); }, MCP_STATUS_POLL_MS);
    return () => clearInterval(iv);
  }, [hydrated, settings.mcpEnabled]);

  const generateMcpToken = useCallback(() => {
    mintMcpToken().then(mcpToken => patchSettings({ mcpToken }));
  }, [patchSettings]);

  const clearMcpToken = useCallback(() => {
    patchSettings({ mcpToken: '' });
  }, [patchSettings]);

  const toggleMcpControl = useCallback(() => {
    patchSettings({ mcpControlEnabled: !settings.mcpControlEnabled });
  }, [patchSettings, settings.mcpControlEnabled]);
  const generateMcpControlToken = useCallback(() => {
    const ttl = settings.mcpControlTtl;
    mintMcpToken().then(mcpControlToken => patchSettings({
      mcpControlToken, mcpControlExpiresAt: controlExpiry(ttl, Date.now()),
    }));
  }, [patchSettings, settings.mcpControlTtl]);
  const clearMcpControlToken = useCallback(() => {
    patchSettings({ mcpControlToken: '', mcpControlExpiresAt: 0 });
  }, [patchSettings]);
  /**
   * A new lifetime counts from now: choosing "1 h" on a token issued yesterday
   * means one more hour, not a token that died twenty-three hours ago.
   */
  const cycleMcpControlTtl = useCallback(() => {
    const mcpControlTtl = nextLifetime(settings.mcpControlTtl);
    patchSettings({
      mcpControlTtl,
      ...(settings.mcpControlToken ? { mcpControlExpiresAt: controlExpiry(mcpControlTtl, Date.now()) } : {}),
    });
  }, [patchSettings, settings.mcpControlTtl, settings.mcpControlToken]);

  const toggleMcpTls = useCallback(() => {
    patchSettings({ mcpTls: !settings.mcpTls });
  }, [patchSettings, settings.mcpTls]);

  const toggleMcpCloud = useCallback(() => {
    patchSettings({ mcpCloudEnabled: !settings.mcpCloudEnabled });
  }, [patchSettings, settings.mcpCloudEnabled]);

  const toggleMcpCloudLiveFrame = useCallback(() => {
    patchSettings({ mcpCloudLiveFrame: !settings.mcpCloudLiveFrame });
  }, [patchSettings, settings.mcpCloudLiveFrame]);

  /**
   * Opens and closes the relay with the setting — the whole of what `mcpCloudEnabled`
   * means. It runs only while the server does and a read token exists (the relay is
   * the open internet, and the token is what keeps it shut), and starts again by
   * itself when the server restarts and takes the connection down with it: the
   * status poll reports `off` and this effect sees it.
   */
  const relayAddress = normalizeRelayUrl(settings.mcpRelayUrl) ?? '';
  const cloudWanted = hydrated && settings.mcpEnabled && settings.mcpCloudEnabled
    && settings.mcpToken.length > 0 && relayAddress.length > 0;
  const cloudLiveAllowed = settings.mcpCloudLiveFrame && settings.mcpLiveFrameEnabled;
  const relayDown = mcpStatus.running && (mcpStatus.relayState ?? 'off') === 'off';
  const relayUp = mcpStatus.running && (mcpStatus.relayState ?? 'off') !== 'off';
  useEffect(() => {
    if (cloudWanted && relayDown && !mcpStatus.relayCut) {
      startMcpRelay(relayAddress, cloudLiveAllowed).then(setMcpStatus).catch(() => {});
    } else if (!cloudWanted && relayUp) {
      stopMcpRelay().then(setMcpStatus).catch(() => {});
    }
  }, [cloudWanted, cloudLiveAllowed, relayAddress, relayDown, relayUp, mcpStatus.relayCut]);

  /**
   * "Couper l'accès cloud" was tapped on the notification. The native side has already closed the
   * connection and refuses to open another; this makes the switch say so, and tells it the cut is
   * understood so the owner can turn access back on.
   */
  useEffect(() => {
    if (!mcpStatus.relayCut) return;
    patchSettings({ mcpCloudEnabled: false });
    stopMcpRelay().then(setMcpStatus).catch(() => {});
  }, [mcpStatus.relayCut, patchSettings]);

  const answerAuthorization = useCallback((id: string, allow: boolean, lifetimeMs = 0) => {
    answerMcpAuthorization(id, allow, lifetimeMs)
      .then(() => getMcpServerStatus().then(setMcpStatus))
      .catch(() => {});
  }, []);

  const revokeMcpGrant = useCallback((id: string) => {
    revokeNativeMcpGrant(id)
      .then(() => getMcpServerStatus().then(setMcpStatus))
      .catch(() => {});
  }, []);

  // The live-view switch changes what the relay may carry, and the address changes who carries
  // it: either way the connection is re-made, so the running one never outlives the setting.
  const lastRelay = useRef({ live: cloudLiveAllowed, address: relayAddress });
  useEffect(() => {
    const last = lastRelay.current;
    if (last.live === cloudLiveAllowed && last.address === relayAddress) return;
    lastRelay.current = { live: cloudLiveAllowed, address: relayAddress };
    if (cloudWanted && relayUp) startMcpRelay(relayAddress, cloudLiveAllowed).then(setMcpStatus).catch(() => {});
  }, [cloudLiveAllowed, relayAddress, cloudWanted, relayUp]);

  const setMcpRelayUrl = useCallback((typed: string): boolean => {
    if (typed.trim() === '') { patchSettings({ mcpRelayUrl: '' }); return true; }
    const normalized = normalizeRelayUrl(typed);
    if (normalized === null) return false;
    patchSettings({ mcpRelayUrl: normalized });
    return true;
  }, [patchSettings]);

  const toggleMcpLiveFrame = useCallback(() => {
    patchSettings({ mcpLiveFrameEnabled: !settings.mcpLiveFrameEnabled });
  }, [patchSettings, settings.mcpLiveFrameEnabled]);

  /**
   * "Couper le pilotage" on the notification. The native server has already
   * dropped the token by the time this runs; switching the setting off is what
   * keeps it off across the restart this triggers and the next launch.
   */
  useEffect(() => {
    if (!hydrated || !settings.mcpEnabled || !settings.mcpControlEnabled) return;
    return onMcpControlRevoked(() => patchSettings({ mcpControlEnabled: false }));
  }, [hydrated, settings.mcpEnabled, settings.mcpControlEnabled, patchSettings]);

  const [localStreamStatus, setLocalStreamStatus] = useState<LocalServerStatus>({
    running: false, port: 8080, ipAddress: null, url: null,
  });

  const localStreamStarting = useRef(false);
  const toggleLocalStream = useCallback(() => {
    if (settings.localStreamEnabled) {
      patchSettings({ localStreamEnabled: false });
      stopLocalStreamServer().then(() => {
        setLocalStreamStatus({ running: false, port: settings.localStreamPort, ipAddress: null, url: null, hasPin: false, activeClients: 0 });
      });
    } else if (!localStreamStarting.current) {
      localStreamStarting.current = true;
      const pin = settings.localStreamPin;
      const credential = /^[0-9]{12}$/.test(pin) ? Promise.resolve(pin) : generateLocalStreamPin();
      credential.then(localStreamPin => {
        patchSettings({ localStreamPin, localStreamEnabled: true });
      }).catch(() => {
        setLocalStreamStatus({ running: false, port: settings.localStreamPort, ipAddress: null, url: null });
      }).finally(() => { localStreamStarting.current = false; });
    }
  }, [patchSettings, settings.localStreamEnabled, settings.localStreamPin, settings.localStreamPort]);

  useEffect(() => {
    if (!hydrated || !settings.localStreamEnabled) return;
    if (!/^[0-9]{12}$/.test(settings.localStreamPin)) {
      generateLocalStreamPin().then(localStreamPin => patchSettings({ localStreamPin })).catch(() => {
        patchSettings({ localStreamEnabled: false });
      });
      return;
    }
    startLocalStreamServer(settings.localStreamPort, settings.localStreamPin).then(setLocalStreamStatus).catch(() => {
      patchSettings({ localStreamEnabled: false });
    });
  }, [hydrated, settings.localStreamEnabled, settings.localStreamPin, settings.localStreamPort, patchSettings]);

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
    setCameraProblem(message);
    if (message == null) setRecError(prev => (prev && CAMERA_OWNED_ERROR.test(prev) ? null : prev));
  }, []);

  /**
   * The capture session itself failed. Unlike a model that would not load, this
   * one means no frame is coming until something restarts it.
   *
   * The camera is dropped at once — an unmounted session is what lets CameraX
   * hand the device back and take it again — and the restart is scheduled by
   * the effect below, which also says so where it can be read with the screen
   * off. Outside surveillance there is nothing to keep alive: the message alone
   * is the whole answer.
   */
  const reportCameraError = useCallback((message: string) => {
    setCameraProblem(message);
    if (!monitoringRef.current) return;
    recoveryRef.current = cameraFailed(recoveryRef.current);
    setRecovery(recoveryRef.current);
    setCameraActive(false);
  }, [monitoringRef]);

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
  const beginZoneEdit = useCallback(() => { setTab('cam'); setZoneEditKind('zone'); setZoneEditing(true); }, []);
  const beginExclusionEdit = useCallback(() => { setTab('cam'); setZoneEditKind('exclusion'); setZoneEditing(true); }, []);
  const cancelZoneEdit = useCallback(() => setZoneEditing(false), []);
  const saveZone = useCallback((zone: DetectionZone | null) => {
    setZoneEditing(false);
    patchSettings({ zone });
  }, [patchSettings]);
  const saveExclusion = useCallback((zone: DetectionZone) => {
    setZoneEditing(false);
    patchSettings({ exclusions: withExclusion(settingsRef.current.exclusions, zone) });
  }, [patchSettings, settingsRef]);
  const clearExclusions = useCallback(() => {
    setZoneEditing(false);
    patchSettings({ exclusions: [] });
  }, [patchSettings]);

  // Leaving the camera tab abandons the drawing: the editor is off screen, and
  // the camera would otherwise be left running for it.
  useEffect(() => {
    if (tab !== 'cam') setZoneEditing(false);
  }, [tab]);

  const setSensitivity = useCallback((s: Sensitivity) => patchSettings({ sens: s }), [patchSettings]);
  const setThreshold = useCallback((v: number) => patchSettings({ threshold: v }), [patchSettings]);
  const setAnimalThreshold = useCallback((v: number) => patchSettings({ animalThreshold: v }), [patchSettings]);
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

  const surveillanceStatus = surveillanceStatusOf({
    monitoring, recording: isRecording, cameraPermission: perms.cam, cameraHealth: recovery.health,
    analysisProblem: cameraProblem ?? (analysisStalled ? t('error.analysisStalled') : null), recordingProblem, otherProblem: recError,
    lowStorage: volume.total > 0 && volume.free < minFreeBytes(settings.quality, settings.max),
    obstructed: tamper.obstructed, moved: tamper.moved,
    hasFrame: sawFrame, ready: recorder.isReady ?? true,
  });
  /**
   * Control calls from an agent, executed with the same callbacks the screens
   * use and answered back to the native server, which holds the request open.
   *
   * Read through a ref: the subscription is made once per server lifetime, and
   * the state it acts on — monitoring, settings, the history — is the state at
   * the moment of the call, not at the moment of subscribing.
   */
  const [agentLog, setAgentLog] = useState<AgentAction[]>([]);
  const agentLogRef = useRef<AgentAction[]>([]);
  useEffect(() => {
    AsyncStorage.getItem(AGENT_LOG_KEY).then(raw => {
      agentLogRef.current = parseAgentLog(raw);
      setAgentLog(agentLogRef.current);
    }, () => {});
  }, []);
  const commandDepsRef = useLatest({
    monitoring, foreground, cameraPermission: perms.cam, status: surveillanceStatus, settings, events,
    toggleMonitoring, setSensitivity, setThreshold, setAnimalThreshold, setKept, setAgentNote, acknowledgeMove: acknowledgeMoveCb,
  });
  useEffect(() => {
    if (!hydrated || !settings.mcpEnabled || !settings.mcpControlEnabled) return;
    return onMcpCommand(({ id, command, args }) => {
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(args) ?? {}; } catch {}
      const outcome = executeMcpCommand(command, parsed, commandDepsRef.current);
      resolveMcpCommand(id, JSON.stringify(outcome));
      agentLogRef.current = appendAgentAction(agentLogRef.current, {
        at: Date.now(), command, ok: outcome.ok, changed: outcome.ok && outcome.changed,
      });
      setAgentLog(agentLogRef.current);
      AsyncStorage.setItem(AGENT_LOG_KEY, JSON.stringify(agentLogRef.current)).catch(() => {});
    });
  }, [hydrated, settings.mcpEnabled, settings.mcpControlEnabled, commandDepsRef]);

  /**
   * Hands the server what it answers from.
   *
   * On the history and the settings, never on a frame: the detection path
   * pushes nothing here, so a request cannot cost the analysis a frame and the
   * analysis cannot cost a request a lock.
   *
   * Declared below `surveillanceStatus`, whose value its dependency list reads
   * during render.
   */
  useEffect(() => {
    if (!hydrated || !settings.mcpEnabled) return;
    pushMcpSnapshot({
      surveillanceActive: monitoring,
      settings,
      storage: store,
      events,
      detectionsToday: detToday,
      status: surveillanceStatus,
      diagnostics: buildMcpDiagnostics({
        clipGap, autoTune, autoTuneEnabled: settings.autoTune, cameraHealth: recovery.health, crashedStage,
      }),
    });
  }, [hydrated, settings, monitoring, store, events, detToday, surveillanceStatus, clipGap, autoTune, recovery.health, crashedStage]);
  const agentControl = agentControlLive(settings, Date.now());
  // The relay is connected, or trying to be: there is something for the owner to cut.
  const cloudOpen = settings.mcpCloudEnabled && relayUp;
  const visibleError = cameraProblem ?? (analysisStalled ? t('error.analysisStalled') : null) ?? recordingProblem ?? recError;
  const faultRef = useRef<{ status: SurveillanceStatus; since: number } | null>(null);
  const resumedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!monitoring) { faultRef.current = null; resumedAtRef.current = null; return; }
    const now = Date.now();
    if (statusIsFault(surveillanceStatus)) {
      // One outage, one start time: a camera fault that turns into a storage
      // fault has still kept nobody filmed since the first one.
      faultRef.current = { status: surveillanceStatus, since: faultRef.current?.since ?? now };
      resumedAtRef.current = null;
    } else if (faultRef.current && surveillanceStatus !== 'starting') {
      faultRef.current = null;
      resumedAtRef.current = now;
    }
    startForegroundService(
      serviceNotice(surveillanceStatus, faultRef.current?.since ?? null, resumedAtRef.current),
      agentControl ? t('notif.revokeControl') : '',
      cloudOpen ? t('notif.cutCloud') : '',
    );
  }, [monitoring, surveillanceStatus, agentControl, cloudOpen]);

  const value = useMemo<AppStateValue>(() => ({
    hydrated,
    tab, setTab,
    monitoring, det, detToday, lastDetAt,
    recording: isRecording, recError: visibleError, surveillanceStatus, captureRevision, retryCapture, acknowledgeMove: acknowledgeMoveCb, openCaptureSettings, openStorageSettings, clipGap, autoTune, autoTuneLog: autoTuneLogRef, deviceLoad: deviceLoadRef, storage: store, cameraRef, foreground, reportCameraProblem, reportCameraError, cameraHealth: recovery.health, cameraActive, reportFrameStage,
    toggleMonitoring, reportDetections,
    events, filter, setFilter, period, setPeriod, periodOpen, togglePeriodOpen, selected, selectedEvent, selectEvent, historyLocked, unlockHistory, identityAvailable,
    toggleKeep, setAgentNote, confirmDelete, askDelete, cancelDelete, doDelete,
    pendingBulkDelete, askDeleteMany, cancelDeleteMany, doDeleteMany,
    confirmWipe, askWipe, cancelWipe, doWipe,
    settings, toggleSection, cycleCamera, toggleResumeOnLaunch, toggleLockHistory, toggleNight, togglePerson, toggleAnimal, toggleAutoZoom, toggleAutoTune, toggleForceCpu, toggleCalibration,
    togglePreciseDetection, zoneEditing, beginZoneEdit, cancelZoneEdit, saveZone, zoneEditKind, beginExclusionEdit, saveExclusion, clearExclusions,
    setSensitivity, setThreshold, setAnimalThreshold, cyclePost, setPresenceMode, cycleTolerance, cycleMax, cycleQuality, setRetention,
    toggleAutoDel, toggleNotif, toggleNotifDet, toggleNotifPicture, toggleQuietHours, setQuietStart, setQuietEnd, toggleLocalStream, localStreamStatus, toggleMcpServer, generateMcpToken, clearMcpToken, toggleMcpControl, generateMcpControlToken, clearMcpControlToken, cycleMcpControlTtl, toggleMcpLiveFrame, toggleMcpTls, toggleMcpCloud, toggleMcpCloudLiveFrame, setMcpRelayUrl, revokeMcpGrant, agentLog, mcpStatus, openAlertSoundSettings, wipeAllVideos,
    info, storedSize, openInfo, closeInfo,
    onb, perms, onbNext, onbFinish, grantPermission,
  }), [
    hydrated, tab, monitoring, det, detToday, lastDetAt,
    isRecording, visibleError, surveillanceStatus, captureRevision, retryCapture, acknowledgeMoveCb, openCaptureSettings, openStorageSettings, clipGap, autoTune, autoTuneLogRef, deviceLoadRef, store, cameraRef, foreground, reportCameraProblem, reportCameraError, recovery, cameraActive, reportFrameStage, toggleMonitoring, reportDetections,
    events, filter, period, periodOpen, togglePeriodOpen, selected, selectedEvent, selectEvent, historyLocked, unlockHistory, identityAvailable,
    toggleKeep, setAgentNote, confirmDelete, askDelete, cancelDelete, doDelete, pendingBulkDelete, askDeleteMany, cancelDeleteMany, doDeleteMany,
    confirmWipe, askWipe, cancelWipe, doWipe,
    settings, toggleSection, cycleCamera, toggleResumeOnLaunch, toggleLockHistory, toggleNight, togglePerson, toggleAnimal, toggleAutoZoom, toggleAutoTune, toggleForceCpu, toggleCalibration,
    togglePreciseDetection, zoneEditing, beginZoneEdit, cancelZoneEdit, saveZone, zoneEditKind, beginExclusionEdit, saveExclusion, clearExclusions,
    setSensitivity, setThreshold, setAnimalThreshold, cyclePost, setPresenceMode, cycleTolerance, cycleMax, cycleQuality, setRetention,
    toggleAutoDel, toggleNotif, toggleNotifDet, toggleNotifPicture, toggleQuietHours, setQuietStart, setQuietEnd, toggleLocalStream, localStreamStatus, toggleMcpServer, generateMcpToken, clearMcpToken, toggleMcpControl, generateMcpControlToken, clearMcpControlToken, cycleMcpControlTtl, toggleMcpLiveFrame, toggleMcpTls, toggleMcpCloud, toggleMcpCloudLiveFrame, setMcpRelayUrl, revokeMcpGrant, agentLog, mcpStatus, openAlertSoundSettings, wipeAllVideos,
    info, storedSize, openInfo, closeInfo, onb, perms, onbNext, onbFinish, grantPermission,
  ]);

  return (
    <AppStateCtx.Provider value={value}>
      <McpAuthPrompt enabled={settings.mcpCloudEnabled} pending={mcpStatus.pendingAuthorizations} onAnswer={answerAuthorization} />
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

export function useFilteredEvents(allKinds = false): { shown: DetectionEvent[]; totalCount: number } {
  const { events, filter, period } = useAppState();
  const shown = useMemo(() => {
    const { from, to } = periodRange(period, Date.now());
    return events.filter(e => {
      if (!allKinds && filter === 'Personnes' && !(e.kinds ?? [e.kind]).includes('Personne')) return false;
      if (!allKinds && filter === 'Animaux' && !(e.kinds ?? [e.kind]).includes('Animal')) return false;
      return e.timestamp >= from && e.timestamp < to;
    });
  }, [events, filter, period, allKinds]);
  return { shown, totalCount: events.length };
}
