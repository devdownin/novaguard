import { ALERT_COOLDOWN_MS, alertContent, shouldAlert } from '../src/surveillance/alerts';

const ON = { notif: true, notifDet: true };

describe('shouldAlert', () => {
  const now = Date.UTC(2026, 4, 3, 14, 32);

  it('alerts on the first detection of a run', () => {
    expect(shouldAlert(ON, null, now)).toBe(true);
  });

  it('stays quiet while notifications are switched off entirely', () => {
    expect(shouldAlert({ notif: false, notifDet: true }, null, now)).toBe(false);
  });

  it('stays quiet when per-detection alerts alone are off', () => {
    expect(shouldAlert({ notif: true, notifDet: false }, null, now)).toBe(false);
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
