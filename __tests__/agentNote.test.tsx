/**
 * An agent's verdict is something the owner sees, on the card and in the
 * sheet, and something the owner can take back.
 *
 * @format
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { VideoDetailSheet } from '../src/components/VideoDetailSheet';
import { EventCard } from '../src/components/EventCard';
import { groupPassages } from '../src/recording/passages';
import { DetectionEvent } from '../src/state/types';
import { AppState } from '../testing/mountProvider';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

const NOW = Date.now();
const clip = (id: number, over: Partial<DetectionEvent> = {}): DetectionEvent => ({
  id, passageId: 'p', kind: 'Personne', timestamp: NOW + id, dur: 30, conf: 90,
  path: `/data/user/0/com.novaguard/files/recordings/${id}.mp4`, bytes: 1000, thumbPath: null, ...over,
});
const note = { verdict: 'attention' as const, text: 'Someone tried the side door.', at: NOW };
const texts = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(n => String(n.props.children));

it('shows the verdict on the passage card, whichever clip carries it', async () => {
  const events = [clip(1), clip(2, { agentNote: note })];
  const passage = groupPassages(events)[0];
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<EventCard event={passage.summary} passage={passage} onPress={() => {}} />);
  });
  expect(texts(tree)).toContain(t('hist.event.agentNote', { verdict: 'À regarder' }));
});

it('shows the note in the sheet, and lets the owner clear it', async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify([clip(1), clip(2, { agentNote: note })]));
  const handle = {} as { state: AppState };
  function Probe() { handle.state = useAppState(); return null; }
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<AppStateProvider><Probe /><VideoDetailSheet /></AppStateProvider>);
  });
  for (let i = 0; i < 4; i++) await ReactTestRenderer.act(async () => {});
  await ReactTestRenderer.act(async () => { handle.state.selectEvent(1); });
  expect(texts(tree)).toContain(note.text);

  const clear = tree.root.find(n => n.props.label === t('detail.agentNote.clear') && typeof n.props.onPress === 'function');
  await ReactTestRenderer.act(async () => { clear.props.onPress(); });
  expect(handle.state.events.some(e => e.agentNote)).toBe(false);
  expect(texts(tree)).not.toContain(note.text);
  await ReactTestRenderer.act(async () => { tree.unmount(); });
});
