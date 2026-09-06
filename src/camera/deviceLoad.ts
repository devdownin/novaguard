/**
 * Why the phone is falling behind, as opposed to the fact that it is.
 *
 * The cadence measurement is a symptom, and two very different causes produce
 * it. A phone that is thermally throttled is temporarily slower than itself:
 * what the tuner gives up should come back, and a step that failed while the
 * device was hot says nothing about that step. A phone that simply cannot run
 * this model at this resolution is permanently slower: there, a step that
 * bought nothing has been answered, and retrying it costs capability for
 * nothing. Without this reading the loop cannot tell them apart.
 *
 * The battery is measured and shown, never acted on: dropping detection
 * quality because a charge is low would be the app deciding something the
 * owner of a surveillance camera gets to decide.
 */

import { t } from '../i18n';

/** `PowerManager.THERMAL_STATUS_*`, collapsed to what changes a decision. */
export type ThermalLevel = 'unknown' | 'nominal' | 'warm' | 'hot';

/** Android's own thresholds: NONE 0, LIGHT 1, MODERATE 2, SEVERE 3, CRITICAL 4+. */
export function thermalLevelOf(status: number): ThermalLevel {
  if (!Number.isFinite(status) || status < 0) return 'unknown';
  if (status <= 1) return 'nominal';
  return status <= 3 ? 'warm' : 'hot';
}

export interface DeviceLoad {
  thermal: ThermalLevel;
  /** Percentage, or null when the platform will not say. */
  battery: number | null;
  charging: boolean;
}

export const UNKNOWN_DEVICE_LOAD: DeviceLoad = {
  thermal: 'unknown', battery: null, charging: false,
};

export function deviceLoadOf(status: number, battery: number, charging: boolean): DeviceLoad {
  return {
    thermal: thermalLevelOf(status),
    battery: Number.isFinite(battery) && battery >= 0 && battery <= 100 ? battery : null,
    charging,
  };
}

/**
 * True where the device is slower than itself rather than slow.
 *
 * `unknown` is deliberately not in this set: most of the fleet reports nothing,
 * and treating silence as heat would stop the loop ever concluding anything.
 */
export function throttled(load: DeviceLoad): boolean {
  return load.thermal === 'warm' || load.thermal === 'hot';
}

/** What Setup shows. Nothing is invented: an unknown reading is left out. */
export function describeDeviceLoad(load: DeviceLoad): string {
  const parts: string[] = [];
  if (load.thermal !== 'unknown') parts.push(t(`deviceLoad.thermal.${load.thermal}`));
  if (load.battery != null) {
    parts.push(t(load.charging ? 'deviceLoad.battery.charging' : 'deviceLoad.battery', {
      percent: Math.round(load.battery),
    }));
  }
  return parts.length > 0 ? parts.join(' · ') : t('deviceLoad.unknown');
}
