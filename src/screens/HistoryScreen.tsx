import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, MAX_FONT_SCALE } from '../theme';
import { useAppState, useFilteredEvents } from '../state/AppStateContext';
import { HistoryFilter } from '../state/types';
import { SegmentedControl } from '../components/SegmentedControl';
import { PeriodDropdown } from '../components/PeriodDropdown';
import { EventCard } from '../components/EventCard';
import { CloseIcon, TrashIcon } from '../components/icons';
import { PrimaryOutlineButton, SecondaryOutlineButton, TextButton } from '../components/OutlineButton';
import { historyRows, keptEventIds } from '../recording/library';
import { groupPassages } from '../recording/passages';
import { formatDay } from '../utils/date';
import { useLandscape } from '../utils/useLandscape';
import { t, tn } from '../i18n';

// The values are the stored identifiers, which stay French; only the labels
// are translated. See the note at the end of `i18n/fr.ts`.
const FILTER_OPTIONS: { label: string; value: HistoryFilter }[] = [
  { label: t('value.filter.Toutes'), value: 'Toutes' },
  { label: t('value.filter.Personnes'), value: 'Personnes' },
  { label: t('value.filter.Animaux'), value: 'Animaux' },
];

function ItemSeparator() {
  return <View style={styles.itemSeparator} />;
}

/**
 * Nothing to show, and *why* — three situations the old single grey line ran
 * together: never filmed anything, a filter narrower than the history, or a
 * history the retention has emptied. The first is a new user's first screen and
 * deserves a next step, not a negation.
 */
function EmptyHistory({ hasAnyEvent, onReset }: { hasAnyEvent: boolean; onReset: () => void }) {
  if (!hasAnyEvent) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>{t('hist.empty.never')}</Text>
        <Text style={styles.emptyBody}>{t('hist.empty.never.sub')}</Text>
      </View>
    );
  }
  return (
    <View style={styles.emptyWrap}>
      <Text style={styles.emptyTitle}>{t('hist.empty')}</Text>
      <PrimaryOutlineButton label={t('hist.empty.reset')} onPress={onReset} style={styles.emptyAction} />
    </View>
  );
}

/**
 * The recordings, behind the device's own lock.
 *
 * Deliberately says nothing about what it is hiding — not the count, not the
 * last time anything was filmed. A panel that reported "12 videos today" would
 * hand over half of what the lock exists to keep.
 */
function LockedHistory({ onUnlock }: { onUnlock: () => void }) {
  return (
    <View style={styles.emptyWrap}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.emptyTitle}>{t('hist.locked')}</Text>
      <Text style={styles.emptyBody}>{t('hist.locked.sub')}</Text>
      <PrimaryOutlineButton label={t('hist.locked.action')} onPress={onUnlock} style={styles.emptyAction} />
    </View>
  );
}

