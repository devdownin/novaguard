import AsyncStorage from '@react-native-async-storage/async-storage';
import { DayCount, DetectionEvent, Settings } from './types';

/**
 * `events` and `detToday` are versioned keys.
 *
 * v1 events had a `size: string` computed from a made-up bitrate and no file on
 * disk, and v1 `detToday` was a bare number that never reset. Reading either
 * shape back would show invented data as if it were real, so the new keys let
 * the old values fall away instead of being migrated.
 */
const KEYS = {
  settings: '@novaguard:settings',
  events: '@novaguard:events:v2',
  detToday: '@novaguard:detToday:v2',
  lastDetAt: '@novaguard:lastDetAt',
  monitoring: '@novaguard:monitoring',
  onboardingComplete: '@novaguard:onboardingComplete',
  frameStage: '@novaguard:frameStage',
  autoTune: '@novaguard:autotune:v1',
} as const;

// '@novaguard:perms' held simulated mic/notification grants; all three
// permissions are real OS state now, so the key has no meaning any more.
// `lastDet` held a bare "14:32", which cannot age: read back two days later it
// still claimed the detection was at 14:32, with no way to tell which day. The
// instant is stored now and formatted at render.
const STALE_KEYS = ['@novaguard:events', '@novaguard:detToday', '@novaguard:perms', '@novaguard:lastDet'];

/** Best-effort removal of the superseded keys so they don't sit there forever. */
export async function dropStaleKeys(): Promise<void> {
  try {
    // AsyncStorage v3 dropped the batch `multiRemove` from its public API.
    await Promise.all(STALE_KEYS.map(k => AsyncStorage.removeItem(k)));
  } catch {
    // Not worth surfacing: the data is unreachable either way.
  }
}

/**
 * Bytes a string occupies once encoded as UTF-8.
 *
 * `String.length` counts UTF-16 code units, which undercounts every accent and
 * halves nothing at all for an emoji. The clips are named after what triggered
 * them and live at paths the user's locale can shape, so the difference is real
 * rather than theoretical — and this figure is shown to the user as the size of
 * what NovaGuard keeps.
 */
export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A surrogate pair is one character in four bytes; skip its second half.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** What NovaGuard keeps in AsyncStorage, split the way the user is shown it. */
export interface StoredSize {
  /** The detection history. */
  journal: number;
  /** Settings, counters and flags — everything else. */
  settings: number;
}

export const EMPTY_STORED_SIZE: StoredSize = { journal: 0, settings: 0 };

async function readJson<T>(key: string): Promise<T | null> {
  return (await readJsonChecked<T>(key)).value;
}

/**
 * A read that says whether it worked.
 *
 * `readJson` collapses "never written" and "could not be read" into the same
 * `null`, which is fine for a setting — the default takes over — and dangerous
 * for the event list: the startup sweep deletes every clip on disk that no
 * event points at, so an unreadable history reads as an empty one and takes
 * the user's recordings with it. Callers that can destroy something use this.
 */
async function readJsonChecked<T>(key: string): Promise<{ ok: boolean; value: T | null }> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return { ok: true, value: raw ? (JSON.parse(raw) as T) : null };
  } catch {
    return { ok: false, value: null };
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort: local persistence is a convenience, not a correctness requirement
  }
}

export const storage = {
  /**
   * Measures what is actually on disk, rather than describing it.
   *
   * The panel this feeds used to carry two hardcoded figures — including a
   * thumbnail cache for a feature that does not exist anywhere in this
   * repository. A screen that exists to tell the user what is kept about them
   * is the last place to invent numbers.
   *
   * A key that cannot be read contributes nothing instead of failing the count:
   * an unreadable value is a figure we do not have, not a reason to show none.
   */
  measure: async (): Promise<StoredSize> => {
    const size = async (key: string) => {
      try {
        const raw = await AsyncStorage.getItem(key);
        return raw ? utf8Bytes(raw) : 0;
      } catch {
        return 0;
      }
    };
    const [journal, ...rest] = await Promise.all([
      size(KEYS.events),
      ...Object.entries(KEYS).filter(([name]) => name !== 'events').map(([, key]) => size(key)),
    ]);
    return { journal, settings: rest.reduce((sum, n) => sum + n, 0) };
  },

  loadSettings: () => readJson<Settings>(KEYS.settings),
  saveSettings: (v: Settings) => writeJson(KEYS.settings, v),

  /**
   * `ok` is false when the key exists but could not be read or parsed. Nothing
   * may be deleted or overwritten on that answer — see `readJsonChecked`.
   */
  loadEvents: () => readJsonChecked<DetectionEvent[]>(KEYS.events),
  saveEvents: (v: DetectionEvent[]) => writeJson(KEYS.events, v),

  loadDetToday: () => readJson<DayCount>(KEYS.detToday),
  saveDetToday: (v: DayCount) => writeJson(KEYS.detToday, v),

  loadLastDetAt: () => readJson<number>(KEYS.lastDetAt),
  saveLastDetAt: (v: number) => writeJson(KEYS.lastDetAt, v),

  loadMonitoring: () => readJson<boolean>(KEYS.monitoring),
  saveMonitoring: (v: boolean) => writeJson(KEYS.monitoring, v),

  loadOnboardingComplete: () => readJson<boolean>(KEYS.onboardingComplete),
  saveOnboardingComplete: (v: boolean) => writeJson(KEYS.onboardingComplete, v),

  /**
   * The native call the frame processor was inside, written before making it.
   *
   * Survives the process because that is the point: the failures this records
   * do not let the app write anything on the way down. It is cleared the moment
   * a frame makes it through, so finding one at launch means the previous
   * session died mid-analysis.
   */
  /**
   * What the self-tuning loop had given up, per recording quality.
   *
   * Not settings: the user's choices are never written from here (see
   * `autoTune.ts`). This is the app's own reading of the phone, kept so a
   * device that could not hold 4K yesterday does not re-pay six seconds of
   * degraded detection to learn it again — and re-verified from the first
   * window, so a phone that has cooled down or been given a lighter format
   * gets everything back.
   *
   * Typed loosely on purpose: what comes back off disk is whatever an older
   * version wrote, and the ladder has already gained a step. `seedFrom` is
   * where it becomes a state, and it drops anything it does not recognise.
   */
  loadAutoTuneSeeds: () => readJson<Record<string, string[]>>(KEYS.autoTune),
  saveAutoTuneSeeds: (v: Record<string, string[]>) => writeJson(KEYS.autoTune, v),

  loadFrameStage: () => readJson<string>(KEYS.frameStage),
  saveFrameStage: (v: string) => writeJson(KEYS.frameStage, v),
  clearFrameStage: async () => {
    try {
      await AsyncStorage.removeItem(KEYS.frameStage);
    } catch {
      // A stale stage only costs a message that is one launch out of date.
    }
  },
};
