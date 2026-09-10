/**
 * The layout when the phone is on its side.
 *
 * A surveillance phone is propped against something far more often than it is
 * held upright, and every screen here was written for one orientation: the tab
 * bar took 60 dp off a 360 dp window, the camera controls took another 180, and
 * the history list drew one short card per line across 800 dp of width.
 *
 * Driven through the real `App`, in a landscape window, because that is the
 * only way the shell, the nav and the screen are asked the same question at
 * once — each of them reads the orientation for itself.
 *
 * @format
 */

import React from 'react';
import { Dimensions, FlatList, ScaledSize, StyleSheet, Text, View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import { EventCard } from '../src/components/EventCard';
import { SPLASH_MIN_DURATION_MS } from '../src/components/SplashScreen';
import { TabBar } from '../src/components/TabBar';
import { SurveillanceScreen } from '../src/screens/SurveillanceScreen';

const PORTRAIT: ScaledSize = { width: 412, height: 892, scale: 2.6, fontScale: 1 };
const LANDSCAPE: ScaledSize = { width: 892, height: 412, scale: 2.6, fontScale: 1 };

/**
 * `Dimensions.get` is what `useWindowDimensions` reads on first render, so
 * pinning it here is the same thing the OS does when the activity is rotated —
 * the activity handles the configuration change itself and nothing remounts.
 */
function setWindow(size: ScaledSize) {
  jest.spyOn(Dimensions, 'get').mockReturnValue(size);
}

async function boot(size: ScaledSize) {
  setWindow(size);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { renderer = ReactTestRenderer.create(<App />); });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(SPLASH_MIN_DURATION_MS + 50); });
  await ReactTestRenderer.act(async () => {});
  return renderer;
}

/** The outermost view a component renders, with its style array flattened. */
function outerStyle(
  renderer: ReactTestRenderer.ReactTestRenderer,
  component: React.ComponentType<Record<string, never>>,
) {
  const node = renderer.root.findByType(component).findAllByType(View)[0];
  return StyleSheet.flatten(node.props.style);
}

/**
 * Turns the phone under a mounted app.
 *
 * The activity declares `orientation` in its `configChanges`, so this is what
 * a real rotation looks like from JavaScript: no remount, a `change` event, and
 * every `useWindowDimensions` in the tree re-rendering where it stands.
 */
async function rotate(size: ScaledSize) {
  await ReactTestRenderer.act(async () => {
    setWindow(size);
    Dimensions.set({ window: size, screen: size });
  });
}

async function openHistory(renderer: ReactTestRenderer.ReactTestRenderer) {
  // By props rather than by type: `Pressable` is a memo/forwardRef wrapper and
  // does not match `findAllByType` here. The composite carries `onPress`; the
  // host view it renders carries only the responder handlers.
  const tabs = renderer.root.findAll(
    n => n.props?.accessibilityRole === 'tab' && typeof n.props?.onPress === 'function',
  );
  await ReactTestRenderer.act(async () => { tabs[1].props.onPress(); });
  return renderer.root.findByType(FlatList);
}

/**
 * How many cards the widest rendered row holds.
 *
 * The history used to say this through `FlatList`'s `numColumns`, which could
 * be read off an *empty* list — so the assertion held with the history seeded
 * or not, and said nothing about what a user sees. Rows are composed here
 * instead, so the count only exists once there are cards to count: the two
 * cards of a landscape row share a parent, the one card of a portrait row does
 * not share it with anyone.
 */
function widestRow(renderer: ReactTestRenderer.ReactTestRenderer): number {
  const rows = new Map<unknown, number>();
  for (const card of renderer.root.findAllByType(EventCard)) {
    // Upwards from the card to the first host node that lays its children out
    // in a line — the row. Counting parent hops instead would depend on how
    // many wrappers `View` happens to render.
    let node = card.parent;
    while (node && !(typeof node.type === 'string'
      && StyleSheet.flatten(node.props.style)?.flexDirection === 'row')) {
      node = node.parent;
    }
    rows.set(node, (rows.get(node) ?? 0) + 1);
  }
  return Math.max(0, ...rows.values());
}

