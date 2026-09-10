/**
 * Where the system font size is allowed to stretch this app, and where it is not.
 *
 * `MAX_FONT_SCALE` says it in prose already: body text scales without a cap —
 * refusing to scale at all is the accessibility anti-pattern — and the cap
 * bounds only the places where a label shares a pinned box with something else
 * and would push it off screen at 2×. The prose was all there was, so the cap
 * had reached six files out of twenty: the viewfinder chips and the tab labels
 * had it, the detection labels drawn over a subject's own box, the two-column
 * grid of the detail sheet and every label/value row of Réglages did not.
 *
 * Checked against the source rather than a render, for the same reason as
 * `touchFeedback`: what has to be true is a property of the JSX, and a layout
 * this dense would need a device to fail on.
 *
 * The two halves are what "pinned" means here, and neither can be inferred:
 *  - some files are nothing *but* chrome — a chip, a tab, a control — so every
 *    string in them is a label in a fixed box;
 *  - elsewhere the pinned containers are named, because the same style serves
 *    both jobs one screen apart: `subLabel` heads a paragraph in one section of
 *    Réglages and shares the threshold's row with its percentage in the next.
 * A cap outside these lists is nobody's mistake — it is a judgement this test
 * does not make. A missing one inside them is.
 *
 * @format
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parse } from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import generate from '@babel/generator';

const SRC = resolve(__dirname, '..', 'src');

/** Files that draw only chrome: every string in them sits in a fixed box. */
const CHROME = [
  'components/BarChart.tsx',
  'components/DetectionOverlay.tsx',
  'components/LiveClock.tsx',
  'components/PeriodDropdown.tsx',
  'components/SegmentedControl.tsx',
  'components/SetupRows.tsx',
  'components/TabBar.tsx',
  'components/ZoneLayer.tsx',
];

/**
 * Elsewhere: the pinned boxes, named by their style.
 *
 * A container's name covers everything drawn inside it — but only where the
 * JSX says so. A screen that assembles its parts into consts first, as the
 * camera screen does with its header and its counters, or that hands them to a
 * component of its own, breaks that chain; there the labels themselves are
 * named instead.
 */
const PINNED: Record<string, string[]> = {
  'components/AutoTuneSheet.tsx': ['cardHead'],
  'components/EventCard.tsx': ['thumb'],
  'components/OnboardingModal.tsx': ['stepBadge', 'permRow'],
  'components/VideoDetailSheet.tsx': ['cell'],
  'components/Viewfinder.tsx': ['overlayChip', 'recChip', 'coverageChip', 'zoomChip', 'errorChip'],
  'screens/HistoryScreen.tsx': ['header'],
  'screens/SetupScreen.tsx': ['thresholdRow', 'storageStatsRow'],
  'screens/SurveillanceScreen.tsx': ['brand', 'brandSub', 'statusLabel', 'statLabel', 'statValue'],
};

interface TextNode {
  line: number;
  capped: boolean;
  /** The pinned container it sits in, if any of the ones asked about. */
  pinnedBy: string | null;
}

function textsOf(file: string, pinned: string[] = []): TextNode[] {
  const code = readFileSync(resolve(SRC, file), 'utf8');
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const found: TextNode[] = [];

  traverse(ast, {
    JSXOpeningElement(path) {
      const node = path.node;
      if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'Text') return;
      const capped = node.attributes.some(
        a => a.type === 'JSXAttribute' && a.name.name === 'maxFontSizeMultiplier',
      );

      // Its own style first, then the nearest ancestor drawn with a pinned one.
      const own = node.attributes.find(
        a => a.type === 'JSXAttribute' && a.name.name === 'style',
      );
      const ownSource = own && own.type === 'JSXAttribute' && own.value ? generate(own.value).code : '';
      let pinnedBy: string | null =
        pinned.find(name => new RegExp(`styles\\.${name}\\b`).test(ownSource)) ?? null;

      for (let up: NodePath | null = path.parentPath; up && !pinnedBy; up = up.parentPath) {
        if (up.node.type !== 'JSXElement') continue;
        const style = up.node.openingElement.attributes.find(
          a => a.type === 'JSXAttribute' && a.name.name === 'style',
        );
        if (!style || style.type !== 'JSXAttribute' || !style.value) continue;
        const source = generate(style.value).code;
        pinnedBy = pinned.find(name => new RegExp(`styles\\.${name}\\b`).test(source)) ?? null;
      }

      found.push({ line: node.loc!.start.line, capped, pinnedBy });
    },
  });

  return found;
}

describe('the font-scale cap', () => {
  it.each(CHROME)('bounds every label %s draws', file => {
    const uncapped = textsOf(file).filter(text => !text.capped).map(text => text.line);
    expect(uncapped).toEqual([]);
  });

  it.each(Object.keys(PINNED))('bounds what %s draws inside a pinned box', file => {
    const inside = textsOf(file, PINNED[file]).filter(text => text.pinnedBy !== null);

    // The list is a claim about the file as well as about the cap: a container
    // renamed out from under it would leave this passing over nothing.
    expect(inside.length).toBeGreaterThanOrEqual(PINNED[file].length);
    expect(inside.filter(text => !text.capped).map(text => text.line)).toEqual([]);
  });

  it('leaves the flowing text alone', () => {
    // The other half of the rule, and the one a zealous sweep would break: a
    // paragraph, an empty state or a dialog's body has room to grow, and
    // someone who asked their phone for big text is asking for exactly this.
    const flowing = [
      ['components/ConfirmDialog.tsx', 'body'],
      ['components/InfoSheet.tsx', 'note'],
      ['screens/HistoryScreen.tsx', 'emptyBody'],
      ['screens/SetupScreen.tsx', 'privacyText'],
    ] as const;

    for (const [file, style] of flowing) {
      const code = readFileSync(resolve(SRC, file), 'utf8');
      const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
      let seen = 0;
      traverse(ast, {
        JSXOpeningElement(path) {
          const node = path.node;
          if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'Text') return;
          const attrs = node.attributes.filter(a => a.type === 'JSXAttribute');
          const styled = attrs.some(
            a => a.name.name === 'style' && a.value && new RegExp(`styles\\.${style}\\b`).test(generate(a.value).code),
          );
          if (!styled) return;
          seen++;
          expect(attrs.some(a => a.name.name === 'maxFontSizeMultiplier')).toBe(false);
        },
      });
      expect(seen).toBeGreaterThan(0);
    }
  });
});
