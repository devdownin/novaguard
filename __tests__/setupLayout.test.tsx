/**
 * Where two things sit on the Réglages screen, which is not a cosmetic
 * question in either case.
 *
 * Two measured rows lived under "À propos", next to the version and the
 * licence — a section people open to read about the build, not to change what
 * the camera does. Neither is a fact about the build: what the app has given up
 * is a detection setting that moved, and the gap between two clips is what the
 * duration cap costs. Each now sits beside the setting it belongs to, because
 * that is where someone looks for it. "À propos" itself goes last, under the
 * privacy card, because nothing in it is an action.
 *
 * Driven through the real `App` for the same reason as `accessibility.test.tsx`:
 * a layout assertion against a component rendered in isolation says nothing
 * about the screen that ships.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import { SPLASH_MIN_DURATION_MS } from '../src/components/SplashScreen';
import { defaultSettings } from '../src/state/defaults';
import { ExpandedSections } from '../src/state/types';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

type Tree = ReactTestRenderer.ReactTestRenderer;

async function boot(exp: Partial<ExpandedSections>): Promise<Tree> {
  await AsyncStorage.setItem('@novaguard:onboardingComplete', JSON.stringify(true));
  await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({
    ...defaultSettings,
    exp: { surv: false, det: false, rec: false, sto: false, not: false, about: false, ...exp },
  }));

  let renderer!: Tree;
  await ReactTestRenderer.act(async () => { renderer = ReactTestRenderer.create(<App />); });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(SPLASH_MIN_DURATION_MS + 50); });
  await ReactTestRenderer.act(async () => {});

  const tabs = renderer.root.findAll(n => n.props?.accessibilityRole === 'tab' && !!n.props?.onPress);
  await ReactTestRenderer.act(async () => { tabs[2].props.onPress(); });
  return renderer;
}

/** Every string on the screen, in the order the screen draws them. */
function texts(tree: Tree): string[] {
  return tree.root.findAllByType(Text).map(node => String(node.props.children));
}

const has = (tree: Tree, testID: string) =>
  tree.root.findAll(n => n.props?.testID === testID).length > 0;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('puts the self-tuning row in Détection, beside the switch that governs it', async () => {
  const tree = await boot({ det: true });

  expect(has(tree, 'autotune-open')).toBe(true);
  const lines = texts(tree);
  // Beside its switch, not merely somewhere on the screen.
  expect(lines.indexOf(t('setup.autoTune')))
    .toBeGreaterThan(lines.indexOf(t('setup.autoTuneSwitch')));
});

it('puts the measured clip gap under the cap that creates it', async () => {
  const tree = await boot({ rec: true });
  const lines = texts(tree);

  // The cap ends a file without ending the passage; this row is what that
  // costs. Reading it means having just read the setting above it.
  expect(lines).toContain(t('setup.clipGap'));
  expect(lines.indexOf(t('setup.clipGap'))).toBeGreaterThan(lines.indexOf(t('setup.max')));
});

it('leaves neither measurement in À propos', async () => {
  const tree = await boot({ about: true });
  const lines = texts(tree);

  expect(lines).not.toContain(t('setup.clipGap'));
  expect(has(tree, 'autotune-open')).toBe(false);
  // The section itself is untouched — it still has what does belong there.
  expect(lines).toContain(t('setup.version'));
});

it('leaves À propos at the very bottom of the page', async () => {
  const tree = await boot({});
  const lines = texts(tree);

  const about = lines.indexOf(t('setup.section.about'));
  expect(about).toBeGreaterThan(lines.indexOf(t('setup.section.not')));
  // Under the privacy card too, which is the last thing with anything to do.
  expect(about).toBeGreaterThan(lines.indexOf(t('setup.privacy')));
});
