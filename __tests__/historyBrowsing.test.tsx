/**
 * What the history says when it is not just a list of cards.
 *
 * Two things it used to get wrong. Every clip was one line of an undated flat
 * list, so "yesterday evening" was a scroll and a subtraction rather than a
 * heading. And all three ways of having nothing to show — never filmed
 * anything, a filter narrower than the history, a retention that has emptied it
 * — printed the same grey sentence about a filter, which on a first launch
 * blamed the user for a filter they had not set and offered no way forward.
 *
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { FlatList, Image, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { ClipThumbnail } from '../src/components/ClipThumbnail';
import { EventCard } from '../src/components/EventCard';
import { HistoryScreen } from '../src/screens/HistoryScreen';
import { DetectionEvent } from '../src/state/types';
import { t } from '../src/i18n';

const EVENTS_KEY = '@novaguard:events:v2';

/** A detection `daysBack` days ago at 18:00, so no test sits near a boundary. */
function event(id: number, daysBack: number, kind: DetectionEvent['kind'] = 'Personne'): DetectionEvent {
  const when = new Date();
  when.setDate(when.getDate() - daysBack);
  when.setHours(18, 0, 0, 0);
  return {
    id, kind, timestamp: when.getTime(), dur: 5, conf: 90,
    path: `/c/${id}.mp4`, bytes: 1024, thumbPath: `/c/${id}.jpg`,
  };
}

type Handle = { state: ReturnType<typeof useAppState>; renderer: ReactTestRenderer.ReactTestRenderer };

/**
 * `period` starts at "Aujourd'hui", which is right for the screen and wrong for
 * a test about several days — it would filter them out before the grouping ran.
 */
async function showHistory(events: DetectionEvent[], period?: 'Tout'): Promise<Handle> {
  await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events));
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
  mounted = handle.renderer;
  if (period) await ReactTestRenderer.act(async () => { handle.state.setPeriod(period); });
  return handle;
}

/**
 * The strings inside the list, headings and empty state included — not those of
 * the controls above it, where the period dropdown draws the word
 * "Aujourd'hui" whether or not any detection happened today.
 */
const texts = (handle: Handle) =>
  handle.renderer.root
    .findByType(FlatList)
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat();

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
});

afterEach(async () => {
  // The provider owns a disk-sweep interval and the promises it starts; left
  // running they resolve after Jest has torn the module registry down.
  if (mounted) await ReactTestRenderer.act(async () => { mounted!.unmount(); });
  mounted = null;
  jest.useRealTimers();
});

describe('grouped by day', () => {
  it('names today and yesterday rather than dating them', async () => {
    const handle = await showHistory([event(2, 0), event(1, 1)], 'Tout');
    expect(texts(handle)).toContain(t('date.dayToday'));
    expect(texts(handle)).toContain(t('date.dayYesterday'));
  });

  it('dates anything older, and without a time of day', async () => {
    const handle = await showHistory([event(1, 4)], 'Tout');
    const heading = texts(handle).find(
      (s: unknown) => typeof s === 'string' && /\d/.test(s) && !s.includes(':'),
    );
    // A heading is a day. The clip's own time is on its card, where it means
    // something; repeating "18:00" above it would not.
    expect(heading).toBeDefined();
    expect(texts(handle)).not.toContain(t('date.dayToday'));
  });

  it('opens one heading per day, however many clips it holds', async () => {
    const handle = await showHistory([event(3, 0), event(2, 0), event(1, 0)]);
    expect(texts(handle).filter((s: unknown) => s === t('date.dayToday'))).toHaveLength(1);
    expect(handle.renderer.root.findAllByType(EventCard)).toHaveLength(3);
  });
});

