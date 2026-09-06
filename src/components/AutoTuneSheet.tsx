import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { color, font, MAX_FONT_SCALE } from '../theme';
import { useAppState } from '../state/AppStateContext';
import { FRAME_RATE_WINDOW_MS, formatFrameRate } from '../camera/frameRate';
import { AUTO_TUNE_LADDER, AutoTuneStep, HEADROOM_RATIO, SHORTFALL_RATIO } from '../camera/autoTune';
import {
  AUTO_TUNE_LOG_SIZE, AutoTuneSample, cadenceSeries, currentTarget, meanCadence, readSamples,
  StepState, stepSeries, stepUptime,
} from '../camera/autoTuneLog';
import { Sheet } from './Sheet';
import { BarChart } from './BarChart';
import { t, tValue } from '../i18n';

/**
 * Every parameter the app moves on its own, with the series behind it.
 *
 * Read by polling rather than pushed: a sample lands every
 * {@link FRAME_RATE_WINDOW_MS}, on the frame path, and publishing that through
 * the provider would re-render the whole app twice a second to move a bar —
 * the exact cost `ViewfinderProvider` exists to avoid. The interval runs only
 * while the sheet is open, and stops with it.
 *
 * The charts share one time axis, so a bar in the cadence chart and the bar
 * under it in a parameter's chart are the same two seconds. That is the whole
 * point of the screen: seeing that the auto-zoom went away *where* the cadence
 * collapsed, and whether anything came back after it.
 */
const BAR_COLOURS: Record<StepState, string> = {
  on: color.accent,
  given: color.neutral500,
  off: color.neutral800,
};

/** A given-up step is drawn short, not absent: absent would mean "not measured". */
const STEP_VALUES: Record<StepState, number> = { on: 1, given: 0.2, off: 0.2 };

function cadenceColour(sample: AutoTuneSample): string {
  if (!(sample.target > 0)) return color.neutral600;
  const ratio = sample.measured / sample.target;
  if (ratio >= HEADROOM_RATIO) return color.accent;
  return ratio < SHORTFALL_RATIO ? color.accent700 : color.accent500;
}

function pastLabel(windows: number): string {
  const seconds = Math.round((windows * FRAME_RATE_WINDOW_MS) / 1000);
  return seconds >= 60
    ? t('autoTune.axis.past.min', { count: Math.round(seconds / 60) })
    : t('autoTune.axis.past.s', { count: seconds });
}

function stateOf(step: AutoTuneStep, series: StepState[], blocked: boolean): string {
  const last = series.length > 0 ? series[series.length - 1] : 'on';
  if (last === 'on' && blocked) return t('autoTune.state.blocked');
  return t(`autoTune.state.${last}`);
}

export function AutoTuneSheet() {
  const { info, closeInfo, autoTune, autoTuneLog } = useAppState();
  const open = info === 'autotune';

  const [samples, setSamples] = useState<AutoTuneSample[]>([]);
  const refresh = useCallback(() => {
    setSamples(autoTuneLog.current ? readSamples(autoTuneLog.current) : []);
  }, [autoTuneLog]);

  useEffect(() => {
    if (!open) return;
    // Once on opening, so the screen is never blank while the first window of
    // its own lifetime closes.
    refresh();
    const timer = setInterval(refresh, FRAME_RATE_WINDOW_MS);
    return () => clearInterval(timer);
  }, [open, refresh]);

  const cadence = cadenceSeries(samples);
  const target = currentTarget(samples);
  const latest = cadence.length > 0 ? cadence[cadence.length - 1] : 0;
  // Scaled to the target rather than to the tallest bar: the question this
  // chart answers is "does it reach what was asked for", which a chart
  // normalised to its own maximum always answers yes to.
  const scale = Math.max(target, ...cadence, 1);

  return (
    <Sheet visible={open} onClose={closeInfo} maxHeightPercent={82}>
      <Text style={styles.title}>{t('autoTune.screen.title')}</Text>
      <Text style={styles.intro}>{t('autoTune.screen.intro')}</Text>

      {samples.length === 0 ? (
        <Text style={styles.empty}>{t('autoTune.screen.empty')}</Text>
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{t('autoTune.chart.cadence')}</Text>
              <Text style={styles.cardValue}>{formatFrameRate(latest)}</Text>
            </View>
            <BarChart
              values={cadence}
              max={scale}
              slots={AUTO_TUNE_LOG_SIZE}
              colorAt={index => cadenceColour(samples[index])}
              accessibilityLabel={t('autoTune.chart.cadence.a11y', {
                count: samples.length,
                last: formatFrameRate(latest),
                mean: formatFrameRate(meanCadence(samples)),
                target: formatFrameRate(target),
              })}
              startLabel={pastLabel(samples.length)}
              endLabel={t('autoTune.axis.now')}
            />
            <View style={styles.stats}>
              <Stat label={t('autoTune.stat.last')} value={formatFrameRate(latest)} />
              <Stat label={t('autoTune.stat.mean')} value={formatFrameRate(meanCadence(samples))} />
              <Stat label={t('autoTune.stat.target')} value={formatFrameRate(target)} />
            </View>
          </View>

          {AUTO_TUNE_LADDER.map(step => {
            const series = stepSeries(step, samples);
            const uptime = stepUptime(step, samples);
            const name = tValue(`value.autoTune.${step}`);
            const state = stateOf(step, series, autoTune.blocked.includes(step));
            return (
              <View key={step} style={styles.card} testID={`autotune-${step}`}>
                <View style={styles.cardHead}>
                  <Text style={styles.cardTitle}>{name}</Text>
                  <Text style={styles.cardValue}>{state}</Text>
                </View>
                <BarChart
                  values={series.map(value => STEP_VALUES[value])}
                  max={1}
                  slots={AUTO_TUNE_LOG_SIZE}
                  colorAt={index => BAR_COLOURS[series[index]]}
                  accessibilityLabel={t('autoTune.chart.step.a11y', {
                    name, state, on: uptime.on, total: uptime.total,
                  })}
                />
                <Text style={styles.note}>
                  {t('autoTune.uptime', { on: uptime.on, total: uptime.total })}
                </Text>
              </View>
            );
          })}

          <Text style={styles.footer}>
            {t('autoTune.window', { seconds: FRAME_RATE_WINDOW_MS / 1000 })}
          </Text>
        </>
      )}
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>{label}</Text>
      <Text style={styles.statValue} maxFontSizeMultiplier={MAX_FONT_SCALE}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: font.semibold,
    fontSize: 17,
    color: color.text,
    marginBottom: 6,
  },
  intro: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.neutral500,
    marginBottom: 14,
  },
  empty: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.neutral500,
    paddingVertical: 18,
  },
  card: {
    backgroundColor: color.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.divider,
    padding: 12,
    marginBottom: 10,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
    gap: 8,
  },
  cardTitle: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.text,
    flexShrink: 1,
  },
  cardValue: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.accent,
  },
  stats: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 10,
  },
  stat: {
    flex: 1,
  },
  statLabel: {
    fontFamily: font.regular,
    fontSize: 10,
    color: color.neutral600,
  },
  statValue: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.text,
    marginTop: 1,
  },
  note: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.neutral600,
    marginTop: 8,
  },
  footer: {
    fontFamily: font.regular,
    fontSize: 10,
    color: color.neutral600,
    marginTop: 2,
    marginBottom: 6,
  },
});
