/**
 * Getting a permission back after refusing it.
 *
 * NovaGuard asks for three, and says so in as many words on the onboarding
 * screen: "Vous pouvez refuser la notification et le micro : la surveillance
 * fonctionnera quand même." Taking the app at its word used to be a trap.
 * Onboarding was the only place that ever asked, it is shown once, its rows
 * unlocked in a chain — and the notification row was chained to the
 * *microphone*, so declining the optional audio permanently removed the alerts
 * a surveillance app exists to send. The permissions panel, the obvious second
 * chance, only reported the state it could not change.
 *
 * Nothing covered any of it: there was no test for the onboarding modal or for
 * that panel at all, which is how the whole path shipped.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { useCameraPermission, useMicrophonePermission } from 'react-native-vision-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { OnboardingModal } from '../src/components/OnboardingModal';
import { InfoSheet } from '../src/components/InfoSheet';
import { AppState, mountProvider } from '../testing/mountProvider';
import { openAppSettings, requestNotificationPermission } from '../src/surveillance/foregroundService';

jest.mock('../src/surveillance/foregroundService');

const cameraPermission = useCameraPermission as jest.Mock;
const microphonePermission = useMicrophonePermission as jest.Mock;
const requestNotification = requestNotificationPermission as jest.Mock;

/** Addressed by testID: the rows are laid out differently in the two screens. */
function nodeById(tree: ReactTestRenderer.ReactTestRenderer, id: string) {
  const found = tree.root.findAll(n => n.props?.testID === id, { deep: true });
  return found.length > 0 ? found[0] : null;
}

/** The onboarding row's own button. */
function onbButton(tree: ReactTestRenderer.ReactTestRenderer, key: string) {
  return nodeById(tree, `onb-${key}`);
}

/** Whatever the permissions panel puts at the end of a row: a value, or a button. */
function panelRowText(tree: ReactTestRenderer.ReactTestRenderer, key: string): string[] {
  const row = nodeById(tree, `perm-${key}`);
  if (!row) return [];
  return row.findAllByType(Text).map(t => String(t.props.children));
}

/**
 * Found by having an `onPress`, not by component type: `findAllByType(Pressable)`
 * matches nothing through this preset, so a test built on it would report "no
 * button" whether or not one was rendered — and pass either way.
 */
function panelButton(tree: ReactTestRenderer.ReactTestRenderer, key: string) {
  const row = nodeById(tree, `perm-${key}`);
  const pressable = row?.findAll(n => typeof n.props?.onPress === 'function') ?? [];
  return pressable.length > 0 ? pressable[0] : null;
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  cameraPermission.mockReturnValue({ hasPermission: true, requestPermission: jest.fn(async () => true) });
  microphonePermission.mockReturnValue({ hasPermission: false, requestPermission: jest.fn(async () => false) });
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

describe('the onboarding permission rows', () => {
  async function mountOnboarding() {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    const handle = {} as { state: AppState };
    function Probe() {
      handle.state = useAppState();
      return null;
    }
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <AppStateProvider><Probe /><OnboardingModal /></AppStateProvider>,
      );
    });
    await ReactTestRenderer.act(async () => {});
    await ReactTestRenderer.act(async () => { handle.state.onbNext(); });
    return { tree, handle };
  }

  it('offers notifications even when the microphone was refused', async () => {
    const { tree } = await mountOnboarding();

    // Chained to the microphone, this row read "Autoriser" in grey and refused
    // to be pressed — while the line above promised the mic could be declined.
    const button = onbButton(tree, 'notif');
    expect(button).not.toBeNull();
    expect(button!.props.disabled).toBe(false);
  });

  it('still asks for the camera first, which surveillance cannot do without', async () => {
    cameraPermission.mockReturnValue({ hasPermission: false, requestPermission: jest.fn(async () => false) });
    const { tree } = await mountOnboarding();

    // The chain is not removed, only re-hung: both optional permissions unlock
    // on the camera instead of on each other.
    expect(onbButton(tree, 'mic')!.props.disabled).toBe(true);
    expect(onbButton(tree, 'notif')!.props.disabled).toBe(true);
  });
});

describe('the permissions panel', () => {
  async function openPanel() {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    const handle = {} as { state: AppState };
    function Probe() {
      handle.state = useAppState();
      return null;
    }
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <AppStateProvider><Probe /><InfoSheet /></AppStateProvider>,
      );
    });
    await ReactTestRenderer.act(async () => {});
    await ReactTestRenderer.act(async () => { handle.state.openInfo('perms'); });
    return { tree, handle };
  }

  it('offers to grant a permission that was refused', async () => {
    const { tree } = await openPanel();

    // Onboarding is shown once. Without this, a refusal there was permanent.
    expect(panelRowText(tree, 'mic')).toContain('Autoriser');
  });

  it('reports a granted permission rather than offering it again', async () => {
    const { tree } = await openPanel();

    expect(panelRowText(tree, 'cam')).toContain('Autorisée');
    expect(panelRowText(tree, 'cam')).not.toContain('Autoriser');
    expect(panelButton(tree, 'cam')).toBeNull();
  });

  it('actually asks the OS when pressed', async () => {
    const request = jest.fn(async () => true);
    microphonePermission.mockReturnValue({ hasPermission: false, requestPermission: request });
    const { tree } = await openPanel();

    await ReactTestRenderer.act(async () => { panelButton(tree, 'mic')!.props.onPress(); });

    // A panel that rendered a button and asked for nothing would be the same
    // dead end wearing a different coat.
    expect(request).toHaveBeenCalled();
  });
});

describe('a permission Android will not ask about again', () => {
  it('sends the user to the app settings, since no dialog will appear', async () => {
    requestNotification.mockResolvedValue('blocked');
    const { state } = await mountProvider();

    await ReactTestRenderer.act(async () => { state.grantPermission('notif'); });

    // Otherwise the button is honest-looking and completely inert: the request
    // resolves with nothing shown, and the user has no way to know why.
    expect(openAppSettings).toHaveBeenCalled();
  });

  it('does not send them there for an ordinary refusal', async () => {
    requestNotification.mockResolvedValue('denied');
    const { state } = await mountProvider();

    await ReactTestRenderer.act(async () => { state.grantPermission('notif'); });

    // They just said no to a dialog they saw. Throwing them into system
    // settings for that would be badgering.
    expect(openAppSettings).not.toHaveBeenCalled();
  });
});
