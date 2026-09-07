/**
 * @format
 */

import {
  confirmedTracks,
  confirmedTracksIfChanged,
  DEFAULT_TRACKER_OPTIONS,
  iou,
  predictedBox,
  primaryTrack,
  resetTrackIds,
  sameVisibleTracks,
  Track,
  updateTracks,
} from '../src/ml/tracker';
import { FrameDetection } from '../src/ml/types';

const box = (x: number, y: number, w = 0.2, h = 0.4) => ({ x, y, width: w, height: h });
const person = (x: number, y = 0.3, confidence = 0.9): FrameDetection =>
  ({ kind: 'Personne', confidence, box: box(x, y) });
const animal = (x: number, confidence = 0.9): FrameDetection =>
  ({ kind: 'Animal', confidence, box: box(x, 0.3) });

beforeEach(resetTrackIds);

describe('iou', () => {
  it('is 1 for identical boxes', () => {
    expect(iou(box(0.1, 0.1), box(0.1, 0.1))).toBeCloseTo(1);
  });

  it('is 0 for disjoint boxes', () => {
    expect(iou(box(0, 0), box(0.9, 0.9))).toBe(0);
  });

  it('is between 0 and 1 for partial overlap', () => {
    const value = iou(box(0, 0), box(0.1, 0));
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });
});

describe('updateTracks', () => {
  it('creates an unconfirmed track on first sight', () => {
    const tracks = updateTracks([], [person(0.3)], 1000);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].confirmed).toBe(false);
    expect(confirmedTracks(tracks)).toHaveLength(0);
  });

  it('confirms only after the required streak — a one-frame blip never counts', () => {
    let tracks = updateTracks([], [person(0.3)], 1000);
    expect(confirmedTracks(tracks)).toHaveLength(0);

    // The blip vanishes instead of repeating. It is never confirmed, and once
    // the occlusion tolerance has elapsed in real time the track is let go.
    tracks = updateTracks(tracks, [], 1100);
    tracks = updateTracks(tracks, [], 1200);
    expect(confirmedTracks(tracks)).toHaveLength(0);

    tracks = updateTracks(tracks, [], 1000 + DEFAULT_TRACKER_OPTIONS.dropAfterMs);
    expect(tracks).toHaveLength(0);
  });

  it('confirms a subject that persists', () => {
    let tracks = updateTracks([], [person(0.3)], 1000);
    tracks = updateTracks(tracks, [person(0.31)], 1100);
    expect(confirmedTracks(tracks)).toHaveLength(1);
    expect(tracks[0].hits).toBe(2);
  });

  it('keeps one identity while the subject moves gradually', () => {
    let tracks = updateTracks([], [person(0.30)], 1000);
    const id = tracks[0].id;
    for (const x of [0.32, 0.34, 0.36, 0.38]) tracks = updateTracks(tracks, [person(x)], 1100);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(id);
  });

  it('survives a brief occlusion instead of splitting into two tracks', () => {
    let tracks = updateTracks([], [person(0.3)], 1000);
    tracks = updateTracks(tracks, [person(0.3)], 1100);
    const id = tracks[0].id;

    tracks = updateTracks(tracks, [], 1200);      // occluded
    tracks = updateTracks(tracks, [], 1300);
    expect(tracks).toHaveLength(1);

    tracks = updateTracks(tracks, [person(0.31)], 1400);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(id);
    expect(tracks[0].misses).toBe(0);
  });

  it('drops a track once it has been missing long enough', () => {
    let tracks = updateTracks([], [person(0.3)], 1000);
    tracks = updateTracks(tracks, [], 1000 + DEFAULT_TRACKER_OPTIONS.dropAfterMs - 1);
    expect(tracks).toHaveLength(1);
    tracks = updateTracks(tracks, [], 1000 + DEFAULT_TRACKER_OPTIONS.dropAfterMs);
    expect(tracks).toHaveLength(0);
  });

  it('tolerates occlusion for the same wall-clock time at any analysis rate', () => {
    // The tolerance used to be counted in frames, so "Basse" (1 fps) forgave a
    // 3 s gap while "Haute" (5 fps) gave up after 0.6 s — the sensitivity
    // setting silently rescaled it.
    const survivesAt = (interval: number) => {
      let tracks = updateTracks([], [person(0.3)], 0);
      tracks = updateTracks(tracks, [person(0.3)], interval);
      let t = interval;
      // Look again after a gap of just under the tolerance, at this rate.
      while (t < DEFAULT_TRACKER_OPTIONS.dropAfterMs - interval) {
        t += interval;
        tracks = updateTracks(tracks, [], t);
      }
      return tracks.length;
    };
    expect(survivesAt(1000)).toBe(1);   // Basse
    expect(survivesAt(333)).toBe(1);    // Moyenne
    expect(survivesAt(200)).toBe(1);    // Haute
  });

  it('keeps a confirmed subject on screen through a missed frame', () => {
    // The overlay reads confirmedTracks; requiring misses === 0 made the box
    // blink out on any single miss and started the recording's post-roll
    // against a subject the tracker had not given up on.
    let tracks = updateTracks([], [person(0.3)], 1000);
    tracks = updateTracks(tracks, [person(0.3)], 1100);
    expect(confirmedTracks(tracks)).toHaveLength(1);

    tracks = updateTracks(tracks, [], 1200);
    expect(tracks[0].misses).toBe(1);
    expect(confirmedTracks(tracks)).toHaveLength(1);
    expect(primaryTrack(tracks)).not.toBeNull();

    tracks = updateTracks(tracks, [person(0.31)], 1300);
    expect(confirmedTracks(tracks)).toHaveLength(1);
  });

  it('tracks several subjects at once', () => {
    let tracks = updateTracks([], [person(0.05), person(0.6)], 1000);
    tracks = updateTracks(tracks, [person(0.06), person(0.61)], 1100);
    expect(confirmedTracks(tracks)).toHaveLength(2);
    expect(new Set(tracks.map(t => t.id)).size).toBe(2);
  });

  it('never hands a track to a detection of another kind somewhere else', () => {
    let tracks = updateTracks([], [person(0.3)], 1000);
    const id = tracks[0].id;
    // Close enough that the same kind would have been matched on proximity,
    // which is exactly what must not happen across kinds: no overlap and no
    // shared label is another subject, however near it stands.
    tracks = updateTracks(tracks, [animal(0.55)], 1100);
    expect(tracks).toHaveLength(2);
    const dog = tracks.find(t => t.kind === 'Animal')!;
    expect(dog.id).not.toBe(id);
  });

  it('remembers the best confidence seen over the track\'s life', () => {
    let tracks = updateTracks([], [person(0.3, 0.3, 0.62)], 1000);
    tracks = updateTracks(tracks, [person(0.3, 0.3, 0.91)], 1100);
    tracks = updateTracks(tracks, [person(0.3, 0.3, 0.70)], 1200);
    expect(tracks[0].confidence).toBeCloseTo(0.70);
    expect(tracks[0].maxConfidence).toBeCloseTo(0.91);
  });
});

