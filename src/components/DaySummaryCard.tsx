import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, MAX_FONT_SCALE } from '../theme';
import { DaySummary } from '../recording/daySummary';
import { formatTimeOfDay } from '../utils/date';
import { t, tn } from '../i18n';
import { BarChart } from './BarChart';

/**
 * Today, before the list: how many passages, the last one, and when in the day
 * they fell. Pressing it narrows the list to today.
 */
export function DaySummaryCard({ summary, onPress }: { summary: DaySummary; onPress: () => void }) {
  const { count, lastAt, perHour } = summary;
  const peak = Math.max(...perHour);
  const now = new Date().getHours();
  const line = count === 0
    ? t('hist.today.none')
    : lastAt == null
      ? tn('hist.passages.other', count)
      : t('hist.today.line', { passages: tn('hist.passages.other', count), time: formatTimeOfDay(lastAt) });
  return (
    <Pressable
      testID="day-summary"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={t('hist.today.hint')}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.title}>{t('hist.today.title')}</Text>
      <Text style={styles.line}>{line}</Text>
      <View style={styles.chart}>
        <BarChart
          values={perHour}
          max={Math.max(1, peak)}
          slots={24}
          // The current hour lit, the hours with a passage in the accent, the rest dim.
          colorAt={hour => (hour === now ? color.watching : perHour[hour] > 0 ? color.accent : color.neutral800)}
          accessibilityLabel={t('hist.today.chart', { count })}
          startLabel={t('hist.today.start')}
          endLabel={t('hist.today.end')}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 12,
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    borderLeftColor: 'rgba(255,255,255,0.03)',
    borderRightColor: 'rgba(255,255,255,0.03)',
    borderBottomColor: 'transparent',
  },
  pressed: { opacity: 0.75 },
  title: {
    fontFamily: font.medium,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: color.neutral500,
  },
  line: {
    fontFamily: font.semibold,
    fontSize: 16,
    color: color.text,
    marginTop: 3,
  },
  chart: { marginTop: 10 },
});
