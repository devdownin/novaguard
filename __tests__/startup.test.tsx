/**
 * Startup: the app must get past the splash, hydrate persisted state and land
 * on the Surveillance screen — and it must ask for the detection model with a
 * source Metro actually bundled.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import tflite from 'react-native-fast-tflite';
import App from '../App';
import { SPLASH_MIN_DURATION_MS } from '../src/components/SplashScreen';
import { useDetectionModel } from '../src/camera/useDetectionModel';
import { defaultSettings } from '../src/state/defaults';

const MODEL = require('../assets/models/efficientdet-lite0.tflite');

type Json = ReturnType<ReactTestRenderer.ReactTestRenderer['toJSON']>;

/** Every string rendered anywhere in the tree. */
function texts(renderer: ReactTestRenderer.ReactTestRenderer): string[] {
  const found: string[] = [];
  const walk = (node: Json | string | null) => {
    if (node == null) return;
    if (typeof node === 'string') { found.push(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    (node.children ?? []).forEach(walk as (c: unknown) => void);
  };
  walk(renderer.toJSON());
  return found;
}

async function startApp() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />);
  });
  return renderer;
}

/** Walks past the splash's minimum display window and lets hydration settle. */
async function finishBoot(renderer: ReactTestRenderer.ReactTestRenderer) {
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(SPLASH_MIN_DURATION_MS + 50);
  });
  await ReactTestRenderer.act(async () => {});
  return renderer;
}

const mock = tflite as unknown as {
  __reset: () => void;
  __setResolver: (fn: (source: unknown, delegate: string) => unknown) => void;
  __calls: () => { source: unknown; delegate: string }[];
};
const mockCalls = () => mock.__calls();