describe('the kind a track carries', () => {
  /** The same subject, read as an animal on this look and as a person on that one. */
  const seenAs = (kind: 'Personne' | 'Animal', confidence = 0.9) =>
    (kind === 'Personne' ? person(0.3, 0.3, confidence) : animal(0.3, confidence));

  it('stays one track when the detector changes its mind about a subject in place', () => {
    let tracks = updateTracks([], [seenAs('Personne')], 1000);
    const id = tracks[0].id;
    tracks = updateTracks(tracks, [seenAs('Personne')], 1100);
    tracks = updateTracks(tracks, [seenAs('Animal')], 1200);

    // The old behaviour: a second track, a second notification, and two
    // subjects reported where there is one.
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(id);
    expect(tracks[0].confirmed).toBe(true);
  });

  it('holds its label through a look or two of the other kind', () => {
    let tracks = updateTracks([], [seenAs('Personne')], 1000);
    tracks = updateTracks(tracks, [seenAs('Personne')], 1100);
    tracks = updateTracks(tracks, [seenAs('Animal')], 1200);
    expect(tracks[0].kind).toBe('Personne');
    tracks = updateTracks(tracks, [seenAs('Animal')], 1300);
    expect(tracks[0].kind).toBe('Personne');
  });

  it('flips the label once the other kind is clearly ahead, keeping the track', () => {
    let tracks = updateTracks([], [seenAs('Personne')], 1000);
    const id = tracks[0].id;
    tracks = updateTracks(tracks, [seenAs('Personne')], 1100);
    for (const at of [1200, 1300, 1400]) tracks = updateTracks(tracks, [seenAs('Animal')], at);

    expect(tracks[0].kind).toBe('Animal');
    expect(tracks[0].id).toBe(id);
  });

  // The case this is all for: a person at the far end of a garden read as a dog
  // on the looks that open the session. The label decided the notification and
  // the history entry, and used to be final.
  it('corrects a weak wrong label as soon as stronger looks disagree', () => {
    let tracks = updateTracks([], [seenAs('Animal', 0.62)], 1000);
    tracks = updateTracks(tracks, [seenAs('Animal', 0.6)], 1100);
    expect(tracks[0].kind).toBe('Animal');

    tracks = updateTracks(tracks, [seenAs('Personne', 0.9)], 1200);
    tracks = updateTracks(tracks, [seenAs('Personne', 0.92)], 1300);
    expect(tracks[0].kind).toBe('Personne');
  });

  it('weighs the recent looks, not every look the track has ever had', () => {
    let tracks = updateTracks([], [seenAs('Animal')], 1000);
    for (const at of [1100, 1200, 1300, 1400, 1500]) {
      tracks = updateTracks(tracks, [seenAs('Animal')], at);
    }
    // A long-standing animal is not permanently protected by its own history:
    // decay keeps the memory to about ten looks, so a subject that really is a
    // person from here on becomes one.
    for (const at of [1600, 1700, 1800, 1900, 2000, 2100]) {
      tracks = updateTracks(tracks, [seenAs('Personne')], at);
    }
    expect(tracks[0].kind).toBe('Personne');
  });

  it('shows the corrected label to the overlay', () => {
    let tracks = updateTracks([], [seenAs('Personne')], 1000);
    tracks = updateTracks(tracks, [seenAs('Personne')], 1100);
    const before = confirmedTracks(tracks);
    for (const at of [1200, 1300, 1400]) tracks = updateTracks(tracks, [seenAs('Animal')], at);

    // Same id, same box, same confidence: only the label changed, and the
    // overlay has to redraw for it.
    expect(sameVisibleTracks(before, confirmedTracks(tracks))).toBe(false);
  });
});

