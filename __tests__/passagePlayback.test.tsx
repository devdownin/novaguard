import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Video from 'react-native-video';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { VideoDetailSheet } from '../src/components/VideoDetailSheet';
import { HistoryScreen } from '../src/screens/HistoryScreen';
import { EventCard } from '../src/components/EventCard';
import { DetectionEvent } from '../src/state/types';
import { t } from '../src/i18n';
import { shareRecording } from '../src/surveillance/foregroundService';
jest.mock('../src/surveillance/foregroundService');
let state: ReturnType<typeof useAppState>;
let tree: ReactTestRenderer.ReactTestRenderer;
function Probe() {
  state = useAppState();
  return null;
}
const event = (
  id: number,
  kind: DetectionEvent['kind'] = 'Personne',
): DetectionEvent => ({
  id,
  kind,
  passageId: 'A',
  timestamp: Date.now() + id * 1000,
  dur: 10,
  conf: 90,
  path: `/clips/${id}.mp4`,
  bytes: 100,
  thumbPath: null,
});
async function mount(
  seed = [event(3, 'Animal'), { ...event(2), path: null }, event(1)],
) {
  await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify(seed));
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <AppStateProvider>
        <Probe />
        <HistoryScreen />
        <VideoDetailSheet />
      </AppStateProvider>,
    );
  });
  await ReactTestRenderer.act(async () => {});
  await ReactTestRenderer.act(async () => {
    state.selectEvent(1);
  });
}
function button(label: string) {
  return tree.root
    .findAll(
      node => node.props.onPress && node.props.accessibilityRole === 'button',
    )
    .find(
      node =>
        node.findAll(
          child => child.type === Text && child.props.children === label,
        ).length > 0,
    )!;
}
beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  await AsyncStorage.clear();
});
afterEach(async () => {
  if (tree)
    await ReactTestRenderer.act(async () => {
      tree.unmount();
    });
  jest.useRealTimers();
});
it('shows one mixed passage and preserves all its clips when filtering by animal', async () => {
  await mount();
  expect(tree.root.findAllByType(EventCard)).toHaveLength(1);
  await ReactTestRenderer.act(async () => {
    state.setFilter('Animaux');
  });
  expect(tree.root.findByType(EventCard).props.passage.events).toHaveLength(3);
});
it('plays files in capture order, reports the missing clip and ignores late callbacks', async () => {
  await mount();
  expect(
    tree.root
      .findAllByType(Text)
      .some(
        node => node.props.children === t('hist.passage.missing', { count: 1 }),
      ),
  ).toBe(true);
  await ReactTestRenderer.act(async () => {
    button(t('detail.playPassage')).props.onPress();
  });
  const first = tree.root.findByType(Video).props;
  expect(first.source.uri).toBe('file:///clips/1.mp4');
  await ReactTestRenderer.act(async () => {
    first.onEnd();
  });
  expect(tree.root.findByType(Video).props.source.uri).toBe(
    'file:///clips/3.mp4',
  );
  await ReactTestRenderer.act(async () => {
    first.onEnd();
    first.onError();
  });
  expect(tree.root.findByType(Video).props.source.uri).toBe(
    'file:///clips/3.mp4',
  );
  await ReactTestRenderer.act(async () => {
    tree.root.findByType(Video).props.onEnd();
  });
  await ReactTestRenderer.act(async () => {
    button(t('detail.share')).props.onPress();
  });
  expect(shareRecording).toHaveBeenLastCalledWith('/clips/3.mp4');
  expect(tree.root.findAllByType(Video)).toHaveLength(0);
});
it('stops and announces a playback error rather than skipping an unreadable file', async () => {
  await mount();
  await ReactTestRenderer.act(async () => {
    button(t('detail.playPassage')).props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    tree.root.findByType(Video).props.onError();
  });
  expect(tree.root.findAllByType(Video)).toHaveLength(0);
  expect(
    tree.root
      .findAllByType(Text)
      .some(node => node.props.children === t('detail.playError')),
  ).toBe(true);
});
it('deletes only the clip currently displayed, with the existing confirmation', async () => {
  await mount();
  await ReactTestRenderer.act(async () => {
    button(t('detail.playPassage')).props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    tree.root.findByType(Video).props.onEnd();
  });
  await ReactTestRenderer.act(async () => {
    button(t('detail.deleteSequence')).props.onPress();
  });
  expect(state.selected).toBe(3);
  expect(state.confirmDelete).toBe(true);
  expect(state.events).toHaveLength(3);
  await ReactTestRenderer.act(async () => {
    state.doDelete();
  });
  expect(state.events.map(clip => clip.id)).toEqual([2, 1]);
});

it('can play the passage even when its first sighting has no file', async () => {
  await mount([event(3), event(2), { ...event(1), path: null }]);
  await ReactTestRenderer.act(async () => {
    button(t('detail.playPassage')).props.onPress();
  });
  expect(tree.root.findByType(Video).props.source.uri).toBe(
    'file:///clips/2.mp4',
  );
});

it('retains the failed clip for retry instead of returning to the first clip', async () => {
  await mount();
  await ReactTestRenderer.act(async () => {
    button(t('detail.playPassage')).props.onPress();
  });
  await ReactTestRenderer.act(async () => {
    tree.root.findByType(Video).props.onEnd();
  });
  await ReactTestRenderer.act(async () => {
    tree.root.findByType(Video).props.onError();
  });
  const playButton = tree.root.findAll(
    node =>
      node.props.accessibilityLabel === t('detail.play') && node.props.onPress,
  )[0];
  await ReactTestRenderer.act(async () => {
    playButton.props.onPress();
  });
  expect(tree.root.findByType(Video).props.source.uri).toBe(
    'file:///clips/3.mp4',
  );
});