/** Three detections on one day, so a landscape row can be full and a third left over. */
async function seedHistory() {
  const noon = new Date().setHours(12, 0, 0, 0);
  await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify([
    { id: 3, kind: 'Personne', timestamp: noon, dur: 5, conf: 90, path: '/c/3.mp4', bytes: 1024 },
    { id: 2, kind: 'Animal', timestamp: noon - 60_000, dur: 5, conf: 90, path: '/c/2.mp4', bytes: 1024 },
    { id: 1, kind: 'Personne', timestamp: noon - 120_000, dur: 5, conf: 90, path: '/c/1.mp4', bytes: 1024 },
  ]));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  await seedHistory();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('held horizontally', () => {
  it('moves the nav to a rail so the bar stops eating the short axis', async () => {
    const bar = outerStyle(await boot(LANDSCAPE), TabBar);
    expect(bar.flexDirection).toBe('column');
    expect(bar.width).toBeGreaterThan(0);
    // A bottom bar's clearance would be dead space in the middle of the screen.
    expect(bar.borderTopWidth).toBeUndefined();
  });

  it('puts the camera controls beside the viewfinder, not under it', async () => {
    const renderer = await boot(LANDSCAPE);
    expect(outerStyle(renderer, SurveillanceScreen).flexDirection).toBe('row');
    // Beside it, not instead of it: the controls are still on screen.
    const labels = renderer.root.findAllByType(Text).map(t => t.props.children);
    expect(labels).toContain('DÉMARRER LA SURVEILLANCE');
  });

  it('lays the history out in two columns', async () => {
    const renderer = await boot(LANDSCAPE);
    await openHistory(renderer);
    expect(renderer.root.findAllByType(EventCard)).toHaveLength(3);
    expect(widestRow(renderer)).toBe(2);
  });
});

describe('held upright', () => {
  it('keeps the bottom bar', async () => {
    const bar = outerStyle(await boot(PORTRAIT), TabBar);
    expect(bar.flexDirection).toBe('row');
    expect(bar.width).toBeUndefined();
  });

  it('keeps the camera screen stacked', async () => {
    // No `flexDirection` at all: the default column is what stacks header,
    // viewfinder and controls.
    expect(outerStyle(await boot(PORTRAIT), SurveillanceScreen).flexDirection).toBeUndefined();
  });

  it('keeps the history in a single column', async () => {
    const renderer = await boot(PORTRAIT);
    await openHistory(renderer);
    expect(renderer.root.findAllByType(EventCard)).toHaveLength(3);
    expect(widestRow(renderer)).toBe(1);
  });

});

describe('turning the phone under a running app', () => {
  it('re-lays the shell out without a remount', async () => {
    const renderer = await boot(PORTRAIT);
    expect(outerStyle(renderer, TabBar).flexDirection).toBe('row');

    await rotate(LANDSCAPE);
    expect(outerStyle(renderer, TabBar).flexDirection).toBe('column');
    expect(outerStyle(renderer, SurveillanceScreen).flexDirection).toBe('row');

    await rotate(PORTRAIT);
    expect(outerStyle(renderer, TabBar).flexDirection).toBe('row');
  });

  it('switches the history to two columns and back', async () => {
    // This is why the columns stopped being `numColumns`: FlatList raises an
    // invariant when that prop changes on a live list, so it had to be paired
    // with a changing `key` — which threw the list away and rebuilt every row
    // on each rotation. Rows composed in the screen just re-render.
    const renderer = await boot(PORTRAIT);
    await openHistory(renderer);
    expect(widestRow(renderer)).toBe(1);

    await rotate(LANDSCAPE);
    expect(widestRow(renderer)).toBe(2);

    await rotate(PORTRAIT);
    expect(widestRow(renderer)).toBe(1);
  });
});
