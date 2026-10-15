import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, font, MAX_FONT_SCALE } from '../theme';
import { DetectionEvent } from '../state/types';
import { formatDuration, formatTimeOfDay, formatWhen } from '../utils/date';
import { ChevronRightIcon } from './icons';
import { ClipThumbnail } from './ClipThumbnail';
import { t, tValue } from '../i18n';
import { Passage } from '../recording/passages';

export function EventCard({ event, onPress, onLongPress, passage, kept = false, picked }: {
  event: DetectionEvent; onPress: () => void; onLongPress?: () => void; passage?: Passage; kept?: boolean;
  /** Undefined outside selection mode; a boolean while the history is being picked from. */
  picked?: boolean;
}) {
  // Any clip of the passage may carry it: the agent annotates the event it looked at.
  const note = (passage?.events ?? [event]).find(e => e.agentNote)?.agentNote;
  const title = passage && passage.kinds.length > 1 ? t('hist.passage.mixed') : t(event.kind === 'Personne' ? 'hist.event.person' : 'hist.event.animal');
  const durLabel = formatDuration(event.dur);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityHint={onLongPress && picked === undefined ? t('hist.pick.hint') : undefined}
      accessibilityState={picked === undefined ? undefined : { selected: picked }}
      // One announcement for the card, not four fragments: `accessible` groups
      // the thumbnail, the title, the time and the meta line into one target.
      accessible
      accessibilityRole="button"
      accessibilityLabel={passage && passage.events.length > 1 ? t('a11y.passage', { title, when: formatWhen(event.timestamp), count: passage.events.length, duration: durLabel }) : t('a11y.event', { title, when: formatWhen(event.timestamp) })}
      style={({ pressed }) => [styles.card, picked && styles.cardPicked, pressed && styles.cardPressed]}
    >
      <View style={styles.thumb}>
        <ClipThumbnail
          path={event.thumbPath ?? null}
          colors={['#252838', '#14161f']}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          placeholder={<View style={styles.thumbFrame} />}
        />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.thumbDur}>{durLabel}</Text>
      </View>
      <View style={styles.info}>
        <View style={styles.titleRow}>
          <View style={styles.dot} />
          <Text style={styles.title}>{title}</Text>
        </View>
        {/* The clock alone: the day is on the heading this card sits under, and
            the full instant is still what the reader is given (below) and what
            the detail sheet shows. */}
        <Text style={styles.when}>{formatTimeOfDay(event.timestamp)}</Text>
        {/* The one thing about an event the list could not otherwise tell you.
            The duration was already on the thumbnail, in the form a video is
            read in, and the confidence is an engineer's number the detail sheet
            already carries — while an event whose encoder produced no file
            looked exactly like the others, and was opened to find out. */}
        {passage && passage.events.length > 1 && <Text style={styles.when}>{t('hist.passage.clips', { count: passage.events.length })}</Text>}
        {passage && passage.missingCount > 0 && passage.events.length > 1 && <Text style={styles.noClip}>{t('hist.passage.missing', { count: passage.missingCount })}</Text>}
        {event.path == null && <Text style={styles.noClip}>{t('hist.event.noClip')}</Text>}
        {kept && <Text style={styles.kept}>{t('hist.event.kept')}</Text>}
        {note && <Text style={note.verdict === 'attention' ? styles.noteAttention : styles.note} numberOfLines={1}>
          {t('hist.event.agentNote', { verdict: tValue(`value.verdict.${note.verdict}`) })}
        </Text>}
      </View>
      <ChevronRightIcon size={7} color={color.neutral700} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 11,
    alignItems: 'center',
    width: '100%',
    padding: 9,
    borderRadius: 11,
    backgroundColor: color.surface,
  },
  cardPicked: {
    borderWidth: 1.5,
    borderColor: color.accent,
    padding: 7.5,
  },
  cardPressed: {
    backgroundColor: color.neutral900,
  },
  thumb: {
    width: 74,
    height: 52,
    borderRadius: 7,
    overflow: 'hidden',
  },
  thumbFrame: {
    position: 'absolute',
    left: 9,
    top: 8,
    width: 26,
    height: 34,
    borderWidth: 1,
    borderColor: color.accent600,
    borderRadius: 3,
  },
  thumbDur: {
    position: 'absolute',
    right: 5,
    bottom: 4,
    // Legible over a still as well as over the flat placeholder it used to sit on.
    paddingHorizontal: 3,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
    fontFamily: font.regular,
    fontSize: 8.5,
    color: color.neutral400,
    fontVariant: ['tabular-nums'],
  },
  info: {
    flex: 1,
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: color.accent,
  },
  title: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.text,
  },
  when: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.neutral500,
    fontVariant: ['tabular-nums'],
  },
  noClip: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.neutral400,
  },
  kept: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.accent,
  },
  note: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.neutral400,
  },
  noteAttention: {
    fontFamily: font.medium,
    fontSize: 11,
    color: color.warning,
  },
});
