import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Video from 'react-native-video';
import { color, font, radius, MAX_FONT_SCALE } from '../theme';
import { useAppState } from '../state/AppStateContext';
import { groupPassages } from '../recording/passages';
import { formatBytes, keptEventIds } from '../recording/library';
import { t, tValue } from '../i18n';
import { hashRecording, shareEvidence, shareRecording } from '../surveillance/foregroundService';
import { evidenceClips, evidenceReport, evidenceReportName } from '../recording/evidence';
import { formatWhen } from '../utils/date';
import { Sheet } from './Sheet';
import { BookmarkIcon, CloseIcon, IconProps, PlayIcon, ShareIcon, TrashIcon } from './icons';
import { ClipThumbnail } from './ClipThumbnail';
import { PrimaryOutlineButton, SecondaryOutlineButton, TextButton } from './OutlineButton';

/** The filled bookmark: the passage is held, and the button now releases it. */
function KeptIcon(props: IconProps) {
  return <BookmarkIcon {...props} filled />;
}

export function VideoDetailSheet() {
  const { selected, selectedEvent, events, selectEvent, askDelete, toggleKeep, setAgentNote } = useAppState();
  const [playback, setPlayback] = useState<{ root: number; clip: number; all: boolean; running: boolean } | null>(null);
  const active = useRef<typeof playback>(null);
  const [playFailed, setPlayFailed] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const passage = useMemo(() => groupPassages(events).find(group => group.events.some(clip => clip.id === selected)), [events, selected]);
  const clips = useMemo(() => passage?.events ?? [], [passage]);
  const playable = useMemo(() => clips.filter(clip => clip.path != null), [clips]);
  const current = playback?.root === selected ? clips.find(clip => clip.id === playback.clip) : null;
  const event = selectedEvent ? current ?? selectedEvent : null;
  const playing = !!current && current.path != null && playback?.running === true;
  const updatePlayback = useCallback((next: typeof playback) => {
    active.current = next;
    setPlayback(next);
  }, []);
  useEffect(() => {
    updatePlayback(null); setPlayFailed(false); setShareFailed(false); setExportFailed(false);
  }, [selected, updatePlayback]);
  useEffect(() => {
    if (playback && !clips.some(clip => clip.id === playback.clip && clip.path != null)) {
      updatePlayback(null); setPlayFailed(true);
    }
  }, [clips, playback, updatePlayback]);
  const close = useCallback(() => {
    updatePlayback(null);
    selectEvent(null);
  }, [selectEvent, updatePlayback]);
  const start = (all: boolean) => {
    const first = all ? playable[0] : event;
    if (!first?.path || selected == null) return;
    setPlayFailed(false);
    updatePlayback({ root: selected, clip: first.id, all, running: true });
  };
  const finish = (failed: boolean) => {
    if (!playback?.running || active.current !== playback) return;
    const index = playable.findIndex(clip => clip.id === playback.clip);
    const next = playable[index + 1];
    if (!failed && playback.all && next) updatePlayback({ ...playback, clip: next.id });
    else { updatePlayback({ ...playback, running: false }); if (failed) setPlayFailed(true); }
  };
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
  /** The clip of the passage an agent annotated, if any: it looked at one, the note is about the visit. */
  const noted = useMemo(() => clips.find(clip => clip.agentNote), [clips]);
  const kept = useMemo(() => selected != null && keptEventIds(events).has(selected), [events, selected]);

  /**
   * The same door, for a whole passage: every clip and a report carrying their
   * SHA-256, so whoever receives them can check nothing was altered on the way.
   * Hashed one clip at a time, off the JS thread; the sheet says it is working
   * because a long 4K passage takes seconds.
   */
  const exportPassage = useCallback(async () => {
    if (!passage || exporting) return;
    const travelling = evidenceClips(passage);
    if (travelling.length === 0) { setExportFailed(true); return; }
    setExporting(true);
    setExportFailed(false);
    try {
      const hashed = [];
      for (const clip of travelling) hashed.push({ event: clip, sha256: await hashRecording(clip.path!) });
      const report = evidenceReport(passage, hashed, Date.now(), kept);
      setExportFailed(!shareEvidence(travelling.map(clip => clip.path!), report, evidenceReportName(passage)));
    } finally {
      setExporting(false);
    }
  }, [passage, exporting, kept]);

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
                key={event.id}
                source={{ uri: `file://${event.path}` }}
                style={StyleSheet.absoluteFill}
                resizeMode="contain"
                controls
                paused={false}
                onEnd={() => finish(false)}
                onError={() => finish(true)}
              />
            ) : hasClip ? (
              <Pressable
                style={({ pressed }) => [styles.playButton, pressed && { opacity: 0.62 }]}
                onPress={() => start(false)}
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

          {clips.length > 1 && <View style={styles.passageControls}>
            <Text style={styles.cellValue} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {t('detail.sequence', { index: clips.findIndex(clip => clip.id === event.id) + 1, count: clips.length })}
            </Text>
            {playable.length > 0 && <PrimaryOutlineButton label={t('detail.playPassage')} icon={PlayIcon} onPress={() => start(true)} />}
            {(passage?.missingCount ?? 0) > 0 && <Text style={styles.cellValue} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {t('hist.passage.missing', { count: passage!.missingCount })}
            </Text>}
            {clips.map((clip, index) => <TextButton key={clip.id}
              label={t(clip.path ? 'detail.selectSequence' : 'detail.missingSequence', { index: index + 1 })}
              icon={clip.path ? PlayIcon : undefined}
              onPress={() => { updatePlayback(null); selectEvent(clip.id); }} />)}
          </View>}
          {playFailed && <Text style={styles.playError} accessibilityLiveRegion="polite">{t('detail.playError')}</Text>}

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
              value={hasClip ? event.path!.split('/').pop()! : t('detail.file.none')}
              small
            />
          </View>

          {shareFailed && <Text style={styles.shareError}>{t('detail.shareError')}</Text>}
          {playable.length > 0 && (
            <View style={styles.export}>
              <SecondaryOutlineButton
                label={t(exporting ? 'detail.export.busy' : 'detail.export')}
                icon={ShareIcon}
                onPress={exportPassage}
                disabled={exporting}
              />
              <Text style={styles.exportNote}>{t('detail.export.sub')}</Text>
            </View>
          )}
          {exportFailed && <Text style={styles.shareError} accessibilityLiveRegion="polite">{t('detail.exportError')}</Text>}
          {kept && <Text style={styles.keptNote} maxFontSizeMultiplier={MAX_FONT_SCALE}>{t('detail.kept')}</Text>}
          {noted?.agentNote && (
            <View style={styles.agentNote} testID="agent-note">
              <Text style={styles.agentNoteTitle}>
                {t('detail.agentNote', { verdict: tValue(`value.verdict.${noted.agentNote.verdict}`), time: formatWhen(noted.agentNote.at) })}
              </Text>
              {noted.agentNote.text ? <Text style={styles.agentNoteText}>{noted.agentNote.text}</Text> : null}
              <TextButton label={t('detail.agentNote.clear')} onPress={() => setAgentNote(noted.id, null)} />
            </View>
          )}

          <View style={styles.actions}>
            {hasClip && (
              <PrimaryOutlineButton label={t('detail.share')} icon={ShareIcon} onPress={share} iconPosition="top" style={styles.action} />
            )}
            <SecondaryOutlineButton label={t(kept ? 'detail.unkeep' : 'detail.keep')} icon={kept ? KeptIcon : BookmarkIcon} onPress={toggleKeep}
              iconPosition="top" style={styles.action} />
            <SecondaryOutlineButton label={t(clips.length > 1 ? 'detail.deleteSequence' : 'detail.delete')} icon={TrashIcon} onPress={() => { updatePlayback(null); selectEvent(event.id); askDelete(); }} iconPosition="top" style={styles.action} />
            <TextButton label={t('detail.close')} icon={CloseIcon} onPress={close} iconPosition="top" style={styles.action} />
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
  passageControls: { gap: 8, marginTop: 12 },
  export: { marginTop: 14, gap: 6 },
  agentNote: {
    marginTop: 12, padding: 10, gap: 4, borderRadius: 10, borderWidth: 1, borderColor: color.divider, backgroundColor: color.surface,
  },
  agentNoteTitle: { color: color.text, fontFamily: font.medium, fontSize: 12 },
  agentNoteText: { color: color.neutral400, fontFamily: font.regular, fontSize: 12, lineHeight: 17 },
  exportNote: { color: color.neutral500, fontFamily: font.regular, fontSize: 11, lineHeight: 15 },
  keptNote: { color: color.accent, fontFamily: font.regular, fontSize: 12, marginTop: 10 },
  playError: { color: color.warning, fontFamily: font.regular, fontSize: 12, marginTop: 10 },
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
