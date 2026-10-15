import type { DetectionEvent } from '../state/types';
import type { Passage } from './passages';
import { formatBytes } from './library';
import { formatWhen } from '../utils/date';
import { t, tValue } from '../i18n';

/**
 * A passage handed over as evidence: every clip it left, and a report that
 * says what they are and lets anyone check they were not altered.
 *
 * One clip at a time was the only way out, and a long passage is several clips
 * — the one an insurer needs is rarely the one that was shared. The report is
 * plain text on purpose: it opens everywhere, prints, and survives being
 * forwarded through a messaging app that would mangle anything richer.
 */
export interface EvidenceClip {
  event: DetectionEvent;
  /** Lower-case hex SHA-256 of the file, or '' when it could not be read. */
  sha256: string;
}

/** The clips that can travel: those with a file, oldest first. */
export function evidenceClips(passage: Passage): DetectionEvent[] {
  return passage.events.filter(event => event.path != null);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `NovaGuard_2026-10-15_18-04.txt`: sorts by date, and no character a file system refuses. */
export function evidenceReportName(passage: Passage): string {
  const d = new Date(passage.events[0].timestamp);
  return `NovaGuard_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.txt`;
}

export function evidenceReport(passage: Passage, clips: EvidenceClip[], exportedAt: number, kept: boolean): string {
  const first = passage.events[0];
  const last = passage.events[passage.events.length - 1];
  const end = last.timestamp + last.dur * 1000;
  const lines = [
    t('evidence.title'),
    t('evidence.exportedAt', { time: formatWhen(exportedAt) }),
    '',
    t('evidence.window', { start: formatWhen(first.timestamp), end: formatWhen(end) }),
    t('evidence.kinds', { kinds: passage.kinds.map(kind => tValue(`value.kind.${kind}`)).join(', ') }),
    t('evidence.clips', { count: clips.length }),
  ];
  if (passage.missingCount > 0) lines.push(t('evidence.missing', { count: passage.missingCount }));
  if (kept) lines.push(t('evidence.kept'));
  lines.push('');
  clips.forEach(({ event, sha256 }, index) => {
    lines.push(t('evidence.clip', {
      index: index + 1,
      file: event.path!.split('/').pop()!,
      time: formatWhen(event.timestamp),
      dur: event.dur,
      conf: event.conf,
      size: formatBytes(event.bytes),
    }));
    lines.push(`   SHA-256 ${sha256 || t('evidence.hashUnavailable')}`);
  });
  lines.push('', t('evidence.verify'));
  return lines.join('\n') + '\n';
}
