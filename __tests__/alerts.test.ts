import { ALERT_COOLDOWN_MS, alertContent, inQuietHours, passageIdFromUrl, shouldAlert } from '../src/surveillance/alerts';

const ON = { notif: true, notifDet: true, quietHours: false, quietStart: 22, quietEnd: 7 };

describe('shouldAlert', () => {
  const now = Date.UTC(2026, 4, 3, 14, 32);

  it('alerts on the first detection of a run', () => {
    expect(shouldAlert(ON, null, now)).toBe(true);
  });

  it('stays quiet while notifications are switched off entirely', () => {
    expect(shouldAlert({ ...ON, notif: false }, null, now)).toBe(false);
  });

  it('stays quiet when per-detection alerts alone are off', () => {
    expect(shouldAlert({ ...ON, notifDet: false }, null, now)).toBe(false);
  });

  it('holds back a second alert inside the cooldown', () => {
    expect(shouldAlert(ON, now - 1_000, now)).toBe(false);
    expect(shouldAlert(ON, now - (ALERT_COOLDOWN_MS - 1), now)).toBe(false);
  });

  it('alerts again once the cooldown has elapsed', () => {
    expect(shouldAlert(ON, now - ALERT_COOLDOWN_MS, now)).toBe(true);
    expect(shouldAlert(ON, now - 10 * ALERT_COOLDOWN_MS, now)).toBe(true);
  });

  it('does not alert on a cooldown it has not reached, even for a new kind', () => {
    // The cooldown is about not turning the phone into a buzzer; which animal
    // or person triggered it does not change that.
    expect(shouldAlert(ON, now - 5_000, now)).toBe(false);
  });
});

describe('quiet hours', () => {
  // Local hours: the suite runs under TZ=Europe/Paris, where these are not UTC.
  const at = (hour: number, minute = 0) => new Date(2026, 4, 3, hour, minute).getTime();
  const QUIET = { ...ON, quietHours: true };

  it('holds the alert back across midnight, from the start hour to the end hour', () => {
    expect(shouldAlert(QUIET, null, at(22))).toBe(false);
    expect(shouldAlert(QUIET, null, at(2, 30))).toBe(false);
    expect(shouldAlert(QUIET, null, at(6, 59))).toBe(false);
  });

  it('alerts outside the window, the end hour included', () => {
    expect(shouldAlert(QUIET, null, at(7))).toBe(true);
    expect(shouldAlert(QUIET, null, at(14))).toBe(true);
    expect(shouldAlert(QUIET, null, at(21, 59))).toBe(true);
  });

  it('alerts at any hour while the switch is off, whatever the window says', () => {
    expect(shouldAlert(ON, null, at(2))).toBe(true);
  });

  it('reads a window that does not wrap midnight', () => {
    expect(inQuietHours(9, 18, at(12))).toBe(true);
    expect(inQuietHours(9, 18, at(8))).toBe(false);
    expect(inQuietHours(9, 18, at(18))).toBe(false);
  });

  it('treats a window that starts where it ends as empty, not as the whole day', () => {
    // Silencing every alert is what the master switch is for; a slider left
    // on the same hour twice must not do it quietly.
    for (const hour of [0, 7, 13, 23]) expect(inQuietHours(7, 7, at(hour))).toBe(false);
  });
});

describe('alertContent', () => {
  it('names the kind and pads the time', () => {
    const at = new Date(2026, 4, 3, 9, 5).getTime();
    expect(alertContent('Personne', at)).toEqual({
      title: 'Personne détectée',
      body: 'À 09:05 · enregistrement en cours',
    });
  });

  it('distinguishes an animal', () => {
    const at = new Date(2026, 4, 3, 22, 41).getTime();
    expect(alertContent('Animal', at)).toEqual({
      title: 'Animal détecté',
      body: 'À 22:41 · enregistrement en cours',
    });
  });
});

describe('passageIdFromUrl', () => {
  it('reads the passage the native alert links to', () => {
    expect(passageIdFromUrl('novaguard://passage/1760000000000-3-abc12345')).toBe('1760000000000-3-abc12345');
    expect(passageIdFromUrl('novaguard://passage/a%20b')).toBe('a b');
  });
  it('ignores anything else', () => {
    for (const url of [null, undefined, '', 'novaguard://passage/', 'https://passage/x', 'novaguard://passage/x/y',
      'novaguard://other/x', 'novaguard://passage/%E0%A4%A']) {
      expect(passageIdFromUrl(url)).toBeNull();
    }
  });
});
