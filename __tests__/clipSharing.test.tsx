/**
 * The one door out of the device.
 *
 * Clips are written to the app's private files directory so that no other app
 * can read them — the whole "traitement 100 % local" promise rests on it. But
 * footage that can never be handed to an insurer or the police is not evidence
 * either, so there is exactly one way out, it needs a tap, and it grants a
 * temporary per-file URI rather than a path.
 *
 * What this pins is the JavaScript half: that the button exists only when there
 * is a file, that it asks for the right one, that a refusal is said out loud
 * rather than swallowed, and that the wrapper cannot take the app down when the
 * native side is not there. The intent and the FileProvider grant itself can
 * only be judged on a device.
 *
 * @format
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { VideoDetailSheet } from '../src/components/VideoDetailSheet';
import { shareRecording } from '../src/surveillance/foregroundService';
import { DetectionEvent } from '../src/state/types';
import { AppState } from '../testing/mountProvider';
import { RECORDINGS_DIR } from '../src/recording/videoStore';

jest.mock('../src/surveillance/foregroundService');

const EVENTS_KEY = '@novaguard:events:v2';
const NOW = Date.now();
const CLIP = '/data/user/0/com.novaguard/files/recordings/2026-09-04_18-20-11.mp4';

const event = (id: number, path: string | null): DetectionEvent => ({
  id, kind: 'Personne', timestamp: NOW, dur: 4, conf: 90, path, bytes: path ? 4_000_000 : 0, thumbPath: null
});

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function flush(turns = 4) {
  for (let i = 0; i < turns; i++) {
    await ReactTestRenderer.act(async () => {});
  }
}

async function openSheet(events: DetectionEvent[], id: number) {
  await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  const handle = {} as { state: AppState };
  function Probe() {
    handle.state = useAppState();
    return null;
  }
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <AppStateProvider><Probe /><VideoDetailSheet /></AppStateProvider>,
    );
  });
  mounted.push(tree);
  await flush();
  await ReactTestRenderer.act(async () => { handle.state.selectEvent(id); });
  await flush(1);
  return { tree, handle };
}

/**
 * The pressable carrying `label`.
 *
 * Found by walking up from its text rather than by component type: under this
 * preset `findAllByType(Pressable)` matches nothing at all, so a helper written
 * that way reports "no button" whether or not one is there — a mistake this
 * suite has already made once, in `permissionRecovery`.
 */
function button(tree: ReactTestRenderer.ReactTestRenderer, label: string) {
  const texts = tree.root.findAllByType(Text).filter(t => t.props.children === label);
  for (const text of texts) {
    let node: ReactTestRenderer.ReactTestInstance | null = text;
    while (node) {
      if (typeof node.props?.onPress === 'function') return node;
      node = node.parent;
    }
  }
  return null;
}

function labels(tree: ReactTestRenderer.ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map(t => String(t.props.children));
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

afterEach(async () => {
  await flush(2);
  for (const tree of mounted.splice(0)) {
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  }
});

it('offers the clip of the event that is open, by path', async () => {
  const { tree } = await openSheet([event(1, CLIP), event(2, '/other.mp4')], 1);

  await ReactTestRenderer.act(async () => { button(tree, 'Partager')!.props.onPress(); });

  // The path, not the id and not the other event's file: this is the one call
  // that hands footage to another app.
  expect(shareRecording).toHaveBeenCalledWith(CLIP);
  expect(shareRecording).toHaveBeenCalledTimes(1);
});

it('offers nothing to share for a sighting with no file', async () => {
  // Recording refused, disk full, or the clip reclaimed by retention. The event
  // is still worth keeping, but there is nothing to hand anybody.
  const { tree } = await openSheet([event(1, null)], 1);

  expect(button(tree, 'Partager')).toBeNull();
  expect(labels(tree)).toContain('Supprimer');
});

it('says so when the file is gone instead of looking like it did nothing', async () => {
  (shareRecording as jest.Mock).mockReturnValue(false);
  const { tree } = await openSheet([event(1, CLIP)], 1);

  await ReactTestRenderer.act(async () => { button(tree, 'Partager')!.props.onPress(); });

  expect(labels(tree).some(l => l.includes('PARTAGE IMPOSSIBLE'))).toBe(true);
});

it('does not carry a failure over to the next event opened', async () => {
  (shareRecording as jest.Mock).mockReturnValue(false);
  const { tree, handle } = await openSheet([event(1, CLIP), event(2, CLIP)], 1);
  await ReactTestRenderer.act(async () => { button(tree, 'Partager')!.props.onPress(); });
  expect(labels(tree).some(l => l.includes('PARTAGE IMPOSSIBLE'))).toBe(true);

  await ReactTestRenderer.act(async () => { handle.state.selectEvent(2); });
  await flush(1);

  // A stale error on a different clip would say the file is gone when nobody
  // has tried it.
  expect(labels(tree).some(l => l.includes('PARTAGE IMPOSSIBLE'))).toBe(false);
});

/**
 * The wrapper itself, unmocked. Every other native call in this file degrades
 * to a no-op when the module is absent — Jest, or a build before codegen has
 * run — and this one must too: a share that throws would take down the app
 * around the footage it was meant to hand over.
 */
it('answers false rather than throwing with no native module', () => {
  const actual = jest.requireActual('../src/surveillance/foregroundService');
  expect(actual.shareRecording(CLIP)).toBe(false);
});

/**
 * The three files that have to agree, and cannot be made to disagree loudly.
 *
 * The authority lives in the Kotlin, the provider that answers to it lives in
 * the manifest, and the directory it may hand out lives in a third file. Any
 * two of them drifting apart throws at the moment somebody taps Partager, on a
 * device, with nothing in tsc, eslint or the rest of this suite noticing —
 * the same shape of failure as the XML comment that broke every APK build.
 */
describe('what the FileProvider is wired to', () => {
  const read = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const sharing = read('android/app/src/main/java/com/novaguard/surveillance/ClipSharing.kt');
  const paths = read('android/app/src/main/res/xml/file_paths.xml');

  it('answers to the authority the Kotlin asks for', () => {
    const declared = /android:authorities="\$\{applicationId\}([^"]*)"/.exec(manifest)?.[1];
    const used = /AUTHORITY_SUFFIX = "([^"]*)"/.exec(sharing)?.[1];
    expect(used).toBeTruthy();
    expect(declared).toBe(used);
  });

  it('points the provider at the paths file', () => {
    expect(manifest).toMatch(/android:resource="@xml\/file_paths"/);
    expect(manifest).toMatch(/android:name="androidx\.core\.content\.FileProvider"/);
  });

  it('opens exactly the directory the clips are written to', () => {
    // `files-path` is the app's own filesDir, which is what the filesystem
    // module reports as DocumentDirectoryPath.
    const granted = /<files-path[^>]*path="([^"]*)"/.exec(paths)?.[1];
    expect(granted).toBe(`${RECORDINGS_DIR.split('/').pop()}/`);
  });

  it('is not exported, and grants per file', () => {
    // An exported provider would let any app on the phone enumerate what this
    // one is holding, which is footage of whoever walked past the camera.
    const provider = /<provider[\s\S]*?<\/provider>/.exec(manifest)?.[0] ?? '';
    expect(provider).toMatch(/android:exported="false"/);
    expect(provider).toMatch(/android:grantUriPermissions="true"/);
  });
});
