/**
 * What "Sensibilité" sets, now that it sets more than one thing.
 *
 * The three values trade against each other, and the trade is the point: give
 * up the second look, ask a higher score for the first. A test that checked
 * them one at a time would let a future edit keep both halves of a bargain
 * pointing the same way — which is how the setting came to mean nothing but
 * battery at one end and a lost second of every passage at the other.
 *
 * @format
 */

import { SENSITIVITY_PROFILES, trackerOptionsFor } from '../src/ml/sensitivity';
import { DEFAULT_TRACKER_OPTIONS, updateTracks } from '../src/ml/tracker';
import { Sensitivity } from '../src/state/types';
import { FrameDetection } from '../src/ml/types';

const ALL: Sensitivity[] = ['Basse', 'Moyenne', 'Haute'];
const person = (confidence: number): FrameDetection =>
  ({ kind: 'Personne', confidence, box: { x: 0.3, y: 0.3, width: 0.2, height: 0.4 } });

describe('the profiles', () => {
  it('looks more often as the setting rises', () => {
    expect(ALL.map(s => SENSITIVITY_PROFILES[s].fps)).toEqual([1, 3, 5]);
  });

  it('never asks for corroboration it cannot afford', () => {
    // What corroboration costs is the wait *after* the subject was first seen:
    // `confirmAfter - 1` further looks. At 1 fps, asking for one of those is a
    // whole second of the passage, every time — so at that rate it is not
    // asked for at all.
    for (const s of ALL) {
      const { fps, confirmAfter } = SENSITIVITY_PROFILES[s];
      expect((confirmAfter - 1) / fps).toBeLessThanOrEqual(0.4);
    }
  });

  it('pays for a look it gave up with a score, and never both at once', () => {
    // The bargain: fewer looks, higher bar. Dropping both would turn one bad
    // frame into a recording.
    for (const s of ALL) {
      const { confirmAfter, startConfidenceBonus } = SENSITIVITY_PROFILES[s];
      if (confirmAfter < DEFAULT_TRACKER_OPTIONS.confirmAfter) {
        expect(startConfidenceBonus).toBeGreaterThan(0);
      }
    }
  });
});

describe('trackerOptionsFor', () => {
  it('turns the slider percentage into the tracker\'s entry gate', () => {
    expect(trackerOptionsFor('Moyenne', 60).startConfidence).toBeCloseTo(0.6);
  });

  it('asks more of a single look at the lowest rate, and less at the highest', () => {
    expect(trackerOptionsFor('Basse', 60).startConfidence)
      .toBeGreaterThan(trackerOptionsFor('Moyenne', 60).startConfidence);
    expect(trackerOptionsFor('Haute', 60).startConfidence)
      .toBeLessThan(trackerOptionsFor('Moyenne', 60).startConfidence);
  });

  it('never puts the gate out of a detection\'s reach', () => {
    // At "Basse" the top of the slider would ask for 1.05, which nothing can
    // score: the sensitivity setting would silently switch detection off.
    for (const s of ALL) {
      for (const threshold of [50, 75, 95]) {
        const { startConfidence } = trackerOptionsFor(s, threshold);
        expect(startConfidence).toBeGreaterThanOrEqual(0);
        expect(startConfidence).toBeLessThanOrEqual(1);
      }
    }
    expect(trackerOptionsFor('Basse', 95).startConfidence).toBe(1);
  });

  it('confirms on the first look at the lowest rate, and on the second elsewhere', () => {
    // Through the tracker rather than the record, so the profile is checked
    // against what it actually does.
    const seen = (s: Sensitivity) =>
      updateTracks([], [person(0.95)], 1000, trackerOptionsFor(s, 60))[0].confirmed;
    expect(seen('Basse')).toBe(true);
    expect(seen('Moyenne')).toBe(false);
    expect(seen('Haute')).toBe(false);
  });

  it('leaves everything the setting has no business changing alone', () => {
    const options = trackerOptionsFor('Haute', 60);
    expect(options.iouThreshold).toBe(DEFAULT_TRACKER_OPTIONS.iouThreshold);
    expect(options.dropAfterMs).toBe(DEFAULT_TRACKER_OPTIONS.dropAfterMs);
    expect(options.maxTravelPerSecond).toBe(DEFAULT_TRACKER_OPTIONS.maxTravelPerSecond);
  });
});