export function HistoryScreen() {
  const {
    events, filter, setFilter, period, setPeriod, periodOpen, togglePeriodOpen, selectEvent,
    historyLocked, unlockHistory, askDeleteMany,
  } = useAppState();
  const { shown } = useFilteredEvents(true);
  const landscape = useLandscape();

  // A card is wide and short: one per line wastes most of a landscape window.
  const perRow = landscape ? 2 : 1;
  const kept = useMemo(() => keptEventIds(events), [events]);
  const passages = useMemo(() => {
    const matched = new Set(shown.map(event => event.id));
    return groupPassages(events).filter(passage => passage.events.some(event => matched.has(event.id)) &&
      (filter === 'Toutes' || passage.kinds.includes(filter === 'Personnes' ? 'Personne' : 'Animal')));
  }, [events, shown, filter]);
  const byEvent = useMemo(() => new Map(passages.map(passage => [passage.summary.id, passage])), [passages]);
  const rows = useMemo(() => historyRows(passages.map(passage => passage.summary), perRow), [passages, perRow]);

  // Selection is by passage: a passage is one thing to the reader, so picking
  // it picks every clip in it. Held here, not in the provider — nothing else
  // reads it, and leaving the screen is a reason to drop it.
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const picking = picked.size > 0;
  const togglePick = useCallback((id: number) => setPicked(prev => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  }), []);
  // A passage that left the list (deleted, filtered out) cannot stay picked:
  // a delete must only ever take what is on screen.
  useEffect(() => {
    setPicked(prev => {
      const next = new Set([...prev].filter(id => byEvent.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [byEvent]);
  const deletePicked = useCallback(() => {
    askDeleteMany([...picked].flatMap(id => byEvent.get(id)?.events.map(e => e.id) ?? []));
  }, [askDeleteMany, byEvent, picked]);

  const resetFilters = useCallback(() => {
    setFilter('Toutes');
    setPeriod('Tout');
  }, [setFilter, setPeriod]);

  const unlock = useCallback(() => { unlockHistory(); }, [unlockHistory]);

  if (historyLocked) {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.title}>{t('hist.title')}</Text>
        </View>
        <LockedHistory onUnlock={unlock} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.title}>{t('hist.title')}</Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.count}>{tn('hist.passages.other', passages.length)}</Text>
      </View>

      {picking && (
        <View style={styles.pickBar} testID="history-pick-bar">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.pickCount} accessibilityLiveRegion="polite">
            {tn('hist.pick.count.other', picked.size)}
          </Text>
          <SecondaryOutlineButton label={t('hist.pick.delete')} icon={TrashIcon} onPress={deletePicked} />
          <TextButton label={t('hist.pick.cancel')} icon={CloseIcon} onPress={() => setPicked(new Set())} />
        </View>
      )}

      <View style={styles.filters}>
        <SegmentedControl options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
        <PeriodDropdown
          value={period}
          open={periodOpen}
          onToggle={togglePeriodOpen}
          onSelect={p => { setPeriod(p); togglePeriodOpen(); }}
        />
      </View>

      {periodOpen && (
        <Pressable style={styles.dismissOverlay} onPress={togglePeriodOpen} />
      )}

      <FlatList
        data={rows}
        keyExtractor={row => row.key}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (item.kind === 'day'
          ? <Text style={styles.dayHeading}>{formatDay(item.day)}</Text>
          : (
            <View style={styles.row}>
              {item.events.map(event => (
                <View key={event.id} style={styles.cell}>
                  <EventCard
                    event={event}
                    passage={byEvent.get(event.id)}
                    kept={kept.has(event.id)}
                    picked={picking ? picked.has(event.id) : undefined}
                    onPress={() => (picking ? togglePick(event.id) : selectEvent(event.id))}
                    onLongPress={() => togglePick(event.id)}
                  />
                </View>
              ))}
              {/* Keeps a lone last card the width of a column instead of
                  letting it stretch across the row. */}
              {item.events.length < perRow
                && <View style={[styles.cell, styles.cellFiller]} />}
            </View>
          ))}
        ItemSeparatorComponent={ItemSeparator}
        ListEmptyComponent={<EmptyHistory hasAnyEvent={events.length > 0} onReset={resetFilters} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  title: {
    fontFamily: font.medium,
    fontSize: 20,
    letterSpacing: -0.2,
    color: color.text,
  },
  count: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.neutral500,
  },
  pickBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  pickCount: {
    flex: 1,
    fontFamily: font.medium,
    fontSize: 13,
    color: color.text,
  },
  filters: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 9,
  },
  dismissOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 90,
    bottom: 0,
    zIndex: 20,
  },
  list: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  cell: {
    flex: 1,
  },
  cellFiller: {
    // Holds the empty half of an odd last row open.
    opacity: 0,
  },
  dayHeading: {
    fontFamily: font.medium,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: color.neutral500,
    paddingTop: 8,
    paddingBottom: 2,
  },
  emptyWrap: {
    paddingVertical: 40,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: {
    fontFamily: font.medium,
    fontSize: 14,
    color: color.neutral300,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: color.neutral600,
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: 4,
    minWidth: 160,
  },
  itemSeparator: {
    height: 8,
  },
});