describe('primaryTrack', () => {
  it('is null when nothing is confirmed', () => {
    const tracks = updateTracks([], [person(0.3)], 1000);
    expect(primaryTrack(tracks)).toBeNull();
  });

  it('picks the most confident confirmed track', () => {
    let tracks = updateTracks([], [person(0.05, 0.3, 0.6), person(0.6, 0.3, 0.95)], 1000);
    tracks = updateTracks(tracks, [person(0.05, 0.3, 0.6), person(0.6, 0.3, 0.95)], 1100);
    expect(primaryTrack(tracks)!.confidence).toBeCloseTo(0.95);
  });

  it('keeps following its subject when the other is barely ahead', () => {
    // Two people standing still score within a few hundredths of each other and
    // each look reshuffles them. Following the winner of every look retargeted
    // the auto-zoom, and recomputed the capture crop, on subjects that had not
    // moved.
    const pair = (a: number, b: number) => [person(0.05, 0.3, a), person(0.6, 0.3, b)];
    let tracks = updateTracks([], pair(0.88, 0.86), 1000);
    tracks = updateTracks(tracks, pair(0.88, 0.86), 1100);
    const subject = primaryTrack(tracks)!;

    tracks = updateTracks(tracks, pair(0.85, 0.91), 1200);
    expect(primaryTrack(tracks, subject.id)!.id).toBe(subject.id);
  });

  it('hands the subject over when the other is clearly ahead', () => {
    let tracks = updateTracks([], [person(0.05, 0.3, 0.7), person(0.6, 0.3, 0.68)], 1000);
    tracks = updateTracks(tracks, [person(0.05, 0.3, 0.7), person(0.6, 0.3, 0.68)], 1100);
    const subject = primaryTrack(tracks)!;

    // Someone walks up to the camera while the first subject fades into the
    // background: that is a change of subject, not a wobble.
    for (const at of [1200, 1300, 1400]) {
      tracks = updateTracks(tracks, [person(0.05, 0.3, 0.45), person(0.6, 0.3, 0.95)], at);
    }
    expect(primaryTrack(tracks, subject.id)!.id).not.toBe(subject.id);
  });

  it('falls back to the best track once its subject is gone', () => {
    let tracks = updateTracks([], [person(0.6, 0.3, 0.9)], 1000);
    tracks = updateTracks(tracks, [person(0.6, 0.3, 0.9)], 1100);

    // An id no track carries any more — the subject left, and the pick must not
    // stay null while somebody else is in frame.
    expect(primaryTrack(tracks, 999)!.confidence).toBeCloseTo(0.9);
  });

  it('holds on to a confirmed track through a miss, and lets go once dropped', () => {
    // This used to assert the opposite. Going null on the first miss is what
    // made the overlay blink and started the post-roll early; the track is only
    // gone once updateTracks has actually dropped it.
    let tracks: Track[] = updateTracks([], [person(0.3)], 1000);
    tracks = updateTracks(tracks, [person(0.3)], 1100);
    tracks = updateTracks(tracks, [], 1200);
    expect(primaryTrack(tracks)).not.toBeNull();

    tracks = updateTracks(tracks, [], 1100 + DEFAULT_TRACKER_OPTIONS.dropAfterMs);
    expect(tracks).toHaveLength(0);
    expect(primaryTrack(tracks)).toBeNull();
  });
});

