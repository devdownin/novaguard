/**
 * The recordings, and who may open them.
 *
 * NovaGuard's footage never leaves the device, which protects it from every
 * other app and from the network — and not at all from whoever picks the phone
 * up off the table it was left on to watch the door. The lock is the missing
 * half, and it stays a switch: a camera nobody else can reach does not need it.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { AppState as RNAppState, AppStateStatus, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { HistoryScreen } from '../src/screens/HistoryScreen';
import { canConfirmIdentity, confirmIdentity } from '../src/surveillance/foregroundService';
import { defaultSettings } from '../src/state/defaults';
import { DetectionEvent } from '../src/state/types';
import { EventCard } from '../src/components/EventCard';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

const confirm = confirmIdentity as jest.Mock;
const available = canConfirmIdentity as jest.Mock;

const EVENTS_KEY = '@novaguard:events:v2';
const SETTINGS_KEY = '@novaguard:settings';

function event(id: number): DetectionEvent {
  const when = new Date();
  when.setHours(18, 0, 0, 0);
  return {
    id, kind: 'Personne', timestamp: when.getTime(), dur: 5, conf: 90,
    path: `/c/${id}.mp4`, bytes: 1024, thumbPath: null,
  };
}

type Handle = {
  state: ReturnType<typeof useAppState>;
  renderer: ReactTestRenderer.ReactTestRenderer;
};

/** Mounted here rather than through `mountProvider`: these cases read the tree. */
async function history(lockHistory: boolean): Promise<Handle> {
  await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify([event(1)]));
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, lockHistory }));
  const handle = {} as Handle;

  function Probe() {
    handle.state = useAppState();
    return null;
  }

  await ReactTestRenderer.act(async () => {
    handle.renderer = ReactTestRenderer.create(
      <AppStateProvider>
        <Probe />
        <HistoryScreen />
      </AppStateProvider>,
    );
  });
  await ReactTestRenderer.act(async () => {});
  return handle;
}

/** Drives the real `AppState` listener the provider is watching. */
async function goTo(state: AppStateStatus) {
  const listener = (RNAppState.addEventListener as jest.Mock).mock.calls
    .filter(([kind]) => kind === 'change')
    .map(([, handler]) => handler);
  await ReactTestRenderer.act(async () => { listener.forEach(handler => handler(state)); });
}

const texts = (handle: Handle) =>
  handle.renderer.root.findAllByType(Text).map(node => node.props.children).flat();

async function press(handle: Handle, label: string) {
  const button = handle.renderer.root.find(
    node => node.props?.label === label && typeof node.props?.onPress === 'function',
  );
  await ReactTestRenderer.act(async () => { button.props.onPress(); });
  await ReactTestRenderer.act(async () => {});
}

beforeEach(async () => {
  jest.clearAllMocks();
  available.mockReturnValue(true);
  confirm.mockResolvedValue(true);
  await AsyncStorage.clear();
});

it('shows no recording, and says nothing about them, until the device confirms', async () => {
  const handle = await history(true);

  expect(handle.renderer.root.findAllByType(EventCard)).toHaveLength(0);
  expect(texts(handle)).toContain(t('hist.locked'));
  // Not even how many there are: a panel that reported "12 videos today" would
  // hand over half of what the lock exists to keep.
  expect(texts(handle).join(' ')).not.toContain('1 vidéo');
});

it('opens on a confirmation, and asks the device for it', async () => {
  const handle = await history(true);

  await press(handle, t('hist.locked.action'));

  expect(confirm).toHaveBeenCalledWith(t('hist.locked.prompt'), t('hist.locked.prompt.sub'));
  expect(handle.renderer.root.findAllByType(EventCard)).toHaveLength(1);
});

it('stays shut when the confirmation does not come', async () => {
  confirm.mockResolvedValue(false);
  const handle = await history(true);

  await press(handle, t('hist.locked.action'));

  // A cancelled prompt, a fingerprint that did not match, a device that lost
  // its lock: one answer, and it is not "open".
  expect(handle.renderer.root.findAllByType(EventCard)).toHaveLength(0);
  expect(texts(handle)).toContain(t('hist.locked'));
});

it('guards the shortcut that opens a video without passing through the list', async () => {
  confirm.mockResolvedValue(false);
  const handle = await history(true);

  // The camera screen's "Dernière" counter opens the detail sheet in one tap.
  // A lock the shortcut walked past would be decoration.
  await ReactTestRenderer.act(async () => { handle.state.selectEvent(1); });
  await ReactTestRenderer.act(async () => {});
  expect(handle.state.selected).toBeNull();

  confirm.mockResolvedValue(true);
  await ReactTestRenderer.act(async () => { handle.state.selectEvent(1); });
  await ReactTestRenderer.act(async () => {});
  expect(handle.state.selected).toBe(1);
});

it('shuts again when the app leaves the screen', async () => {
  const handle = await history(true);
  await press(handle, t('hist.locked.action'));
  expect(handle.state.historyLocked).toBe(false);

  // Somebody else picking the phone up is the whole scenario; an unlock that
  // outlived the app going away would be the lock unlocking itself.
  await goTo('background');

  expect(handle.state.historyLocked).toBe(true);
});

it('asks nobody anything while the setting is off', async () => {
  const handle = await history(false);

  expect(handle.renderer.root.findAllByType(EventCard)).toHaveLength(1);
  await ReactTestRenderer.act(async () => { handle.state.selectEvent(1); });
  expect(handle.state.selected).toBe(1);
  expect(confirm).not.toHaveBeenCalled();
});

it('says so rather than pretending on a device with no screen lock', async () => {
  available.mockReturnValue(false);
  const handle = await history(false);

  expect(handle.state.identityAvailable).toBe(false);
});
