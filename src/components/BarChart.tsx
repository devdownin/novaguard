import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, font, MAX_FONT_SCALE } from '../theme';

/**
 * A bar per measurement, oldest on the left.
 *
 * Views and nothing else: a charting library would be a dependency added for
 * one diagnostic screen, and every native one in this project has cost a build
 * (see the toolchain notes in CLAUDE.md). What it has to draw is sixty
 * rectangles.
 *
 * Two decisions the maths carries. The slots are fixed, so a log with four
 * samples in it draws four narrow bars at the left rather than four fat ones
 * across the screen — a chart that rescales as it fills reads as data that
 * changed. And a zero is drawn as a stub rather than as nothing: "the value
 * was zero here" and "there is no measurement here" are different statements,
 * and a chart that renders both as blank space makes them the same.
 */
export const CHART_HEIGHT = 44;
/** Tall enough to be seen as a bar, short enough not to be read as a value. */
export const MIN_BAR_HEIGHT = 2;
/**
 * The unfilled slots that hold the bar width until the log fills. Exported
 * because it is what tells a drawn bar from a placeholder — on screen, and in
 * the test that counts them.
 */
export const SLOT_COLOR = color.neutral900;

export function barHeights(
  values: readonly number[],
  max: number,
  height: number = CHART_HEIGHT,
): number[] {
  if (!(max > 0)) return values.map(() => MIN_BAR_HEIGHT);
  return values.map(value => {
    const clamped = Math.min(Math.max(value, 0), max);
    return Math.max(MIN_BAR_HEIGHT, Math.round((clamped / max) * height));
  });
}

interface BarChartProps {
  values: readonly number[];
  /** Top of the scale. Values above it are drawn full height, never taller. */
  max: number;
  /** How many bars fit, so a partly filled log keeps its bars the same width. */
  slots: number;
  /** Bar colour, by position. One colour for all of them by default. */
  colorAt?: (index: number) => string;
  /**
   * What a screen reader is given. The bars themselves are hidden from it: a
   * reader announcing sixty unlabelled views is worse than one sentence.
   */
  accessibilityLabel: string;
  /** Drawn under the bars, at each end of the series. */
  startLabel?: string;
  endLabel?: string;
}

export function BarChart({
  values, max, slots, colorAt, accessibilityLabel, startLabel, endLabel,
}: BarChartProps) {
  const heights = barHeights(values, max);
  const empty = Math.max(0, slots - values.length);

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <View style={styles.plot} importantForAccessibility="no-hide-descendants">
        {heights.map((barHeight, index) => (
          <View
            key={index}
            style={[
              styles.bar,
              { height: barHeight, backgroundColor: colorAt ? colorAt(index) : color.accent },
            ]}
          />
        ))}
        {/* Placeholders, so the bars keep their width until the log fills. */}
        {Array.from({ length: empty }, (unused, index) => (
          <View key={`empty-${index}`} style={styles.slot} />
        ))}
      </View>
      {(startLabel || endLabel) && (
        <View style={styles.axis} importantForAccessibility="no-hide-descendants">
          <Text style={styles.axisLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>{startLabel}</Text>
          <Text style={styles.axisLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>{endLabel}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  plot: {
    height: CHART_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  bar: {
    flex: 1,
    borderRadius: 1.5,
    minWidth: 2,
  },
  slot: {
    flex: 1,
    height: MIN_BAR_HEIGHT,
    borderRadius: 1.5,
    backgroundColor: SLOT_COLOR,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  axisLabel: {
    fontFamily: font.regular,
    fontSize: 10,
    color: color.neutral600,
  },
});