describe('sameVisibleTracks', () => {
  /** A track confirmed at `x`, as the overlay would receive it. */
  const shown = (x: number, confidence = 0.9) => {
    // Same id every time, so a comparison isolates the fields under test.
    resetTrackIds();
    const seen = [person(x, 0.3, confidence)];
    return confirmedTracks(updateTracks(updateTracks([], seen, 1000), seen, 1100));
  };

  it('holds for an unchanged list, whatever the array identity', () => {
    expect(sameVisibleTracks(shown(0.3), shown(0.3))).toBe(true);
    expect(sameVisibleTracks([], [])).toBe(true);
  });

  it('breaks as soon as a box moves', () => {
    expect(sameVisibleTracks(shown(0.3), shown(0.36))).toBe(false);
  });

  it('breaks when a subject joins or leaves', () => {
    expect(sameVisibleTracks(shown(0.1), [])).toBe(false);
  });

  // The label shows a whole percent, so a raw-float wobble under it changes no
  // pixel — treating it as a change would redraw the overlay on every frame a
  // subject stands still.
  it('ignores a confidence wobble too small to change the label', () => {
    expect(sameVisibleTracks(shown(0.3, 0.9012), shown(0.3, 0.9034))).toBe(true);
    expect(sameVisibleTracks(shown(0.3, 0.901), shown(0.3, 0.915))).toBe(false);
  });
});

describe('confirmedTracksIfChanged', () => {
  const confirm = (x: number, confidence = 0.9) => {
    resetTrackIds();
    const seen = [person(x, 0.3, confidence)];
    return updateTracks(updateTracks([], seen, 1000), seen, 1100);
  };

  it('returns the very same array when nothing moved', () => {
    const previous = confirmedTracks(confirm(0.3));
    // Identity, not equality: a new array is a new context value downstream.
    expect(confirmedTracksIfChanged(previous, confirm(0.3))).toBe(previous);
  });

  it('keeps an empty list empty without allocating a new one', () => {
    const empty: Track[] = [];
    expect(confirmedTracksIfChanged(empty, [])).toBe(empty);
    expect(confirmedTracksIfChanged(empty, updateTracks([], [person(0.3)], 1000))).toBe(empty);
  });

  it('rebuilds when a box moves', () => {
    const previous = confirmedTracks(confirm(0.3));
    const after = confirmedTracksIfChanged(previous, confirm(0.36));
    expect(after).not.toBe(previous);
    expect(after[0].box.x).toBeCloseTo(0.36);
  });

  it('rebuilds when a subject leaves, even though every survivor matched', () => {
    const previous = confirmedTracks(confirm(0.3));
    expect(confirmedTracksIfChanged(previous, [])).toEqual([]);
    expect(confirmedTracksIfChanged(previous, [])).not.toBe(previous);
  });

  it('rebuilds when a subject joins', () => {
    resetTrackIds();
    const two = [person(0.1), person(0.6)];
    const tracks = updateTracks(updateTracks([], two, 1000), two, 1100);
    const previous = confirmedTracks(confirm(0.1));
    expect(confirmedTracksIfChanged(previous, tracks)).toHaveLength(2);
  });

  it('agrees with confirmedTracks whenever it rebuilds', () => {
    const previous = confirmedTracks(confirm(0.3));
    const tracks = confirm(0.36);
    expect(confirmedTracksIfChanged(previous, tracks)).toEqual(confirmedTracks(tracks));
  });
});

