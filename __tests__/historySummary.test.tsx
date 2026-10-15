/**
 * The "today" card at the top of the history.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { DaySummaryCard } from '../src/components/DaySummaryCard';
import { HistoryScreen } from '../src/screens/HistoryScreen';
import { DetectionEvent } from '../src/state/types';

let renderer: ReactTestRenderer.ReactTestRenderer;
let state: ReturnType<typeof useAppState>;
function Probe() { state = useAppState(); return null; }

const NOW = new Date(2026, 9, 15, 18, 30).getTime();
const clip = (id: number, timestamp: number, kind: 'Personne' | 'Animal' = 'Personne'): DetectionEvent => ({
  id, kind, timestamp, dur: 5, conf: 90, path: `/c/${id}.mp4`, bytes: 1024, thumbPath: null,
});

async function show(events: DetectionEvent[]) {
  await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify(events));
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<AppStateProvider><Probe /><HistoryScreen /></AppStateProvider>);
  });
  await ReactTestRenderer.act(async () => {});
  await ReactTestRenderer.act(async () => { state.setPeriod('Tout'); });
}
const cards = () => renderer.root.findAllByType(DaySummaryCard);

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  await AsyncStorage.clear();
});
afterEach(async () => {
  if (renderer) await ReactTestRenderer.act(async () => { renderer.unmount(); });
  jest.useRealTimers();
});

it('summarises the whole day whatever the filter, and narrows the list to today when pressed', async () => {
  await show([
    clip(1, new Date(2026, 9, 15, 9, 0).getTime(), 'Animal'),
    clip(2, new Date(2026, 9, 15, 14, 32).getTime()),
    clip(3, new Date(2026, 9, 14, 22, 0).getTime()),
  ]);
  await ReactTestRenderer.act(async () => { state.setFilter('Personnes'); });
  expect(cards()).toHaveLength(1);
  expect(cards()[0].props.summary.count).toBe(2);
  expect(cards()[0].props.summary.lastAt).toBe(new Date(2026, 9, 15, 14, 32).getTime());

  await ReactTestRenderer.act(async () => { cards()[0].props.onPress(); });
  expect(state.period).toBe("Aujourd'hui");
  expect(state.filter).toBe('Toutes');
});

it('is not shown before anything was ever filmed', async () => {
  await show([]);
  expect(cards()).toHaveLength(0);
});
