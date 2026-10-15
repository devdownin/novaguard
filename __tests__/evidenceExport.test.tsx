/**
 * A passage handed over as evidence: every clip it left and a report whose
 * SHA-256 lets the receiver check nothing was altered. One clip at a time was
 * the only way out, and a long passage is several clips.
 *
 * @format
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppStateProvider, useAppState } from '../src/state/AppStateContext';
import { VideoDetailSheet } from '../src/components/VideoDetailSheet';
import { hashRecording, shareEvidence } from '../src/surveillance/foregroundService';
import { evidenceClips, evidenceReport, evidenceReportName } from '../src/recording/evidence';
import { groupPassages } from '../src/recording/passages';
import { DetectionEvent } from '../src/state/types';
import { AppState } from '../testing/mountProvider';
import { formatWhen } from '../src/utils/date';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

const EVENTS_KEY = '@novaguard:events:v2';
const START = new Date(2026, 9, 15, 18, 4, 30).getTime();
const DIR = '/data/user/0/com.novaguard/files/recordings';
const clip = (id: number, offsetS: number, path: string | null, over: Partial<DetectionEvent> = {}): DetectionEvent => ({
  id, passageId: 'p1', kind: 'Personne', kinds: ['Personne'], timestamp: START + offsetS * 1000, dur: 60, conf: 88,
  path, bytes: path ? 12_000_000 : 0, thumbPath: null, ...over,
});
const PASSAGE = [clip(1, 0, `${DIR}/a.mp4`), clip(2, 60, null), clip(3, 61, `${DIR}/b.mp4`, { kinds: ['Animal'], kind: 'Animal' })];

describe('the report', () => {
  const passage = groupPassages(PASSAGE)[0];
  const report = evidenceReport(passage, [
    { event: PASSAGE[0], sha256: 'a'.repeat(64) },
    { event: PASSAGE[2], sha256: '' },
  ], START + 3_600_000, true);

  it('carries only the clips that have a file, oldest first', () => {
    expect(evidenceClips(passage).map(e => e.id)).toEqual([1, 3]);
  });

  it('says when the passage ran, what was seen, and what is missing', () => {
    expect(report).toContain(t('evidence.window', { start: formatWhen(START), end: formatWhen(START + 121_000) }));
    expect(report).toContain(t('evidence.kinds', { kinds: 'Personne, Animal' }));
    expect(report).toContain(t('evidence.missing', { count: 1 }));
    expect(report).toContain(t('evidence.kept'));
  });

  it('gives each clip its fingerprint, and says so when one could not be read', () => {
    expect(report).toContain('1. a.mp4');
    expect(report).toContain(`SHA-256 ${'a'.repeat(64)}`);
    expect(report).toContain('2. b.mp4');
    expect(report).toContain(`SHA-256 ${t('evidence.hashUnavailable')}`);
  });

  it('is named after the passage, with nothing a file system refuses', () => {
    expect(evidenceReportName(passage)).toBe('NovaGuard_2026-10-15_18-04.txt');
  });
});

describe('the sheet', () => {
  const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
  const flush = async (turns = 4) => { for (let i = 0; i < turns; i++) await ReactTestRenderer.act(async () => {}); };

  async function openSheet(events: DetectionEvent[], id: number) {
    await AsyncStorage.setItem(EVENTS_KEY, JSON.stringify(events));
    const handle = {} as { state: AppState };
    function Probe() { handle.state = useAppState(); return null; }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<AppStateProvider><Probe /><VideoDetailSheet /></AppStateProvider>);
    });
    mounted.push(tree);
    await flush();
    await ReactTestRenderer.act(async () => { handle.state.selectEvent(id); });
    await flush(1);
    return tree;
  }
  const exportButton = (tree: ReactTestRenderer.ReactTestRenderer) =>
    tree.root.findAll(node => node.props.label === t('detail.export') && typeof node.props.onPress === 'function')[0] ?? null;
  const texts = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findAllByType(Text).map(n => String(n.props.children));

  beforeEach(async () => { jest.clearAllMocks(); await AsyncStorage.clear(); });
  afterEach(async () => {
    await flush(2);
    for (const tree of mounted.splice(0)) await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('hands over every clip of the passage and the report, from any of its clips', async () => {
    const tree = await openSheet(PASSAGE, 3);
    await ReactTestRenderer.act(async () => { await exportButton(tree)!.props.onPress(); });
    expect((hashRecording as jest.Mock).mock.calls.map(c => c[0])).toEqual([`${DIR}/a.mp4`, `${DIR}/b.mp4`]);
    expect(shareEvidence).toHaveBeenCalledTimes(1);
    const [paths, report, name] = (shareEvidence as jest.Mock).mock.calls[0];
    expect(paths).toEqual([`${DIR}/a.mp4`, `${DIR}/b.mp4`]);
    expect(report).toContain(`SHA-256 ${'ab'.repeat(32)}`);
    expect(name).toBe('NovaGuard_2026-10-15_18-04.txt');
  });

  it('says so when nothing could be handed over', async () => {
    (shareEvidence as jest.Mock).mockReturnValueOnce(false);
    const tree = await openSheet(PASSAGE, 1);
    await ReactTestRenderer.act(async () => { await exportButton(tree)!.props.onPress(); });
    expect(texts(tree)).toContain(t('detail.exportError'));
  });

  it('offers no export for a sighting with no file', async () => {
    const tree = await openSheet([clip(9, 0, null, { passageId: undefined })], 9);
    expect(exportButton(tree)).toBeNull();
  });
});