describe('opening a track', () => {
  // The user's threshold is an entry gate now, not a filter on what the
  // detector reports: `interpretDetections` hands over everything above a low
  // floor so an open track can survive the weak looks a real subject produces.
  const weak = (x: number): FrameDetection =>
    ({ kind: 'Personne', confidence: 0.45, box: box(x, 0.3) });

  it('ignores a detection too weak to be trusted on its own', () => {
    expect(updateTracks([], [weak(0.3)], 1000)).toHaveLength(0);
  });

  it('keeps an open track alive on looks that could not have opened it', () => {
    // The whole point of the split. One gate at 0.6 turned a subject who
    // half-turned away into a subject who had left, ending the recording
    // mid-passage and writing the rest as a second event.
    let tracks = updateTracks([], [person(0.3)], 1000);
    tracks = updateTracks(tracks, [person(0.3)], 1100);
    const id = tracks[0].id;

    tracks = updateTracks(tracks, [weak(0.31)], 1200);
    tracks = updateTracks(tracks, [weak(0.32)], 1300);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(id);
    expect(tracks[0].misses).toBe(0);
    expect(confirmedTracks(tracks)).toHaveLength(1);
  });

  it('still remembers the best look, not the weak ones it survived on', () => {
    // The history event records this, so a passage seen clearly once must not
    // be filed under the 45% it scored while turning away.
    let tracks = updateTracks([], [person(0.3, 0.3, 0.88)], 1000);
    tracks = updateTracks(tracks, [weak(0.3)], 1100);
    expect(tracks[0].maxConfidence).toBeCloseTo(0.88);
  });

  it('follows the threshold it is given', () => {
    const strict = { ...DEFAULT_TRACKER_OPTIONS, startConfidence: 0.95 };
    expect(updateTracks([], [person(0.3, 0.3, 0.9)], 1000, strict)).toHaveLength(0);
    expect(updateTracks([], [person(0.3, 0.3, 0.96)], 1000, strict)).toHaveLength(1);
  });
});

