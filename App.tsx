/**
 * NovaGuard — caméra intelligente de surveillance
 * @format
 */

import React, { useCallback, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { color } from './src/theme';
import { AppStateProvider, useAppState } from './src/state/AppStateContext';
import { SurveillanceScreen } from './src/screens/SurveillanceScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { TabBar } from './src/components/TabBar';
import { VideoDetailSheet } from './src/components/VideoDetailSheet';
import { InfoSheet } from './src/components/InfoSheet';
import { AutoTuneSheet } from './src/components/AutoTuneSheet';
import { McpServicesSheet } from './src/components/McpServicesSheet';
import { McpConnectSheet } from './src/components/McpConnectSheet';
import { OnboardingModal } from './src/components/OnboardingModal';
import { ConfirmDialog } from './src/components/ConfirmDialog';
import { SplashOverlay, SplashScreen } from './src/components/SplashScreen';
import { useLandscape } from './src/utils/useLandscape';
import { t, tn } from './src/i18n';

function AppShell() {
  const {
    hydrated, tab, confirmDelete, cancelDelete, doDelete,
    confirmWipe, cancelWipe, doWipe, events, pendingBulkDelete, cancelDeleteMany, doDeleteMany,
  } = useAppState();
  const landscape = useLandscape();

  const [launchedAt] = useState(Date.now);
  const [splashUp, setSplashUp] = useState(true);
  const hideSplash = useCallback(() => setSplashUp(false), []);

  if (!hydrated) {
    return <SplashScreen />;
  }

  // Landscape puts the nav on the left and the screen beside it, so the tab
  // bar stops eating the short axis. Order in the tree is order on screen.
  return (
    <View style={styles.root}>
      {/* Hidden from the screen reader while the splash covers it: TalkBack
          would otherwise walk controls nobody can see. */}
      <View
        style={[styles.root, landscape && styles.rootLandscape]}
        importantForAccessibility={splashUp ? 'no-hide-descendants' : 'auto'}
      >
        <LinearGradient
          testID="app-backdrop"
          colors={[color.bgTop, color.bg, color.bgBottom]}
          locations={[0, 0.4, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* A faint accent light from the top, so the ground is not a flat slab. */}
        <LinearGradient
          colors={['rgba(155,140,255,0.10)', 'rgba(155,140,255,0)']}
          style={styles.halo}
          pointerEvents="none"
        />
        {landscape && <TabBar />}
        <View style={styles.screenArea}>
          {tab === 'cam' && <SurveillanceScreen />}
          {tab === 'hist' && <HistoryScreen />}
          {tab === 'setup' && <SetupScreen />}
        </View>
        {!landscape && <TabBar />}

        <VideoDetailSheet />
        <InfoSheet />
        <AutoTuneSheet />
        <McpServicesSheet />
        <McpConnectSheet />
        <OnboardingModal />

        <ConfirmDialog
          visible={confirmDelete}
          title={t('confirm.delete.title')}
          body={t('confirm.delete.body')}
          confirmLabel={t('confirm.delete.ok')}
          onCancel={cancelDelete}
          onConfirm={doDelete}
        />
        <ConfirmDialog
          visible={pendingBulkDelete != null}
          title={t('confirm.many.title')}
          body={tn('confirm.many.body.other', pendingBulkDelete?.length ?? 0)}
          confirmLabel={t('confirm.delete.ok')}
          onCancel={cancelDeleteMany}
          onConfirm={doDeleteMany}
        />
        <ConfirmDialog
          visible={confirmWipe}
          title={t('confirm.wipe.title')}
          body={tn('confirm.wipe.body.other', events.length)}
          confirmLabel={t('confirm.wipe.ok')}
          onCancel={cancelWipe}
          onConfirm={doWipe}
        />
      </View>
      {splashUp && <SplashOverlay launchedAt={launchedAt} onDone={hideSplash} />}
    </View>
  );
}

function App() {
  return (
    // `initialMetrics` lets the first paint use insets the native side already
    // knows, instead of withholding the whole tree until an onLayout round-trip
    // reports them — one less blank frame between the launch screen and the app.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      {/* No `backgroundColor`: under the edge-to-edge display this SDK level
          enforces, the system bars are always transparent and React Native
          ignores the prop. The strip behind the status bar is painted by the
          SafeAreaView below instead. */}
      <StatusBar barStyle="light-content" translucent />
      {/* `left`/`right` for landscape: a display cutout sits on one of the
          short sides once the phone is turned, and without them the brand row
          and the tab rail run underneath it. Both insets are 0 in portrait. */}
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <AppStateProvider>
          <AppShell />
        </AppStateProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  // The strip behind the status bar continues the backdrop's top colour.
  safeArea: {
    flex: 1,
    backgroundColor: color.bgTop,
  },
  root: {
    flex: 1,
    backgroundColor: color.bg,
  },
  halo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  rootLandscape: {
    flexDirection: 'row',
  },
  screenArea: {
    flex: 1,
  },
});

export default App;
