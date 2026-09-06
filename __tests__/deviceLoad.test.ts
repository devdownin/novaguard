/**
 * Why the phone is behind, as opposed to the fact that it is.
 *
 * Two causes produce the same collapsed cadence and call for opposite
 * conclusions: a throttled phone is temporarily slower than itself, and what
 * the tuner took should come back; a phone that cannot run this model at this
 * resolution never will, and a step that bought nothing has been answered.
 * Silence — most of the fleet — must read as neither.
 *
 * @format
 */

import {
  describeDeviceLoad, deviceLoadOf, thermalLevelOf, throttled, UNKNOWN_DEVICE_LOAD,
} from '../src/camera/deviceLoad';

describe('the thermal reading', () => {
  it('follows Android’s own thresholds', () => {
    // NONE 0, LIGHT 1, MODERATE 2, SEVERE 3, CRITICAL 4, EMERGENCY 5, SHUTDOWN 6.
    expect(thermalLevelOf(0)).toBe('nominal');
    expect(thermalLevelOf(1)).toBe('nominal');
    expect(thermalLevelOf(2)).toBe('warm');
    expect(thermalLevelOf(3)).toBe('warm');
    expect(thermalLevelOf(4)).toBe('hot');
    expect(thermalLevelOf(6)).toBe('hot');
  });

  it('reads a device that will not answer as unknown, not as cool', () => {
    expect(thermalLevelOf(-1)).toBe('unknown');
    expect(thermalLevelOf(NaN)).toBe('unknown');
  });

  it('never counts silence as heat', () => {
    // Most phones report nothing. Treating that as throttling would stop the
    // loop ever concluding that a device is simply too slow.
    expect(throttled(UNKNOWN_DEVICE_LOAD)).toBe(false);
    expect(throttled(deviceLoadOf(0, 50, false))).toBe(false);
    expect(throttled(deviceLoadOf(2, 50, false))).toBe(true);
    expect(throttled(deviceLoadOf(5, 50, false))).toBe(true);
  });
});

describe('the battery reading', () => {
  it('keeps a percentage and drops anything that is not one', () => {
    // The property answers Integer.MIN_VALUE on a device that does not report
    // it, which must not be shown as a charge.
    expect(deviceLoadOf(0, 42, true).battery).toBe(42);
    expect(deviceLoadOf(0, -1, false).battery).toBeNull();
    expect(deviceLoadOf(0, 137, false).battery).toBeNull();
  });
});

describe('what Setup shows', () => {
  it('leaves out what the device did not say', () => {
    expect(describeDeviceLoad(deviceLoadOf(-1, -1, false)))
      .toBe('L’appareil ne rapporte ni température ni batterie');
    expect(describeDeviceLoad(deviceLoadOf(-1, 80, false))).toBe('Batterie 80 %');
  });

  it('names the heat and the charge together', () => {
    const line = describeDeviceLoad(deviceLoadOf(4, 30, true));

    expect(line).toContain('surchauffe');
    expect(line).toContain('30 %');
    expect(line).toContain('en charge');
  });
});
