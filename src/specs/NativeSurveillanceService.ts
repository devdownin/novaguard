import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /**
   * Promotes the app to a foreground service of type camera (plus microphone
   * when that permission is held), so Android keeps the process alive and
   * allows camera access while the app is not on screen.
   */
  start(title: string, body: string): void;
  stop(): void;
  isRunning(): boolean;
  /**
   * Why the last start was refused, or '' if it went through.
   *
   * The service starts asynchronously on its own stack, so a failure there
   * cannot come back as a thrown error on the call that asked for it.
   */
  lastError(): string;

  /**
   * Posts (or replaces) the detection alert. One reusable notification rather
   * than a stack: the app's own Historique screen is the record, so a pile of
   * system notifications would only be noise.
   */
  notifyDetection(title: string, body: string): void;
  dismissDetection(): void;

  /**
   * Hands one recorded clip to another app through a chooser.
   *
   * Returns false when there was nothing to share — a file the retention sweep
   * has already reclaimed — or when Android refused to raise a chooser, so the
   * UI can say so rather than looking like it did nothing.
   */
  shareRecording(path: string): boolean;

  /**
   * Decodes a still from `clipPath` and writes it beside the clip, resolving
   * with the JPEG's path or '' when there was no readable frame.
   *
   * The backstop for the case `takeSnapshot` cannot cover: a snapshot is a
   * screenshot of the preview view, and there is no preview to screenshot with
   * the screen off — which is most of what a surveillance phone does. This
   * reads the file instead, so it works whatever the screen was doing.
   *
   * A promise: it opens and parses the container. It never rejects, because a
   * clip with no picture is a state the history already draws.
   */
  extractThumbnail(clipPath: string): Promise<string>;

  /**
   * Android's own thermal reading for the device, as
   * `PowerManager.THERMAL_STATUS_*` (0 none … 6 shutdown), or -1 where the
   * platform will not answer.
   *
   * The self-tuning loop otherwise only sees the symptom — a cadence that
   * collapsed — and cannot tell a phone that is throttling from one that was
   * always too slow. The two call for opposite conclusions: throttling passes,
   * so what it took should be given back; a phone that cannot keep up never
   * will, so it should not be tried again.
   */
  thermalStatus(): number;
  /** Battery charge as a percentage, or -1 when the platform will not say. */
  batteryLevel(): number;
  isCharging(): boolean;

  /**
   * Whether this device can confirm who is holding it — a fingerprint, a face,
   * or failing those the screen lock itself.
   *
   * False on a phone with no lock set up at all, where the history lock would
   * be a switch that protects nothing: the setting says so rather than
   * pretending.
   */
  canConfirmIdentity(): boolean;

  /**
   * Asks the device to confirm the person holding it, resolving true when it
   * did.
   *
   * Never rejects: a cancelled prompt, a fingerprint that does not match and a
   * device that changed its mind about being able to ask are the same answer
   * here — the history stays shut. The screen lock is accepted alongside
   * biometrics, so a phone whose owner has a PIN and no fingerprint is not
   * locked out of their own recordings.
   */
  confirmIdentity(title: string, subtitle: string): Promise<boolean>;

  /**
   * Opens Android's own settings page for the detection channel. Since Android
   * 8 the platform — not the app — owns whether a channel makes sound or
   * vibrates, so this is the only honest place to send someone who wants to
   * change that.
   */
  openDetectionChannelSettings(): void;
}

// `get` rather than `getEnforcing`: this returns null under Jest, where there
// is no native side, and the wrapper in ../surveillance/foregroundService.ts
// degrades to a no-op instead of taking the whole app down with it.
export default TurboModuleRegistry.get<Spec>('SurveillanceService');
