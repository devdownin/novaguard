/**
 * What the palette is legible against.
 *
 * The accessibility pass in this repo fixed roles, names and font scaling, and
 * left the colours alone — so the app still drew its 11 pt secondary text at
 * 3.5:1 and its switch borders at 2.7:1, both below what WCAG asks. Neither is
 * visible in a screenshot review on a good screen in a dark room, which is
 * exactly where this design gets looked at; it shows up on a phone propped on a
 * windowsill in daylight, and in Play's pre-launch report.
 *
 * So the ratios are asserted rather than eyeballed, and against the grounds the
 * text is *actually* drawn on rather than against one nominal background: this
 * app has three (`bg`, `surface`, and the viewfinder's standby gradient), and a
 * colour that clears AA on the lightest fails on the darkest.
 *
 * The pairs below are a decision record, like the licence list: adding a use of
 * a neutral means adding its pair here, and a retune of the design system that
 * reintroduces the problem fails this file instead of shipping.
 *
 * @format
 */

import { color } from '../src/theme';

/** WCAG relative luminance of an `#rrggbb` string. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/**
 * The lightest stop of the viewfinder's standby gradient — the worst case for
 * anything drawn over it, and where the "grant the camera" message lives.
 */
const STANDBY = '#20232f';

/** WCAG AA: 4.5 for body text, 3.0 for large text and for non-text controls. */
const AA_TEXT = 4.5;
const AA_LARGE = 3;

describe('the ratios the maths is built on', () => {
  it('agrees with the two ends of the scale', () => {
    // A luminance formula with a wrong exponent still ranks colours plausibly,
    // so every assertion below would pass on a broken one.
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrast(color.bg, color.bg)).toBeCloseTo(1, 5);
  });
});

describe('text', () => {
  const cases: [string, string, string][] = [
    ['body text on the app ground', color.text, color.bg],
    ['body text on a card', color.text, color.surface],
    ['secondary text on the app ground', color.neutral500, color.bg],
    ['secondary text on a card', color.neutral500, color.surface],
    // `neutral600` carries the event card's meta line, the empty-history line,
    // the setting subtitles and the inactive tab labels — all 9.5–11 pt.
    ['tertiary text on the app ground', color.neutral600, color.bg],
    ['tertiary text on a card', color.neutral600, color.surface],
    ['the standby message over the viewfinder', color.neutral500, STANDBY],
    ['the accent, used for values and active labels', color.accent, color.bg],
    ['the CTA label on its own fill', color.accent200, color.accent900],
  ];

  it.each(cases)('clears AA: %s', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('controls and edges', () => {
  // Non-text: a switch you cannot find is as unusable as a label you cannot
  // read, and 3:1 is what WCAG asks of the parts that make a control visible.
  const cases: [string, string, string][] = [
    ['a switch in its off state, on the app ground', color.neutral700, color.bg],
    ['a switch in its off state, on a card', color.neutral700, color.surface],
    ['the sheet handle', color.neutral700, color.surface],
    ['an active tab icon', color.accent, color.bg],
    ['an inactive tab icon', color.neutral600, color.bg],
  ];

  it.each(cases)('clears AA for non-text: %s', (_name, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe('the neutral ramp', () => {
  it('still runs light to dark after the two corrections', () => {
    // Raising a token to clear a threshold is easy; raising it past its
    // neighbour turns the ramp into a jumble, and every component that picks a
    // neutral by feel starts lying about hierarchy.
    const ramp = [
      color.neutral100, color.neutral200, color.neutral300, color.neutral400,
      color.neutral500, color.neutral600, color.neutral700, color.neutral800,
      color.neutral900,
    ].map(luminance);
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeLessThan(ramp[i - 1]);
  });
});
