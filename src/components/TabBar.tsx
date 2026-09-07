import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, MAX_FONT_SCALE } from '../theme';
import { Tab } from '../state/types';
import { useAppState } from '../state/AppStateContext';
import { useLandscape } from '../utils/useLandscape';
import { StringKey, t } from '../i18n';
import { CameraIcon, HistoryIcon, SetupIcon } from './icons';

const TABS: { key: Tab; labelKey: StringKey; Icon: typeof CameraIcon }[] = [
  { key: 'cam', labelKey: 'tab.cam', Icon: CameraIcon },
  { key: 'hist', labelKey: 'tab.hist', Icon: HistoryIcon },
  { key: 'setup', labelKey: 'tab.setup', Icon: SetupIcon },
];

/**
 * Material 3 style nav: pill indicator behind the active tab's icon.
 *
 * A bottom bar in landscape spends ~60 dp of the short axis — the one axis the
 * viewfinder has none of when the phone is on its side. It becomes a left rail
 * there instead, which spends width, of which there is plenty.
 */
export function TabBar() {
  const { tab, setTab, monitoring, det } = useAppState();
  const insets = useSafeAreaInsets();
  const landscape = useLandscape();

  return (
    <View
      style={[
        styles.bar,
        landscape ? styles.rail : styles.bottomBar,
        // The gesture bar stays at the bottom of the window in landscape, so
        // the rail keeps its own clearance; the side cutout is handled by the
        // app's safe area, one level up.
        landscape ? { paddingBottom: insets.bottom } : { paddingBottom: Math.max(10, insets.bottom) },
      ]}
    >
      {TABS.map(({ key, labelKey, Icon }) => {
        const active = tab === key;
        const tint = active ? color.accent : color.neutral600;
        // Recording is a state of the app, not of the camera screen, and it was
        // only ever drawn there: from Historique or Réglages — where somebody
        // reviewing what was filmed spends their time — a passage being filmed
        // right now was invisible. Hollow while the camera is merely watching,
        // filled while a clip is being written.
        const watching = key === 'cam' && monitoring;
        const recording = watching && det != null;
        return (
          <Pressable
            key={key}
            onPress={() => setTab(key)}
            style={({ pressed }) => [
              landscape ? styles.railItem : styles.item,
              pressed && styles.itemPressed,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={watching
              ? t(recording ? 'a11y.tab.recording' : 'a11y.tab.watching', { name: t(labelKey) })
              : undefined}
          >
            <View style={[styles.pill, { backgroundColor: active ? color.accent900 : 'transparent' }]}>
              <Icon size={22} color={tint} />
              {watching && (
                <View style={[styles.liveDot, recording && styles.liveDotOn]} pointerEvents="none" />
              )}
            </View>
            <Text style={[styles.label, { color: tint }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {t(labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Android's ripple does not reach a `Pressable` styled like this one, so the
  // feedback has to be drawn: without it a tab that is already selected reads
  // as a tap that did nothing.
  itemPressed: { opacity: 0.6 },
  bar: {
    backgroundColor: 'rgba(22,24,38,0.94)',
  },
  bottomBar: {
    flexDirection: 'row',
    gap: 2,
    paddingTop: 9,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: color.divider,
  },
  rail: {
    flexDirection: 'column',
    justifyContent: 'center',
    width: 74,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRightWidth: 1,
    borderRightColor: color.divider,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  // No `flex` on the rail: three items sharing the height would push the
  // labels to the far corners of the screen instead of grouping them.
  railItem: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 11,
  },
  pill: {
    width: 62,
    height: 31,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveDot: {
    position: 'absolute',
    top: 4,
    right: 14,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    borderWidth: 1,
    borderColor: color.accent,
    backgroundColor: 'transparent',
  },
  liveDotOn: {
    backgroundColor: color.accent,
  },
  label: {
    fontFamily: font.regular,
    fontSize: 10.5,
    letterSpacing: 0.1,
  },
});
