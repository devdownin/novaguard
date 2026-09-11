export type Tab = 'cam' | 'hist' | 'setup';

/**
 * The part of the frame the camera actually watches, normalized 0–1 in
 * upright-frame space.
 *
 * Structurally the same as `DetectionBox`, and declared here rather than
 * imported because `ml/types.ts` already imports `DetectionKind` from this
 * file — the two must not depend on each other. Structural typing means the
 * geometry helpers take either.
 */
export interface DetectionZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DetectionKind = 'Personne' | 'Animal';

export type HistoryFilter = 'Toutes' | 'Personnes' | 'Animaux';

export type Period = "Aujourd'hui" | '7 jours' | '30 jours' | 'Tout';

export type Sensitivity = 'Basse' | 'Moyenne' | 'Haute';

export type Camera = 'Arrière (1×)' | 'Arrière (0,5×)' | 'Avant';

export type PostRoll = '5 s' | '10 s' | '30 s';
/**
 * Longest a single clip may run. A passage that outlasts it is not cut short —
 * it continues in the next clip — so this bounds file size and the granularity
 * of the history, not how long surveillance keeps filming.
 */
export type MaxDuration = '1 min' | '2 min' | '5 min' | '10 min' | '15 min' | '20 min';
export type Quality = '720p' | '1080p' | '4K';
export type Retention = '1 jour' | '7 jours' | '30 jours' | '90 jours' | 'Toujours';

export interface DetectionEvent {
  id: number;
  kind: DetectionKind;
  /** epoch ms — display label and period bucket are derived from this, not stored. */
  timestamp: number;
  dur: number;
  conf: number;
  /**
   * Absolute path of the recorded clip, or `null` when no file was produced
   * (recording refused, disk full, permission missing). The event is still
   * worth keeping — it says something was seen — so this is nullable rather
   * than a reason to drop it.
   */
  path: string | null;
  /** Real size on disk in bytes, read back with `stat` after the file closed. */
  bytes: number;
  /**
   * The still taken as the clip opened, or `null` when none could be — no
   * preview to screenshot, or an event with no file at all. Events written
   * before thumbnails existed read back without the field, so anything showing
   * one must treat a missing value as `null` rather than trust the type.
   */
  thumbPath: string | null;
}

/** What the volume itself reports. Measured; nothing here is derived. */
export interface VolumeSpace {
  /** Bytes free on the volume holding the clips. */
  free: number;
  /** Total volume size, for the usage bar. */
  total: number;
}

export interface StorageInfo extends VolumeSpace {
  /** Bytes taken by NovaGuard's own clips, summed from the events. */
  used: number;
}

export interface ExpandedSections {
  surv: boolean;
  det: boolean;
  rec: boolean;
  sto: boolean;
  not: boolean;
  stream: boolean;
  about: boolean;
}

/**
 * What came of asking for a permission.
 *
 * `blocked` is the case a boolean hides: Android stops showing the dialog once
 * the user has refused for good, so the request resolves without anything
 * appearing on screen. A caller that cannot tell it from an ordinary refusal
 * can only offer a button that silently does nothing.
 */
export type PermissionOutcome = 'granted' | 'denied' | 'blocked';

/** All three are real OS permissions, re-read live and never persisted. */
export interface Permissions {
  cam: boolean;
  mic: boolean;
  notif: boolean;
}

export interface Settings {
  camera: Camera;
  /**
   * Resume monitoring when the app is opened.
   *
   * Not "start at boot": Android forbids launching a camera foreground service
   * from a BOOT_COMPLETED receiver, or from the background at all, because
   * camera is a while-in-use permission. Reopening the app is the earliest
   * moment surveillance can legally come back.
   * https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
   */
  resumeOnLaunch: boolean;
  /**
   * Whether the recordings ask who is opening them.
   *
   * Off by default. The footage never leaves the device, which protects it from
   * every other app and from the network — and not at all from whoever picks
   * the phone up off the table it was left on to watch the door. Whether that
   * is a threat is the owner's call, not this app's, so it is a switch.
   */
  lockHistory: boolean;
  night: boolean;
  person: boolean;
  animal: boolean;
  sens: Sensitivity;
  threshold: number;
  /** Cinematic auto-zoom: ease in on a detected person, whole, hold, then pull back to the scene. */
  autoZoom: boolean;
  /**
   * Let the app give up its own costs when the device stops keeping up with
   * the cadence "Sensibilité" asks for.
   *
   * On by default, and switchable off because it changes what the camera does
   * without being asked: a phone that never falls behind will never notice it,
   * and someone who would rather miss frames than lose the larger detector has
   * no other way to say so. Off gives back everything it had taken.
   */
  autoTune: boolean;
  /**
   * Run the detection model on the CPU, skipping the GPU delegate.
   *
   * A diagnostic, not a preference: the automatic fallback only catches a GPU
   * delegate that refuses to load the model, and one that loads it and then
   * returns nothing is indistinguishable from an empty room.
   */
  forceCpu: boolean;
  /**
   * Run the larger detector (EfficientDet-Lite2, 448 px) instead of the
   * default 320 px one.
   *
   * A real trade, not a "better" switch: roughly three times the inference cost
   * for a model that is markedly better at small subjects — which on a
   * surveillance camera is most of them. Opt-in because the cost lands on
   * whatever phone is doing the watching, and a device that cannot keep up
   * analyses fewer frames instead of saying so.
   */
  preciseDetection: boolean;
  /**
   * Where the camera watches, or `null` for the whole frame.
   *
   * The one filter that cuts false positives a threshold cannot: a phone on a
   * windowsill sees the street as well as the garden, and every passer-by is a
   * correct detection of somebody nobody asked about.
   */
  zone: DetectionZone | null;
  post: PostRoll;
  max: MaxDuration;
  quality: Quality;
  retention: Retention;
  autoDel: boolean;
  notif: boolean;
  notifDet: boolean;
  localStreamEnabled: boolean;
  localStreamPort: number;
  localStreamPin: string;
  exp: ExpandedSections;
}

/**
 * `autotune` is a screen rather than a row list, and is drawn by its own sheet
 * — it rides this union because it is opened and dismissed exactly like the
 * others, and two competing "which panel is up" states would be a way for both
 * to be up at once.
 */
export type InfoPanel = 'perms' | 'data' | 'licenses' | 'autotune' | null;
export type OnboardingStep = 'intro' | 'perms' | null;

/** Daily detection counter — the day is stored so it can reset at midnight. */
export interface DayCount {
  count: number;
  /** epoch ms of any moment during the counted day. */
  day: number;
}

export interface PersistedState {
  settings: Settings;
  events: DetectionEvent[];
  detToday: DayCount;
  lastDetAt: number | null;
  onboardingComplete: boolean;
}
