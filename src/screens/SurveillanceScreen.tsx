import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, MAX_FONT_SCALE } from '../theme';
import { useAppState } from '../state/AppStateContext';
import { formatBytes } from '../recording/library';
import { formatWhen } from '../utils/date';
import { useLandscape } from '../utils/useLandscape';
import { t } from '../i18n';
import { Viewfinder } from '../components/Viewfinder';

/**
 * The camera screen, in the two shapes a surveillance phone is actually left in.
 *
 * Portrait stacks: title, viewfinder, controls. Landscape cannot — the header
 * and the controls together are ~180 dp of a ~360 dp window, so stacking left
 * the viewfinder a letterbox on the one orientation where a phone propped
 * against something is most likely to spend its days. Everything that is not
 * the picture moves into a column beside it instead, and the viewfinder gets
 * the whole height.
 */
export function SurveillanceScreen() {
  const {
    monitoring, toggleMonitoring, lastDetAt, detToday, storage: store,
    events, selectEvent, setTab, setFilter, setPeriod, cameraHealth,
  } = useAppState();
  // "Surveillance active" over a camera another app has taken is the one lie
  // this screen can tell; the pill says which of the three states it is in.
  const interrupted = monitoring && cameraHealth === 'interrupted';
  const landscape = useLandscape();

  // Each counter answers a question, and the answer was a dead end: "last
  // detection, 08:42" is read as "what was it?", and getting there meant the
  // history tab, then finding the card, then opening it. Events are newest
  // first, so the last detection is the first of them. Nothing leads anywhere
  // it would land empty — no event, no press.
  const openLast = events.length > 0 ? () => selectEvent(events[0].id) : undefined;
  const openToday = detToday > 0 ? () => {
    setFilter('Toutes');
    setPeriod("Aujourd'hui");
    setTab('hist');
  } : undefined;
  const openStorage = () => setTab('setup');

  const brand = (
    <View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.brand}>NOVAGUARD</Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.brandSub}>{t('surv.tagline')}</Text>
    </View>
  );

  const statusPill = (
    <View
      style={[
        styles.statusPill,
        {
          borderColor: interrupted ? color.neutral700 : monitoring ? color.accent700 : color.neutral800,
          backgroundColor: monitoring && !interrupted ? color.accent900 : 'transparent',
        },
      ]}
    >
      <View
        style={[
          styles.statusDot,
          { backgroundColor: interrupted ? color.neutral400 : monitoring ? color.accent : color.neutral600 },
        ]}
      />
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[
          styles.statusLabel,
          { color: interrupted ? color.neutral300 : monitoring ? color.accent200 : color.neutral500 },
        ]}
      >
        {t(interrupted ? 'surv.status.interrupted' : monitoring ? 'surv.status.on' : 'surv.status.off')}
      </Text>
    </View>
  );

  const cta = (
    <Pressable
      onPress={toggleMonitoring}
      accessibilityRole="button"
      accessibilityState={{ selected: monitoring }}
      // A press has to register before the state changes. This is the button
      // the whole app is for, and it was the only one in the file with no
      // pressed state at all — `OutlineButton` has had one all along.
      style={({ pressed }) => [
        styles.cta,
        {
          backgroundColor: monitoring ? 'transparent' : color.accent900,
          borderColor: monitoring ? color.neutral700 : color.accent,
          opacity: pressed ? 0.72 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <Text style={[styles.ctaLabel, { color: monitoring ? color.neutral200 : color.accent200 }]}>
        {t(monitoring ? 'surv.cta.stop' : 'surv.cta.start')}
      </Text>
    </Pressable>
  );

  // Three cells side by side in a 232 dp column would each get ~75 dp, which is
  // narrower than the longest label — so they turn into rows there.
  const stats = (
    <View style={[styles.statsRow, landscape && styles.statsColumn]}>
      <StatCell
        label={t('surv.stat.last')}
        // The instant, not a bare clock time: "14:32" read two days later still
        // claimed the detection was at 14:32, with nothing to say which day.
        value={lastDetAt == null ? '—' : formatWhen(lastDetAt)}
        landscape={landscape}
        onPress={openLast}
        hint={t('a11y.stat.last')}
      />
      <StatCell
        label={t('surv.stat.today')}
        value={detToday}
        landscape={landscape}
        onPress={openToday}
        hint={t('a11y.stat.today')}
      />
      <StatCell
        label={t('surv.stat.space')}
        value={formatBytes(store.free)}
        landscape={landscape}
        onPress={openStorage}
        hint={t('a11y.stat.space')}
      />
    </View>
  );

  if (landscape) {
    return (
      <View style={styles.screenLandscape}>
        <View style={styles.viewfinderSlot}>
          <Viewfinder />
        </View>
        <View style={styles.aside}>
          {brand}
          {statusPill}
          <View style={styles.asideSpacer} />
          {cta}
          {stats}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {brand}
        {statusPill}
      </View>

      <Viewfinder />

      <View style={styles.controls}>
        {cta}
        {stats}
      </View>
    </View>
  );
}

/**
 * A counter, and where it leads. Without `onPress` it is what it always was —
 * a figure — which is also what it must stay when following it would land on
 * an empty screen.
 */
function StatCell({ label, value, landscape, onPress, hint }: {
  label: string;
  value: string | number;
  landscape: boolean;
  onPress?: () => void;
  hint?: string;
}) {
  const body = (
    <>
      <Text style={styles.statLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>{label}</Text>
      <Text
        style={[styles.statValue, landscape && styles.statValueInline]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        {value}
      </Text>
    </>
  );

  if (!onPress) {
    return <View style={[styles.statCell, landscape && styles.statCellRow]}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The label and the figure stay the name — a reader hears "Dernière,
      // aujourd'hui 08:42" and then what pressing it does.
      accessibilityHint={hint}
      style={({ pressed }) => [
        styles.statCell,
        landscape && styles.statCellRow,
        pressed && styles.statCellPressed,
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenLandscape: {
    flex: 1,
    flexDirection: 'row',
    paddingBottom: 10,
  },
  viewfinderSlot: {
    flex: 1,
    paddingVertical: 10,
  },
  aside: {
    width: 232,
    paddingRight: 14,
    paddingLeft: 4,
    paddingTop: 12,
    gap: 10,
  },
  // Pushes the button and the counters to the bottom of the column, where a
  // thumb holding the phone sideways already is.
  asideSpacer: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  brand: {
    fontFamily: font.semibold,
    fontSize: 15,
    letterSpacing: 2.1,
    color: color.text,
  },
  brandSub: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 0.6,
    color: color.neutral500,
    marginTop: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    paddingVertical: 5,
    paddingLeft: 9,
    paddingRight: 11,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusLabel: { fontFamily: font.medium, fontSize: 11 },
  controls: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 6,
    gap: 12,
  },
  cta: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  ctaLabel: {
    fontFamily: font.semibold,
    fontSize: 13.5,
    letterSpacing: 1.4,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 1,
    backgroundColor: color.divider,
    borderRadius: 10,
    overflow: 'hidden',
  },
  statsColumn: {
    flexDirection: 'column',
  },
  statCell: {
    flex: 1,
    backgroundColor: color.surface,
    paddingVertical: 10,
    paddingHorizontal: 11,
  },
  statCellPressed: {
    backgroundColor: color.neutral900,
  },
  statCellRow: {
    flex: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  statLabel: {
    fontFamily: font.regular,
    fontSize: 9.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: color.neutral500,
  },
  statValue: {
    fontFamily: font.medium,
    fontSize: 14,
    color: color.text,
    marginTop: 3,
    fontVariant: ['tabular-nums'],
  },
  statValueInline: {
    marginTop: 0,
  },
});