describe('following a subject that moves', () => {
  /**
   * Overlap alone cannot follow anybody at these rates: at 3 fps a person
   * crossing the field of view moves further than their own width between
   * looks, so `iou` reads 0 and the track is abandoned — and its replacement
   * needs `confirmAfter` looks to be trusted, by which point it has moved
   * again. The app filmed people who stopped and missed people who walked past.
   */
  const walking = (x: number, confidence = 0.9): FrameDetection =>
    ({ kind: 'Personne', confidence, box: box(x, 0.3) });

  it('keeps one identity across a step wider than the subject', () => {
    let tracks = updateTracks([], [walking(0.1)], 1000);
    const id = tracks[0].id;
    // 0.25 per look, against a box 0.2 wide: no overlap at all.
    tracks = updateTracks(tracks, [walking(0.35)], 1333);
    expect(iou(box(0.1, 0.3), box(0.35, 0.3))).toBe(0);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(id);
    expect(confirmedTracks(tracks)).toHaveLength(1);
  });

  it('confirms a subject crossing the frame instead of restarting on every look', () => {
    let tracks: Track[] = [];
    let t = 0;
    for (const x of [0.05, 0.3, 0.55, 0.8]) {
      t += 333;
      tracks = updateTracks(tracks, [walking(x)], t);
    }
    expect(tracks).toHaveLength(1);
    expect(tracks[0].hits).toBe(4);
    expect(confirmedTracks(tracks)).toHaveLength(1);
  });

  it('reaches further once it knows which way the subject is going', () => {
    // Velocity is what makes the second half of a passage cheaper to follow
    // than the first: the gate is centred on where the subject should be.
    let tracks = updateTracks([], [walking(0.05)], 0);
    tracks = updateTracks(tracks, [walking(0.3)], 333);
    tracks = updateTracks(tracks, [walking(0.55)], 666);
    expect(tracks[0].vx).toBeGreaterThan(0);

    const predicted = predictedBox(tracks[0], 999);
    expect(predicted.x).toBeGreaterThan(0.55);
    expect(predicted.x).toBeLessThanOrEqual(0.8);
  });

  it('follows a step it would refuse from a subject it knows nothing about', () => {
    // The prediction is not just a nicety on top of the proximity gate: it
    // moves the gate to where the subject is going. A box 0.2 x 0.4 reaches
    // one diagonal, 0.447; this step is 0.50 from where the subject last was
    // and only 0.375 from where it was heading.
    let moving = updateTracks([], [walking(0.05)], 0);
    moving = updateTracks(moving, [walking(0.30)], 333);
    const id = moving[0].id;
    moving = updateTracks(moving, [walking(0.80)], 666);
    expect(moving).toHaveLength(1);
    expect(moving[0].id).toBe(id);

    // The same step, from a subject seen only once, is a different subject:
    // nothing says it went that way rather than any other.
    let standing = updateTracks([], [walking(0.30)], 333);
    standing = updateTracks(standing, [walking(0.80)], 666);
    expect(standing).toHaveLength(2);
  });

  it('predicts nothing for a subject that has only been seen once', () => {
    const tracks = updateTracks([], [walking(0.3)], 1000);
    expect(predictedBox(tracks[0], 2000)).toEqual(tracks[0].box);
  });

  it('draws the subject where it was seen, never where it was predicted', () => {
    // A prediction on screen is the app drawing a person where nobody is.
    let tracks = updateTracks([], [walking(0.05)], 0);
    tracks = updateTracks(tracks, [walking(0.3)], 333);
    tracks = updateTracks(tracks, [], 666);
    expect(tracks[0].box.x).toBeCloseTo(0.3);
  });

  it('refuses a box of a wildly different size, however close it lands', () => {
    // Two subjects at different depths crossing paths: the far one must not
    // inherit the near one's track just because their centres coincide.
    let tracks = updateTracks([], [walking(0.4)], 1000);
    const far: FrameDetection = {
      kind: 'Personne', confidence: 0.9, box: { x: 0.44, y: 0.38, width: 0.04, height: 0.08 },
    };
    tracks = updateTracks(tracks, [far], 1100);
    expect(tracks).toHaveLength(2);
  });

  it('refuses a box beyond any distance a subject could have travelled', () => {
    let tracks = updateTracks([], [walking(0.05)], 1000);
    const id = tracks[0].id;
    tracks = updateTracks(tracks, [walking(0.9)], 1100);
    expect(tracks).toHaveLength(2);
    expect(tracks.find(t => t.box.x === 0.9)!.id).not.toBe(id);
  });

  it('prefers a real overlap to a nearer box the prediction only reaches', () => {
    // Greedy association takes the best score first, and an overlap must
    // outrank every proximity match whatever their distances. A third of a
    // second apart, so the far box is genuinely within reach and the choice is
    // a choice — at 100 ms nothing could have gone that far and there would be
    // nothing to prefer.
    let tracks = updateTracks([], [walking(0.3)], 1000);
    tracks = updateTracks(tracks, [walking(0.32), walking(0.55)], 1333);
    const continued = tracks.find(t => t.hits === 2)!;
    expect(continued.box.x).toBeCloseTo(0.32);
  });

  it('follows a walker at one look per second, where the whole step is the reach', () => {
    // The reach is a speed, not a distance per look. As a flat diagonal it was
    // right at 3 fps and a third of what it should be at "Basse" (1 fps) — and
    // a fresh track has no velocity, so its predicted box is its last one and
    // the whole step has to fit. Someone walking briskly across the frame was
    // therefore a new track on every look, never confirmed, never filmed.
    let tracks = updateTracks([], [walking(0.05)], 1000);
    const id = tracks[0].id;
    tracks = updateTracks(tracks, [walking(0.55)], 2000);

    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(id);
    expect(confirmedTracks(tracks)).toHaveLength(1);
  });

  it('refuses that same step when it is a fifth of a second, not a second', () => {
    // Half the frame in 200 ms is nobody walking; the pair is what pins the
    // reach to elapsed time rather than to the number of looks.
    let tracks = updateTracks([], [walking(0.05)], 1000);
    tracks = updateTracks(tracks, [walking(0.55)], 1200);
    expect(tracks).toHaveLength(2);
  });
});