beforeEach(async () => {
  await AsyncStorage.clear();
  mock.__reset();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('cold start', () => {
  it('shows the splash before the app is ready', async () => {
    const shown = texts(await startApp());
    expect(shown).toEqual(expect.arrayContaining(['Nova', 'Guard', 'DÉTECTION INTELLIGENTE']));
    // The tab bar only exists once the splash is gone.
    expect(shown).not.toEqual(expect.arrayContaining(['Historique']));
  });

  it('reaches the Surveillance screen after hydration', async () => {
    const shown = texts(await finishBoot(await startApp()));
    expect(shown).toEqual(expect.arrayContaining(['NOVAGUARD', 'DÉMARRER LA SURVEILLANCE']));
    // Tab bar present => the whole shell mounted, not just one screen.
    expect(shown).toEqual(expect.arrayContaining(['Caméra', 'Historique', 'Setup']));
  });

  it('falls back to the standby view when the camera is not authorised', async () => {
    // The mocked permission is denied, which is the state a first launch is in.
    const shown = texts(await finishBoot(await startApp()));
    expect(shown).toEqual(expect.arrayContaining(['AUTORISEZ LA CAMÉRA']));
  });

  it('offers onboarding on a first launch', async () => {
    const shown = texts(await finishBoot(await startApp()));
    expect(shown).toEqual(expect.arrayContaining(['BIENVENUE', 'CONTINUER']));
  });

  it('starts idle, with no fabricated history or counters', async () => {
    const shown = texts(await finishBoot(await startApp()));
    // The old build seeded seven demo events whose sizes came from a made-up
    // bitrate, plus "3 detections today" and a last sighting of 08:42. None of
    // that may survive a cold start any more.
    expect(shown).not.toEqual(expect.arrayContaining(['14,2 Mo']));
    expect(shown).not.toEqual(expect.arrayContaining(['08:42']));
    // Last detection "—", today's count 0, and storage measured rather than
    // the old hardcoded "24,8 Go".
    expect(shown).toEqual(expect.arrayContaining(['Dernière', '—', "Aujourd'hui", '0']));
    expect(shown).not.toEqual(expect.arrayContaining(['24,8 Go']));
  });

  it('reads persisted state back instead of falling back to defaults', async () => {
    await AsyncStorage.setItem('@novaguard:settings', JSON.stringify(defaultSettings));
    // 07:33 today, stored as the instant it happened rather than as a clock
    // reading — see `storage.ts`, where the old string key is now stale.
    const at = new Date(); at.setHours(7, 33, 0, 0);
    await AsyncStorage.setItem('@novaguard:lastDetAt', JSON.stringify(at.getTime()));
    await AsyncStorage.setItem('@novaguard:onboardingComplete', 'true');

    const shown = texts(await finishBoot(await startApp()));
    // The stored value is on screen, so hydration ran end to end.
    expect(shown).toEqual(expect.arrayContaining(["Aujourd'hui, 07:33"]));
    expect(shown).not.toEqual(expect.arrayContaining(['—']));
  });

  it('ignores the superseded v1 keys holding the old fabricated data', async () => {
    await AsyncStorage.setItem('@novaguard:onboardingComplete', 'true');
    await AsyncStorage.setItem('@novaguard:detToday', JSON.stringify(41));
    await AsyncStorage.setItem('@novaguard:events', JSON.stringify(
      [{ id: 1, kind: 'Personne', timestamp: Date.now(), dur: 18, conf: 94, size: '14,2 Mo' }],
    ));

    const shown = texts(await finishBoot(await startApp()));
    expect(shown).not.toEqual(expect.arrayContaining(['41']));
    expect(shown).not.toEqual(expect.arrayContaining(['14,2 Mo']));
    expect(shown).toEqual(expect.arrayContaining(['0']));
  });

  it('resumes monitoring only when the camera permission is actually held', async () => {
    await AsyncStorage.setItem('@novaguard:onboardingComplete', 'true');
    await AsyncStorage.setItem('@novaguard:monitoring', 'true');
    await AsyncStorage.setItem(
      '@novaguard:settings',
      JSON.stringify({ ...defaultSettings, resumeOnLaunch: true }),
    );

    // The mocked permission is denied, so surveillance must stay off: a
    // camera foreground service cannot start without it.
    const shown = texts(await finishBoot(await startApp()));
    expect(shown).toEqual(expect.arrayContaining(['DÉMARRER LA SURVEILLANCE']));
    expect(shown).not.toEqual(expect.arrayContaining(['ARRÊTER LA SURVEILLANCE']));
  });

  it('leaves monitoring off when resume-on-launch is disabled', async () => {
    await AsyncStorage.setItem('@novaguard:onboardingComplete', 'true');
    await AsyncStorage.setItem('@novaguard:monitoring', 'true');
    await AsyncStorage.setItem(
      '@novaguard:settings',
      JSON.stringify({ ...defaultSettings, resumeOnLaunch: false }),
    );

    const shown = texts(await finishBoot(await startApp()));
    expect(shown).toEqual(expect.arrayContaining(['DÉMARRER LA SURVEILLANCE']));
  });

  it('fills in fields missing from a settings object written by an older build', async () => {
    await AsyncStorage.setItem('@novaguard:onboardingComplete', 'true');
    // No `quality`, no `retention`, and the long-gone `boot`/`sound`/`vibe`.
    await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({
      camera: 'Avant', boot: true, sound: true, vibe: false,
    }));

    // Reaching the shell at all means the merge filled the gaps; a raw spread
    // would have left `exp` undefined and thrown on the first section render.
    const shown = texts(await finishBoot(await startApp()));
    expect(shown).toEqual(expect.arrayContaining(['NOVAGUARD', 'Setup']));
  });

  it('skips onboarding when it has already been completed', async () => {
    await AsyncStorage.setItem('@novaguard:onboardingComplete', 'true');
    const shown = texts(await finishBoot(await startApp()));
    expect(shown).not.toEqual(expect.arrayContaining(['Bienvenue']));
  });
});

describe('detection model loading', () => {
  function harnessFor(container: { value?: ReturnType<typeof useDetectionModel> }) {
    return function Harness({ forceCpu = false }: { forceCpu?: boolean }) {
      container.value = useDetectionModel(MODEL, forceCpu);
      return null;
    };
  }

  async function loadModel(forceCpu = false) {
    const container: { value?: ReturnType<typeof useDetectionModel> } = {};
    const Harness = harnessFor(container);
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<Harness forceCpu={forceCpu} />);
    });
    await ReactTestRenderer.act(async () => {});
    const setForceCpu = async (next: boolean) => {
      await ReactTestRenderer.act(async () => { renderer.update(<Harness forceCpu={next} />); });
    };
    return { container, renderer, setForceCpu };
  }

  it('bundles the model as an asset Metro can resolve', () => {
    // Metro turns require('*.tflite') into an asset reference; a wrong path or
    // a missing assetExts entry in metro.config.js would fail right here.
    expect(MODEL).toBeDefined();
    expect(MODEL).not.toBeNull();
  });

  it('asks for the GPU delegate first on Android', async () => {
    const { container } = await loadModel();
    expect(container.value?.delegate).toBe('android-gpu');
    expect(container.value?.model).toBeUndefined();
    expect(container.value?.failed).toBe(false);
  });

  it('exposes the model once the plugin reports it loaded', async () => {
    const fakeModel = { runSync: jest.fn() };
    mock.__setResolver(() => ({ state: 'loaded', model: fakeModel }));
    const { container } = await loadModel();
    expect(container.value?.model).toBe(fakeModel);
    expect(container.value?.failed).toBe(false);
  });

  it('falls back to CPU when the GPU delegate refuses the model', async () => {
    // These detection models carry a postprocessing op GPU delegates often
    // decline; without this fallback there would be no detection at all.
    mock.__setResolver((_source, delegate) => (delegate === 'android-gpu'
      ? { state: 'error', error: new Error('delegate refused') }
      : { state: 'loaded', model: { runSync: jest.fn() } }));
    const { container } = await loadModel();
    expect(container.value?.delegate).toBe('default');
    expect(container.value?.model).toBeDefined();
    expect(container.value?.failed).toBe(false);
  });

  it('reports failure only once the CPU delegate has also refused', async () => {
    mock.__setResolver(() => ({ state: 'error', error: new Error('nope') }));
    const { container } = await loadModel();
    expect(container.value?.failed).toBe(true);
    expect(container.value?.model).toBeUndefined();
  });

  describe('forcing the CPU from Setup', () => {
    // The automatic fallback only catches a GPU delegate that refuses to load
    // the model. One that loads it and then returns nothing usable looks
    // exactly like a camera that never sees anybody — this is what makes the
    // two distinguishable on a device, so it has to actually reach the plugin.
    it('never asks for the GPU delegate at all', async () => {
      mock.__setResolver(() => ({ state: 'loaded', model: { runSync: jest.fn() } }));
      const { container } = await loadModel(true);

      expect(container.value?.delegate).toBe('default');
      expect(mockCalls().map(c => c.delegate)).not.toContain('android-gpu');
    });

    it('gives the GPU another go when the switch is turned back off', async () => {
      // Stored as "we fell back", this could never be undone: one flick of the
      // switch would have pinned the session to the CPU for good.
      mock.__setResolver(() => ({ state: 'loaded', model: { runSync: jest.fn() } }));
      const { container, setForceCpu } = await loadModel(true);
      await setForceCpu(false);

      expect(container.value?.delegate).toBe('android-gpu');
    });

    it('does not re-ask a GPU that already refused', async () => {
      mock.__setResolver((_source, delegate) => (delegate === 'android-gpu'
        ? { state: 'error', error: new Error('delegate refused') }
        : { state: 'loaded', model: { runSync: jest.fn() } }));
      const { container, setForceCpu } = await loadModel();
      expect(container.value?.delegate).toBe('default');

      await setForceCpu(true);
      await setForceCpu(false);
      expect(container.value?.delegate).toBe('default');
    });
  });
});
