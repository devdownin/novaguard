/**
 * What a screen reader is given, on the app as it actually mounts.
 *
 * Not a checklist for its own sake: a surveillance app is one people set up
 * once and then trust, and every control here is small, dense and dark. The
 * three failures this locks out are the ones that make a screen unusable
 * rather than merely unpolished — a control with no role (announced as plain
 * text, so unreachable by the "next control" gesture), a switch with no name
 * ("off, switch", nine times down one screen), and a button whose visible word
 * says nothing on its own ("Autoriser", three times, one per permission).
 *
 * Driven through the real `App` for the same reason as `landscape.test.tsx`:
 * the props that matter are the ones the screens actually pass, not the ones
 * a component supports.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import { SPLASH_MIN_DURATION_MS } from '../src/components/SplashScreen';
import { defaultSettings } from '../src/state/defaults';
import { t } from '../src/i18n';
import { Tab } from '../src/state/types';

type Node = ReactTestRenderer.ReactTestInstance;

/**
 * Past onboarding, with every Setup section open.
 *
 * Both are seeded rather than clicked through: the sections are collapsed by
 * default, and a control that is not mounted is a control this file cannot see.
 */
async function seedOpenedApp() {
  await AsyncStorage.setItem('@novaguard:onboardingComplete', JSON.stringify(true));
  await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({
    ...defaultSettings,
    exp: { surv: true, det: true, rec: true, sto: true, not: true, about: true },
  }));
}

async function boot() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { renderer = ReactTestRenderer.create(<App />); });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(SPLASH_MIN_DURATION_MS + 50); });
  await ReactTestRenderer.act(async () => {});
  return renderer;
}

/**
 * Every node the platform will actually deliver a touch to.
 *
 * Host views carrying a responder, not components taking an `onPress` prop:
 * those are what Android hands to TalkBack, and they are also the only nodes
 * whose props are the ones that shipped. Matching on `onPress` instead would
 * count every wrapper twice and pass on a button that forwards nothing.
 */
function pressables(renderer: ReactTestRenderer.ReactTestRenderer): Node[] {
  return renderer.root.findAll(
    n => typeof n.type === 'string' && typeof n.props?.onStartShouldSetResponder === 'function',
  );
}

async function openTab(renderer: ReactTestRenderer.ReactTestRenderer, tab: Tab) {
  const index = ({ cam: 0, hist: 1, setup: 2 } as const)[tab];
  const tabs = renderer.root.findAll(n => n.props?.accessibilityRole === 'tab' && !!n.props?.onPress);
  await ReactTestRenderer.act(async () => { tabs[index].props.onPress(); });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('every control announces what it is', () => {
  it.each<[Tab]>([['cam'], ['hist'], ['setup']])('on the %s screen', async tab => {
    await seedOpenedApp();
    const renderer = await boot();
    await openTab(renderer, tab);

    const touchable = pressables(renderer);
    expect(touchable.length).toBeGreaterThan(0);
    expect(touchable.filter(n => !n.props.accessibilityRole)).toHaveLength(0);
  });
});

describe('every switch says which setting it is', () => {
  it('names every one of them', async () => {
    await seedOpenedApp();
    const renderer = await boot();
    await openTab(renderer, 'setup');

    // `accessibilityLabel` on the row's own text is not enough: the switch is a
    // separate node, and it is the one the reader lands on. Unnamed, nine of
    // them down one screen announce nothing but "off, switch".
    const switches = pressables(renderer).filter(n => n.props.accessibilityRole === 'switch');
    expect(switches).toHaveLength(12);
    for (const node of switches) {
      expect(typeof node.props.accessibilityLabel).toBe('string');
      expect(node.props.accessibilityLabel.length).toBeGreaterThan(0);
    }
  });
});

describe('a label that does not stand on its own carries one that does', () => {
  it('names the setting behind each value button', async () => {
    await seedOpenedApp();
    const renderer = await boot();
    await openTab(renderer, 'setup');

    await openTab(renderer, 'setup');
    const labels = pressables(renderer)
      .map(n => n.props.accessibilityLabel)
      .filter((l): l is string => typeof l === 'string');

    // "2 min" and "7 jours" say nothing on their own, so each has to announce
    // the setting it belongs to. Counted, not merely present: the five
    // retention pills are the case where the value alone is most ambiguous.
    const named = (setting: string) => labels.filter(l => l.startsWith(`${setting} : `)).length;
    expect(named(t('setup.retention'))).toBe(5);
    expect(named(t('setup.camera'))).toBe(1);
    expect(named(t('setup.post'))).toBe(1);
    expect(named(t('setup.max'))).toBe(1);
    expect(named(t('setup.quality'))).toBe(1);
  });

  it('names the permission behind each "Autoriser" in onboarding', async () => {
    // Onboarding is the first screen a new user meets, and its three buttons
    // are identical on screen.
    const renderer = await boot();
    // Storage is cleared before each test, so this is a first launch: step one
    // is the intro, and the permission buttons are on step two.
    const carryOn = renderer.root.find(
      n => n.props?.label === t('onb.continue') && typeof n.props?.onPress === 'function',
    );
    await ReactTestRenderer.act(async () => { carryOn.props.onPress(); });

    const grants = pressables(renderer).filter(
      n => typeof n.props?.testID === 'string' && n.props.testID.startsWith('onb-'),
    );
    expect(grants.length).toBe(3);
    const labels = grants.map(n => n.props.accessibilityLabel);
    expect(new Set(labels).size).toBe(3);
    for (const label of labels) expect(label).toEqual(expect.stringContaining('Autoriser '));
  });
});

describe('text that shares a fixed row is capped, never frozen', () => {
  it('caps the dense chrome and leaves the body text alone', async () => {
    await seedOpenedApp();
    const renderer = await boot();

    // A cap keeps a label from pushing its row apart at 2×. Refusing to scale
    // at all — `allowFontScaling={false}` — is the thing not to do, and it is
    // nowhere in the tree.
    const texts = renderer.root.findAll(n => n.props?.allowFontScaling === false);
    expect(texts).toHaveLength(0);

    const capped = renderer.root.findAll(n => typeof n.props?.maxFontSizeMultiplier === 'number');
    expect(capped.length).toBeGreaterThan(0);
    for (const node of capped) expect(node.props.maxFontSizeMultiplier).toBeGreaterThanOrEqual(1.3);
  });
});
