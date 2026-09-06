/**
 * The screen that shows the app's own tuning, drawn from the log it keeps.
 *
 * Two things it must not do, and both have precedent in this repo. It must not
 * invent: the panel that tells the user what is stored about them once billed
 * 2,1 Mo to a cache that existed nowhere, so every figure here comes from a
 * measured window or from nothing at all. And it must not cost the frame path
 * anything: the samples arrive twice a second, so the screen polls the buffer
 * while it is open instead of the provider publishing them.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermission } from 'react-native-vision-camera';
import { AutoTuneSheet } from '../src/components/AutoTuneSheet';
import { InfoSheet } from '../src/components/InfoSheet';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { AppState } from '../testing/mountProvider';
import { FRAME_RATE_WINDOW_MS } from '../src/camera/frameRate';
import { AUTO_TUNE_LOG_SIZE } from '../src/camera/autoTuneLog';
import { SLOT_COLOR } from '../src/components/BarChart';
import { WINDOWS_TO_GIVE_UP } from '../src/camera/autoTune';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

type Tree = ReactTestRenderer.ReactTestRenderer;

function allText(tree: Tree): string[] {
  return tree.root.findAllByType(Text).map(node => String(node.props.children));
}

/**
 * Host nodes only. A composite and the host view it renders both carry the
 * props, so matching on props alone counts every chart twice — and a test
 * built on that number passes whatever is drawn.
 */
function hosts(tree: Tree, match: (props: Record<string, unknown>) => boolean) {
  return tree.root.findAll(n => typeof n.type === 'string' && match(n.props ?? {}));
}

/** The bars are hidden from the reader; the chart's own label is what it gets. */
function chartLabels(tree: Tree): string[] {
  return hosts(tree, p => p.accessibilityRole === 'image').map(n => String(n.props.accessibilityLabel));
}

function barsOf(tree: Tree, testID: string): number {
  const card = hosts(tree, p => p.testID === testID)[0];
  const chart = card.findAll(
    n => typeof n.type === 'string' && n.props?.accessibilityRole === 'image',
  )[0];
  // Drawn bars only. The placeholders that hold the bar width until the log
  // fills are the same shape, and flattening matters: a bar's style is an
  // array, so reading `.height` off the prop itself finds nothing and counts
  // exactly the wrong set.
  return chart.findAll(n => {
    if (typeof n.type !== 'string') return false;
    const style = StyleSheet.flatten(n.props?.style) as { height?: number; backgroundColor?: string };
    return typeof style?.height === 'number'
      && style.backgroundColor != null          // the plot frame carries a height too
      && style.backgroundColor !== SLOT_COLOR;
  }).length;
}

/** One analysed frame per window: 0,5 i/s against the 3 i/s "Moyenne" asks for. */
async function starve(handle: { state: AppState }, windows: number) {
  await ReactTestRenderer.act(async () => {
    handle.state.reportDetections([], 9 / 16);
    for (let i = 0; i < windows; i++) {
      jest.advanceTimersByTime(FRAME_RATE_WINDOW_MS);
      handle.state.reportDetections([], 9 / 16);
    }
    // One more tick so the screen's poll picks the last window up.
    jest.advanceTimersByTime(FRAME_RATE_WINDOW_MS);
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (useCameraPermission as jest.Mock).mockReturnValue({
    hasPermission: true, requestPermission: jest.fn(async () => true),
  });
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * The provider and both sheets in one tree, which is how the app mounts them.
 *
 * The handle is returned, never a destructured copy of the state: `state` is
 * reassigned on every render, so a copy pins the first one — the trap
 * `mountProvider` documents.
 */
async function open(): Promise<{ handle: { state: AppState }; tree: Tree }> {
  const handle = {} as { state: AppState };
  let tree!: Tree;

  function Probe() {
    handle.state = useAppState();
    return null;
  }

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <AppStateProvider><Probe /><InfoSheet /><AutoTuneSheet /></AppStateProvider>,
    );
  });
  await ReactTestRenderer.act(async () => {});
  await ReactTestRenderer.act(async () => { handle.state.openInfo('autotune'); });
  return { handle, tree };
}

it('says nothing has been measured rather than drawing an empty chart', async () => {
  const { tree } = await open();

  expect(allText(tree)).toContain(t('autoTune.screen.empty'));
  expect(chartLabels(tree)).toHaveLength(0);
});

it('draws one bar per measured window, on every parameter', async () => {
  const { handle, tree } = await open();

  await starve(handle, 4);

  // The cadence chart plus one per ladder step, sharing the same time axis.
  expect(chartLabels(tree)).toHaveLength(4);
  expect(barsOf(tree, 'autotune-autoZoom')).toBe(4);
  expect(barsOf(tree, 'autotune-sensitivity')).toBe(4);
  expect(barsOf(tree, 'autotune-precise')).toBe(4);
});

it('reports the measurement it drew, not a rounded story', async () => {
  const { handle, tree } = await open();

  await starve(handle, 3);

  // 0,5 i/s measured against the 3 i/s "Moyenne" asks for.
  const [cadence] = chartLabels(tree);
  expect(cadence).toContain('0,5 i/s');
  expect(cadence).toContain('3,0 i/s');
});

it('names the parameter the tuner has just given up', async () => {
  const { handle, tree } = await open();

  await starve(handle, WINDOWS_TO_GIVE_UP + 1);

  expect(handle.state.autoTune.applied).toEqual(['autoZoom']);
  expect(allText(tree)).toContain(t('autoTune.state.given'));
  // The detector is still the user's to keep: the ladder has not reached it,
  // and it is off by default, which the screen says rather than blaming the app.
  expect(chartLabels(tree)[3]).toContain(t('autoTune.state.off'));
});

it('keeps drawing while the windows keep coming, without being pushed', async () => {
  const { handle, tree } = await open();

  await starve(handle, 2);
  const before = barsOf(tree, 'autotune-autoZoom');
  await starve(handle, 2);

  // Nothing publishes a sample: the screen polls the buffer while it is open.
  expect(barsOf(tree, 'autotune-autoZoom')).toBeGreaterThan(before);
});

it('never grows past the window the buffer keeps', async () => {
  const { handle, tree } = await open();

  await starve(handle, AUTO_TUNE_LOG_SIZE + 10);

  expect(barsOf(tree, 'autotune-autoZoom')).toBe(AUTO_TUNE_LOG_SIZE);
});

it('leaves the info panel out of it', async () => {
  const { tree } = await open();

  // Both sheets read the same "which panel is up" state, and the row list
  // falls through to the stored-data rows for anything it does not recognise:
  // unfiltered, it draws that panel under no title at all, behind this screen.
  expect(allText(tree)).not.toContain(t('info.data.clips'));
  expect(allText(tree)).toContain(t('autoTune.screen.title'));
});
