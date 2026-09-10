import React, { useCallback, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, MAX_FONT_SCALE } from '../theme';
import { useAppState, useFilteredEvents } from '../state/AppStateContext';
import { HistoryFilter } from '../state/types';
import { SegmentedControl } from '../components/SegmentedControl';
import { PeriodDropdown } from '../components/PeriodDropdown';
import { EventCard } from '../components/EventCard';
import { PrimaryOutlineButton } from '../components/OutlineButton';
import { historyRows } from '../recording/library';
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

export function HistoryScreen() {
  const {
    events, filter, setFilter, period, setPeriod, periodOpen, togglePeriodOpen, selectEvent,
  } = useAppState();
  const { shown } = useFilteredEvents();
  const landscape = useLandscape();

  // A card is wide and short: one per line wastes most of a landscape window.
  const perRow = landscape ? 2 : 1;
  const rows = useMemo(() => historyRows(shown, perRow), [shown, perRow]);

  const resetFilters = useCallback(() => {
    setFilter('Toutes');
    setPeriod('Tout');
  }, [setFilter, setPeriod]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.title}>{t('hist.title')}</Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.count}>{tn('hist.count.other', shown.length)}</Text>
      </View>

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
                  <EventCard event={event} onPress={() => selectEvent(event.id)} />
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
