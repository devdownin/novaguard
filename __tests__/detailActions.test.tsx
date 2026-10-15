/**
 * The detail sheet's actions carry an icon, like the rest of the app's
 * controls — without losing the label a screen reader announces.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { VideoDetailSheet } from '../src/components/VideoDetailSheet';
import { BookmarkIcon, CloseIcon, PlayIcon, ShareIcon, TrashIcon } from '../src/components/icons';
import { DetectionEvent } from '../src/state/types';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

let tree: ReactTestRenderer.ReactTestRenderer;
let state: ReturnType<typeof useAppState>;
function Probe() { state = useAppState(); return null; }
const clip = (id: number, at: number): DetectionEvent => ({
  id, kind: 'Personne', timestamp: at, dur: 4, conf: 90, path: `/c/${id}.mp4`, bytes: 1024, thumbPath: null, passageId: 'p',
});

beforeEach(async () => {
  await AsyncStorage.clear();
  const now = Date.now();
  await AsyncStorage.setItem('@novaguard:events:v2', JSON.stringify([clip(1, now - 2000), clip(2, now - 1000)]));
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<AppStateProvider><Probe /><VideoDetailSheet /></AppStateProvider>);
  });
  await ReactTestRenderer.act(async () => {});
  await ReactTestRenderer.act(async () => { state.selectEvent(2); });
});
afterEach(async () => { await ReactTestRenderer.act(async () => { tree.unmount(); }); });

/** The button whose own text is `label`, and the icon components drawn inside it. */
function button(label: string) {
  const node = tree.root.findAll(n => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' &&
    n.findAll(c => c.type === Text && c.props.children === label).length > 0).at(-1)!;
  return node;
}
const draws = (label: string, icon: React.ElementType) => button(label).findAllByType(icon).length > 0;

it('gives every action of the sheet its icon', () => {
  expect(draws(t('detail.playPassage'), PlayIcon)).toBe(true);
  expect(draws(t('detail.share'), ShareIcon)).toBe(true);
  expect(draws(t('detail.keep'), BookmarkIcon)).toBe(true);
  expect(draws(t('detail.deleteSequence'), TrashIcon)).toBe(true);
  expect(draws(t('detail.close'), CloseIcon)).toBe(true);
});

it('keeps the label as the text the button is read by', () => {
  for (const label of [t('detail.share'), t('detail.close')]) {
    expect(button(label).findAll(c => c.type === Text && c.props.children === label)).not.toHaveLength(0);
  }
});

/** The layout the icon sits in: stacked over its label, or beside it. */
function placement(label: string, icon: React.ElementType): 'top' | 'start' {
  const holder = button(label).findByType(icon).parent!;
  const style = StyleSheet.flatten(holder.props.style) ?? {};
  return style.flexDirection === 'row' ? 'start' : 'top';
}

it('stacks the icon above the label in the action row, as the tab bar does', () => {
  expect(placement(t('detail.share'), ShareIcon)).toBe('top');
  expect(placement(t('detail.keep'), BookmarkIcon)).toBe('top');
  expect(placement(t('detail.deleteSequence'), TrashIcon)).toBe('top');
  expect(placement(t('detail.close'), CloseIcon)).toBe('top');
  // A full-width button keeps its icon inline: there is room beside the label.
  expect(placement(t('detail.playPassage'), PlayIcon)).toBe('start');
});
