/**
 * Picking several passages from the history and deleting them in one go.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fs from '@dr.pogodin/react-native-fs';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { EventCard } from '../src/components/EventCard';
import { HistoryScreen } from '../src/screens/HistoryScreen';
import { DetectionEvent } from '../src/state/types';

const mockFs = fs as jest.Mocked<typeof fs>;
let renderer: ReactTestRenderer.ReactTestRenderer;
let state: ReturnType<typeof useAppState>;
function Probe() { state = useAppState(); return null; }

const clip = (id: number, minutesBack: number, passageId?: string): DetectionEvent => ({
  id, kind: 'Personne', timestamp: Date.now() - minutesBack * 60_000, dur: 5, conf: 90,
  path: `/c/${id}.mp4`, bytes: 1024, thumbPath: null, passageId,
});

async function show(events: DetectionEvent[]) {
  await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify(events));
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<AppStateProvider><Probe /><HistoryScreen /></AppStateProvider>);
  });
  await ReactTestRenderer.act(async () => {});
  await ReactTestRenderer.act(async () => { state.setPeriod('Tout'); });
}
const card = (id: number) => renderer.root.findAllByType(EventCard).find(node => node.props.event.id === id)!;
const pickBar = () => renderer.root.findAll(node => node.props.testID === 'history-pick-bar');
const press = async (id: number, how: 'onPress' | 'onLongPress') => {
  await ReactTestRenderer.act(async () => { card(id).props[how](); });
};

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockFs.exists.mockResolvedValue(true);
  mockFs.unlink.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (renderer) await ReactTestRenderer.act(async () => { renderer.unmount(); });
  jest.useRealTimers();
});

it('enters selection on a long press, and a tap then picks instead of opening', async () => {
  await show([clip(1, 1), clip(2, 30), clip(3, 60)]);
  expect(pickBar()).toHaveLength(0);
  expect(card(1).props.picked).toBeUndefined();

  await press(1, 'onLongPress');
  expect(pickBar().length).toBeGreaterThan(0);
  expect(card(1).props.picked).toBe(true);

  await press(2, 'onPress');
  expect(card(2).props.picked).toBe(true);
  expect(state.selected).toBeNull();

  // Unpicking the last one leaves selection mode: a tap opens again.
  await press(1, 'onPress'); await press(2, 'onPress');
  expect(pickBar()).toHaveLength(0);
  await press(3, 'onPress');
  expect(state.selected).toBe(3);
});

it('deletes every clip of every picked passage, and only those, after confirming', async () => {
  await show([clip(1, 1, 'p'), clip(2, 2, 'p'), clip(3, 30), clip(4, 60)]);
  const passageCard = renderer.root.findAllByType(EventCard).find(node => node.props.passage?.events.length === 2)!;
  await ReactTestRenderer.act(async () => { passageCard.props.onLongPress(); });
  await press(3, 'onPress');

  const deleteButton = renderer.root.findAll(node => node.props.testID === 'history-pick-bar')[0]
    .findAll(node => node.props.onPress && node.props.accessibilityRole === 'button')[0];
  await ReactTestRenderer.act(async () => { deleteButton.props.onPress(); });
  expect(state.pendingBulkDelete?.slice().sort()).toEqual([1, 2, 3]);
  expect(state.events).toHaveLength(4);

  await ReactTestRenderer.act(async () => { state.doDeleteMany(); });
  await ReactTestRenderer.act(async () => {});
  expect(state.events.map(e => e.id)).toEqual([4]);
  for (const id of [1, 2, 3]) expect(mockFs.unlink).toHaveBeenCalledWith(`/c/${id}.mp4`);
  expect(mockFs.unlink).not.toHaveBeenCalledWith('/c/4.mp4');
  expect(pickBar()).toHaveLength(0);
});

it('deletes nothing when the confirmation is cancelled', async () => {
  await show([clip(1, 1), clip(2, 30)]);
  await press(1, 'onLongPress');
  await ReactTestRenderer.act(async () => { state.askDeleteMany([1]); });
  await ReactTestRenderer.act(async () => { state.cancelDeleteMany(); });
  expect(state.pendingBulkDelete).toBeNull();
  expect(state.events).toHaveLength(2);
  expect(mockFs.unlink).not.toHaveBeenCalled();
});
