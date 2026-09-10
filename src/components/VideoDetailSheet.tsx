import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Video from 'react-native-video';
import { color, font, radius, MAX_FONT_SCALE } from '../theme';
import { useAppState } from '../state/AppStateContext';
import { formatBytes } from '../recording/library';
import { t, tValue } from '../i18n';
import { shareRecording } from '../surveillance/foregroundService';
import { formatWhen } from '../utils/date';
import { Sheet } from './Sheet';
import { PlayIcon } from './icons';
import { ClipThumbnail } from './ClipThumbnail';
import { PrimaryOutlineButton, SecondaryOutlineButton, TextButton } from './OutlineButton';

export function VideoDetailSheet() {
  const { selected, selectedEvent: event, selectEvent, askDelete } = useAppState();
  const [playing, setPlaying] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);

  // Never carry playback over from the previously opened event.
  useEffect(() => { setPlaying(false); setShareFailed(false); }, [selected]);

  const close = useCallback(() => {
    setPlaying(false);
    selectEvent(null);
  }, [selectEvent]);

  const path = event?.path ?? null;
  /**
   * The one door out of the device, and it takes a tap.
   *
   * Clips are written to the app's private directory precisely so nothing can
   * read them — but footage nobody can ever hand to an insurer or the police is
   * not evidence either. Reported when it fails: the file may have been
   * reclaimed by the retention sweep since this sheet was opened, and a button
   * that silently does nothing is the failure this repo has already shipped once.
   */
  const share = useCallback(() => {
    if (!path) return;
    setShareFailed(!shareRecording(path));
  }, [path]);

  const hasClip = !!path;

  return (
    <Sheet visible={!!event} onClose={close}>
      {event && (
        <View>
          <View style={styles.preview}>
            {/* Hidden while the video plays: an <Image> over the surface would
                cover the first frames it draws. */}
            {!playing && (
              <ClipThumbnail
                path={event.thumbPath ?? null}
                colors={['#252838', '#0f1119']}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}
              />
            )}

            {hasClip && playing ? (
              <Video
                source={{ uri: `file://${event.path}` }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
                controls
                paused={false}
                onEnd={() => setPlaying(false)}
                onError={() => setPlaying(false)}
              />
            ) : hasClip ? (
              <Pressable
                style={({ pressed }) => [styles.playButton, pressed && { opacity: 0.62 }]}
                onPress={() => setPlaying(true)}
                accessibilityRole="button"
                accessibilityLabel={t('detail.play')}
              >
                <PlayIcon size={16} color={color.accent} />
              </Pressable>
            ) : (
              // A sighting with no file: recording was refused, the disk was
              // full, or the clip has been reclaimed. Say so instead of showing
              // a play button that would do nothing.
              <Text style={styles.noClip}>{t('detail.noClip')}</Text>
            )}
          </View>

          <View style={styles.titleRow}>
            <View style={styles.dot} />
            <Text style={styles.title}>{t(event.kind === 'Personne' ? 'hist.event.person' : 'hist.event.animal')}</Text>
          </View>

          <View style={styles.grid}>
            <StatCell label={t('detail.when')} value={formatWhen(event.timestamp)} />
            <StatCell label={t('detail.type')} value={tValue(`value.kind.${event.kind}`)} />
            <StatCell label={t('detail.duration')} value={t('detail.seconds', { dur: event.dur })} />
            <StatCell label={t('detail.confidence')} value={t('detail.percent', { value: event.conf })} accent />
            <StatCell label={t('detail.size')} value={hasClip ? formatBytes(event.bytes) : '—'} />
            <StatCell
              label={t('detail.file')}
              value={hasClip ? event.path!.split('/').pop()! : 'Aucun'}
              small
            />
          </View>

          {shareFailed && (
            <Text style={styles.shareError}>
              PARTAGE IMPOSSIBLE · LE FICHIER N'EST PLUS LÀ
            </Text>
          )}

          <View style={styles.actions}>
            {hasClip && (
              <PrimaryOutlineButton label={t('detail.share')} onPress={share} style={styles.action} />
            )}
            <SecondaryOutlineButton label={t('detail.delete')} onPress={askDelete} style={styles.action} />
            <TextButton label={t('detail.close')} onPress={close} style={styles.action} />
          </View>
        </View>
      )}
    </Sheet>
  );
}

interface StatCellProps {
  label: string;
  value: string;
  accent?: boolean;
  /** For the file name, which is long enough to need the room. */
  small?: boolean;
}

function StatCell({ label, value, accent, small }: StatCellProps) {
  return (
    <View style={styles.cell}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.cellLabel}>{label}</Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cellValue, small && styles.cellValueSmall, accent && styles.cellValueAccent]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    aspectRatio: 16 / 10,
    borderRadius: radius.lg - 2,
    overflow: 'hidden',
  },
  playButton: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 50,
    height: 50,
    marginLeft: -25,
    marginTop: -25,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: color.accent,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(22,24,38,0.5)',
  },
  noClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    marginTop: -6,
    textAlign: 'center',
    fontFamily: font.regular,
    fontSize: 9.5,
    letterSpacing: 1.6,
    color: color.neutral600,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 15,
    marginBottom: 12,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.accent },
  title: { fontFamily: font.medium, fontSize: 17, color: color.text },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 1,
    backgroundColor: color.divider,
    borderRadius: 10,
    overflow: 'hidden',
  },
  cell: {
    width: '49.95%',
    backgroundColor: color.surface,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  cellLabel: {
    fontFamily: font.regular,
    fontSize: 9.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: color.neutral600,
  },
  cellValue: {
    fontFamily: font.regular,
    fontSize: 13,
    color: color.text,
    marginTop: 2,
  },
  cellValueSmall: {
    fontSize: 11,
    lineHeight: 15,
  },
  cellValueAccent: {
    color: color.accent300,
  },
  actions: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 14,
  },
  action: { flex: 1 },
  shareError: {
    fontFamily: font.regular,
    fontSize: 9.5,
    letterSpacing: 1.2,
    color: color.neutral500,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: -2,
  },
});
