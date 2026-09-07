/**
 * The three counters on the camera screen, and where they lead.
 *
 * Each one states a fact that provokes a question — "last detection, 08:42"
 * means "what was it?", "12 today" means "show me", "4,2 Go" means "what is
 * filling the disk?" — and each was a dead end: the answer was three taps away
 * through a tab, a list and a card. They are now the shortest way there, except
 * where following one would land on an empty screen.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { SurveillanceScreen } from '../src/screens/SurveillanceScreen';
import { DetectionEvent } from '../src/state/types';
import { t } from '../src/i18n';

const EVENTS_KEY = '@novaguard:events:v2';
const DET_TODAY_KEY = '@novaguard:detToday:v2';

type Handle = { state: ReturnType<typeof useAppState>; renderer: ReactTestRenderer.ReactTestRenderer };

/** A detection today at 18:00, far from any day boundary. */
function event(id: number): DetectionEvent {
  const when = new Date();
  when.setHours(18, 0, 0, 0);
  return {
    id, kind: 'Personne', timestamp: when.getTime(), dur: 5, conf: 90,
    path: `/c/${id}.mp4`, bytes: 1024, thumbPath: null,
  };
}

async function showCamera(events: DetectionEvent[]): Promise<Handle> {
  await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  await AsyncStorage.setItem(DET_TODAY_KEY, JSON.stringify({ count: events.length, day: Date.now() }));
  const handle = {} as Handle;

  function Probe() {
    handle.state = useAppState();
    return null;
  }

  await ReactTestRenderer.act(async () => {
    handle.renderer = ReactTestRenderer.create(
      <AppStateProvider>
        <Probe />
        <SurveillanceScreen />
      </AppStateProvider>,
    );
  });
  await ReactTestRenderer.act(async () => {});
  return handle;
}

/** The `Pressable` a hint names — the node that carries what pressing it does. */
function cell(handle: Handle, hint: string) {
  return handle.renderer.root.find(
    node => node.props?.accessibilityHint === hint && typeof node.props?.onPress === 'function',
  );
}

/** Every node the hint names at all, so "no such cell" is distinguishable from "not pressable". */
function cells(handle: Handle, hint: string) {
  return handle.renderer.root.findAll(node => node.props?.accessibilityHint === hint);
}

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

it('opens the last detection itself, without a detour through the history', async () => {
  const handle = await showCamera([event(2), event(1)]);

  await ReactTestRenderer.act(async () => { cell(handle, t('a11y.stat.last')).props.onPress(); });

  // Events are newest first, and the sheet lives above the tabs — so this is
  // the clip, from the camera screen, without leaving it.
  expect(handle.state.selected).toBe(2);
  expect(handle.state.tab).toBe('cam');
});

it("sends today's counter to the history, filtered on what it counts", async () => {
  const handle = await showCamera([event(1)]);
  await ReactTestRenderer.act(async () => { handle.state.setFilter('Animaux'); });
  await ReactTestRenderer.act(async () => { handle.state.setPeriod('30 jours'); });

  await ReactTestRenderer.act(async () => { cell(handle, t('a11y.stat.today')).props.onPress(); });

  // Both filters: a kind left over from an earlier visit would show a fraction
  // of the number that was just pressed, and a period would show more.
  expect(handle.state.tab).toBe('hist');
  expect(handle.state.filter).toBe('Toutes');
  expect(handle.state.period).toBe("Aujourd'hui");
});

it('sends the free space to the settings that spend it', async () => {
  const handle = await showCamera([]);

  await ReactTestRenderer.act(async () => { cell(handle, t('a11y.stat.space')).props.onPress(); });

  expect(handle.state.tab).toBe('setup');
});

it('leads nowhere when there is nothing to lead to', async () => {
  const handle = await showCamera([]);

  // A first launch: no detection to open, none today to list. A button that
  // opens an empty screen is worse than a figure that stays a figure.
  expect(cells(handle, t('a11y.stat.last'))).toEqual([]);
  expect(cells(handle, t('a11y.stat.today'))).toEqual([]);
  expect(cells(handle, t('a11y.stat.space'))).not.toEqual([]);
});
