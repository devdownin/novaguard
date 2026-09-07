/**
 * What the tab bar says while the camera is working.
 *
 * The REC chip and the detection badge live in the viewfinder, which is the one
 * screen a phone left on surveillance is *not* showing when somebody picks it
 * up to review what was filmed: from Historique or Réglages, a passage being
 * recorded right now was invisible, and so was the fact that the camera was
 * watching at all. The tab that owns the camera now carries both states.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermission } from 'react-native-vision-camera';
import * as fs from '@dr.pogodin/react-native-fs';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { TabBar } from '../src/components/TabBar';
import { color } from '../src/theme';
import { FrameDetection } from '../src/ml/types';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

const mockFs = fs as jest.Mocked<typeof fs>;
const permission = useCameraPermission as jest.Mock;

type Handle = { state: ReturnType<typeof useAppState>; renderer: ReactTestRenderer.ReactTestRenderer };

const person = (): FrameDetection =>
  ({ kind: 'Personne', confidence: 0.9, box: { x: 0.3, y: 0.3, width: 0.2, height: 0.5 } });

async function tabBar(): Promise<Handle & { watch: () => Promise<void>; see: () => Promise<void> }> {
  permission.mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
  const handle = {} as Handle;

  function Probe() {
    handle.state = useAppState();
    return null;
  }

  await ReactTestRenderer.act(async () => {
    handle.renderer = ReactTestRenderer.create(
      <AppStateProvider>
        <Probe />
        <TabBar />
      </AppStateProvider>,
    );
  });
  await ReactTestRenderer.act(async () => {});

  return {
    get state() { return handle.state; },
    get renderer() { return handle.renderer; },
    watch: async () => {
      handle.state.cameraRef.current = {
        startRecording: jest.fn(),
        stopRecording: jest.fn(),
        takeSnapshot: jest.fn(async () => ({ path: '/tmp/snap.jpg' })),
      } as never;
      await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });
      await ReactTestRenderer.act(async () => {});
    },
    // Two looks confirm the track; the second opens the session, which is what
    // the badge — and now the tab — reports.
    see: async () => {
      for (let look = 0; look < 2; look++) {
        await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(1000); });
        await ReactTestRenderer.act(async () => { handle.state.reportDetections([person()], 9 / 16); });
        await ReactTestRenderer.act(async () => {});
      }
    },
  };
}

/** The dot, if it is drawn at all: the only decoration in the bar that takes no touch. */
function dot(handle: Handle) {
  const found = handle.renderer.root.findAll(
    node => typeof node.type === 'string' && node.props?.pointerEvents === 'none',
  );
  return found.length === 0 ? null : StyleSheet.flatten(found[0].props.style) as { backgroundColor?: string };
}

/** The camera tab is the first of the three, in the bar as in the rail. */
function cameraTabLabel(handle: Handle) {
  return handle.renderer.root.findAll(
    node => node.props?.accessibilityRole === 'tab' && typeof node.props?.onPress === 'function',
  )[0].props.accessibilityLabel;
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockFs.exists.mockResolvedValue(false);
  mockFs.mkdir.mockResolvedValue(undefined);
  mockFs.unlink.mockResolvedValue(undefined);
  mockFs.getFSInfo.mockResolvedValue({
    freeSpace: 8e10, totalSpace: 1e11, freeSpaceEx: 8e10, totalSpaceEx: 1e11,
  } as never);
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

it('draws nothing while the camera is off', async () => {
  const bar = await tabBar();

  expect(dot(bar)).toBeNull();
  expect(cameraTabLabel(bar)).toBeUndefined();
});

it('marks the camera tab while surveillance is running', async () => {
  const bar = await tabBar();
  await bar.watch();

  // Hollow: the camera is watching, nothing is being written.
  expect(dot(bar)?.backgroundColor).toBe('transparent');
  expect(cameraTabLabel(bar)).toBe(t('a11y.tab.watching', { name: t('tab.cam') }));
});

it('fills the mark while a passage is being recorded', async () => {
  const bar = await tabBar();
  await bar.watch();
  await bar.see();

  expect(dot(bar)?.backgroundColor).toBe(color.accent);
  expect(cameraTabLabel(bar)).toBe(t('a11y.tab.recording', { name: t('tab.cam') }));
});