describe('with nothing to show', () => {
  it('tells a new user what to do instead of naming a filter they never set', async () => {
    const handle = await showHistory([]);
    expect(texts(handle)).toContain(t('hist.empty.never'));
    expect(texts(handle)).toContain(t('hist.empty.never.sub'));
    // No reset: there is nothing a filter is hiding.
    expect(texts(handle)).not.toContain(t('hist.empty.reset'));
  });

  it('says it is the filter when the history is not in fact empty', async () => {
    const handle = await showHistory([event(1, 0, 'Animal')]);
    await ReactTestRenderer.act(async () => { handle.state.setFilter('Personnes'); });

    expect(handle.renderer.root.findAllByType(EventCard)).toHaveLength(0);
    expect(texts(handle)).toContain(t('hist.empty'));
    expect(texts(handle)).not.toContain(t('hist.empty.never'));
  });

  it('offers the way back out, and it works', async () => {
    const handle = await showHistory([event(1, 0, 'Animal')]);
    await ReactTestRenderer.act(async () => {
      handle.state.setFilter('Personnes');
      handle.state.setPeriod("Aujourd'hui");
    });

    const reset = handle.renderer.root.find(
      node => node.props?.label === t('hist.empty.reset') && typeof node.props?.onPress === 'function',
    );
    await ReactTestRenderer.act(async () => { reset.props.onPress(); });

    // Both filters, not just the one the segmented control shows: a period of
    // "today" left over would empty the list again the next morning.
    expect(handle.state.filter).toBe('Toutes');
    expect(handle.state.period).toBe('Tout');
    expect(handle.renderer.root.findAllByType(EventCard)).toHaveLength(1);
  });
});

describe('the card shows the clip, not a decoration', () => {
  it('draws the still each event kept', async () => {
    const handle = await showHistory([event(2, 0), event(1, 0)]);
    const sources = handle.renderer.root
      .findAllByType(Image)
      .map(node => node.props.source.uri);

    // Two cards, two different frames — the whole point. They used to be the
    // same gradient and the same little rectangle on every row.
    expect(sources).toEqual(['file:///c/2.jpg', 'file:///c/1.jpg']);
  });

  it('falls back to the placeholder for a clip recorded with no preview', async () => {
    // What a screen-off recording gets: there was no preview view to snapshot.
    const handle = await showHistory([{ ...event(1, 0), thumbPath: null }]);
    expect(handle.renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(handle.renderer.root.findAllByType(EventCard)).toHaveLength(1);
  });

  it('says which events have no video to open', async () => {
    // The one thing about an event a list of cards could not otherwise tell
    // you: the encoder produced nothing (no permission, a full disk, a stop it
    // never answered). These cards looked exactly like the others, and were
    // opened to find out.
    const handle = await showHistory([{ ...event(1, 0), path: null, bytes: 0, thumbPath: null }]);
    expect(texts(handle)).toContain(t('hist.event.noClip'));
  });

  it('marks nothing on an event that does have its clip', async () => {
    const handle = await showHistory([event(1, 0)]);
    expect(texts(handle)).not.toContain(t('hist.event.noClip'));
  });

  it('gives the clock, not the day the heading above it already gives', async () => {
    const handle = await showHistory([event(1, 0)]);
    // "Aujourd'hui" is the day heading; repeating it on the card underneath is
    // words that carry nothing. The full instant is still what the reader is
    // given, and what the detail sheet shows.
    expect(texts(handle)).toContain('18:00');
    const onCards = texts(handle).filter(text => typeof text === 'string' && text.includes('18:00'));
    expect(onCards).toEqual(['18:00']);
  });

  it('falls back when the still is gone from disk', async () => {
    const handle = await showHistory([event(1, 0)]);
    const image = handle.renderer.root.findByType(Image);
    // The retention can reclaim the file while the list is on screen; a broken
    // image would leave a hole in the row.
    await ReactTestRenderer.act(async () => { image.props.onError(); });

    expect(handle.renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(handle.renderer.root.findAllByType(EventCard)).toHaveLength(1);
  });
});

it('forgets a failed still when the same view is handed another clip', async () => {
  // The detail sheet is one component for every event: open one whose still
  // has been reclaimed, close it, open another, and a remembered failure would
  // show the placeholder for a clip that has a perfectly good frame.
  let tree!: ReactTestRenderer.ReactTestRenderer;
  const thumb = (path: string) => (
    <ClipThumbnail path={path} colors={['#000', '#111']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
  );

  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(thumb('/c/gone.jpg')); });
  await ReactTestRenderer.act(async () => { tree.root.findByType(Image).props.onError(); });
  expect(tree.root.findAllByType(Image)).toHaveLength(0);

  await ReactTestRenderer.act(async () => { tree.update(thumb('/c/here.jpg')); });
  expect(tree.root.findByType(Image).props.source.uri).toBe('file:///c/here.jpg');
});
