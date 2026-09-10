/**
 * The panel that says what NovaGuard keeps about you.
 *
 * It carried two hardcoded figures. One of them billed 2,1 Mo to a thumbnail
 * cache that exists nowhere in this repository — a size invented for a feature
 * that was never built, on the one screen whose entire job is to be truthful
 * about stored data. The other put the detection journal at a flat 48 Ko
 * whatever it actually held. Nothing tested this panel, which is how both
 * survived; the same repository had already had to delete seven fabricated
 * events from its defaults for the same reason.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { InfoSheet } from '../src/components/InfoSheet';
import { storage, utf8Bytes } from '../src/state/storage';
import { DetectionEvent } from '../src/state/types';
import { AppState } from '../testing/mountProvider';

jest.mock('../src/surveillance/foregroundService');

const EVENTS_KEY = '@novaguard:events:v2';
const SETTINGS_KEY = '@novaguard:settings';

/** Today: an older stamp would be swept by the 30-day retention on hydration. */
const NOW = Date.now();
const event = (id: number, path: string | null, bytes: number): DetectionEvent => ({
  id, kind: 'Personne', timestamp: NOW, dur: 4, conf: 90, path, bytes, thumbPath: null,
});

/** Every line of text the sheet is showing. */
function shown(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map(t => String(t.props.children));
}

/** Trees mounted by a test, torn down after it so no render escapes its end. */
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function flush(turns = 4) {
  for (let i = 0; i < turns; i++) {
    await ReactTestRenderer.act(async () => {});
  }
}

async function openDataPanel() {
  const handle = {} as { state: AppState };
  function Probe() {
    handle.state = useAppState();
    return null;
  }
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <AppStateProvider><Probe /><InfoSheet /></AppStateProvider>,
    );
  });
  mounted.push(tree);
  await flush();
  await ReactTestRenderer.act(async () => { handle.state.openInfo('data'); });
  // The measurement reads every key, so it takes more than one microtask turn
  // to land. Waiting a fixed tick left it resolving after the test had ended —
  // which only showed up once the suite ran the files together.
  await flush();
  return { tree, handle };
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    while (mounted.length) mounted.pop()!.unmount();
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('measuring UTF-8', () => {
  it('counts what the bytes actually cost, not the code units', () => {
    expect(utf8Bytes('abc')).toBe(3);
    // Clips are named after what triggered them, in French, at paths a user's
    // locale can shape — so accents are not a hypothetical here.
    expect(utf8Bytes('é')).toBe(2);
    expect(utf8Bytes('€')).toBe(3);
    // One character, two UTF-16 code units, four bytes. `String.length` says 2.
    expect(utf8Bytes('🎥')).toBe(4);
    expect(utf8Bytes('')).toBe(0);
  });
});

describe('measuring what is stored', () => {
  it('reports the journal apart from everything else', async () => {
    const events = [event(1, '/clips/a.mp4', 1024)];
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events));
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ night: true }));

    const size = await storage.measure();

    expect(size.journal).toBe(utf8Bytes(JSON.stringify(events)));
    expect(size.settings).toBe(utf8Bytes(JSON.stringify({ night: true })));
  });

  it('counts nothing for keys that were never written', async () => {
    expect(await storage.measure()).toEqual({ journal: 0, settings: 0 });
  });

  it('grows with the history rather than staying put', async () => {
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify([event(1, '/a.mp4', 1)]));
    const small = await storage.measure();

    const many = Array.from({ length: 40 }, (_, i) => event(i, `/clips/${i}.mp4`, 1));
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(many));
    const large = await storage.measure();

    // The figure this replaces was a constant: forty clips of history and one
    // clip of history reported the same 48 Ko.
    expect(large.journal).toBeGreaterThan(small.journal * 10);
  });
});

describe('the panel', () => {
  it('no longer bills anything to thumbnails, which do not exist', async () => {
    const { tree } = await openDataPanel();

    expect(shown(tree)).not.toContain('Vignettes');
    expect(shown(tree)).not.toContain('2,1 Mo');
  });

  it('shows the journal at its measured size', async () => {
    const events = Array.from({ length: 30 }, (_, i) => event(i, `/clips/${i}.mp4`, 4096));
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events));

    const { tree } = await openDataPanel();

    const expected = utf8Bytes(JSON.stringify(events));
    expect(shown(tree)).toContain(`${Math.round(expected / 1024)} Ko`);
    // The number it used to print regardless of what was there.
    expect(shown(tree)).not.toContain('48 Ko');
  });

  it('counts files on disk, not sightings', async () => {
    // An encoder that produced nothing still leaves an event: the sighting
    // happened. Counting it as a stored video overstates what is on disk.
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify([
      event(1, '/clips/a.mp4', 4096),
      event(2, '/clips/b.mp4', 4096),
      event(3, null, 0),
    ]));

    const { tree } = await openDataPanel();

    expect(shown(tree).some(line => line.startsWith('2 fichiers'))).toBe(true);
  });

  it('says a single file in the singular', async () => {
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify([event(1, '/clips/a.mp4', 4096)]));

    const { tree } = await openDataPanel();

    expect(shown(tree).some(line => line.startsWith('1 fichier ·'))).toBe(true);
  });

  it('still says plainly that nothing leaves the device', async () => {
    const { tree } = await openDataPanel();

    // The claim the whole product rests on; it was the one true row here.
    expect(shown(tree)).toContain('Envoyé sur un serveur');
    expect(shown(tree)).toContain('Rien');
  });
});
