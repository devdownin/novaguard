/**
 * Calibration mode: what the detector saw that the app does not follow.
 *
 * @format
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCameraPermission } from 'react-native-vision-camera';
import { calibrationProbes, NO_PROBES } from '../src/ml/calibration';
import { DEFAULT_TRACKER_OPTIONS, Track, updateTracks } from '../src/ml/tracker';
import { FrameDetection } from '../src/ml/types';
import { mountLegacyProvider } from '../testing/mountProvider';
import { useViewfinderState, ViewfinderState } from '../src/state/AppStateContext';

jest.mock('../src/surveillance/foregroundService');

const person = (x: number, confidence = 0.9, width = 0.2): FrameDetection =>
  ({ kind: 'Personne', confidence, box: { x, y: 0.3, width, height: 0.5 } });

describe('calibrationProbes', () => {
  const confirmed = (detection: FrameDetection, from = 0): Track[] => {
    let tracks: Track[] = [];
    for (let i = 0; i < DEFAULT_TRACKER_OPTIONS.confirmAfter; i++) tracks = updateTracks(tracks, [detection], from + i * 200);
    return tracks;
  };

  it('is empty, and the shared empty array, when everything seen is followed', () => {
    const tracks = confirmed(person(0.3));
    expect(calibrationProbes([person(0.3)], tracks, tracks)).toBe(NO_PROBES);
  });

  it('names a track still waiting for confirmation', () => {
    const tracks = updateTracks([], [person(0.3)], 0);
    expect(calibrationProbes([person(0.3)], tracks, tracks).map(p => p.state)).toEqual(['pending']);
  });

  it('names a confirmed track the app holds as scenery', () => {
    const tracks = confirmed(person(0.3));
    expect(calibrationProbes([person(0.3)], tracks, []).map(p => p.state)).toEqual(['scenery']);
  });

  it('names a detection that opened nothing, and keeps its confidence', () => {
    const weak = person(0.6, 0.35);
    const tracks = updateTracks([], [weak], 0);
    expect(tracks).toHaveLength(0);
    const probes = calibrationProbes([weak], tracks, tracks);
    expect(probes.map(p => [p.state, p.confidence])).toEqual([['below', 0.35]]);
  });

  it('does not draw a track the detector missed this look', () => {
    let tracks = confirmed(person(0.3));
    tracks = updateTracks(tracks, [], 1000);
    expect(tracks[0].misses).toBeGreaterThan(0);
    expect(calibrationProbes([], tracks, [])).toBe(NO_PROBES);
  });
});

describe('in the app', () => {
  const box = {} as { viewfinder: ViewfinderState };
  function Spy() { box.viewfinder = useViewfinderState(); return null; }

  beforeEach(async () => {
    jest.useFakeTimers();
    (useCameraPermission as jest.Mock).mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
    await AsyncStorage.clear();
  });
  afterEach(() => jest.useRealTimers());

  it('publishes probes only while the setting is on', async () => {
    const handle = await mountLegacyProvider(<Spy />);
    await ReactTestRenderer.act(async () => { handle.state.toggleMonitoring(); });
    const weak = person(0.6, 0.35);

    await ReactTestRenderer.act(async () => { handle.state.reportDetections([weak], 9 / 16); });
    expect(box.viewfinder.probes).toHaveLength(0);

    await ReactTestRenderer.act(async () => { handle.state.toggleCalibration(); });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(300);
      handle.state.reportDetections([weak], 9 / 16);
    });
    expect(box.viewfinder.probes.map(p => p.state)).toEqual(['below']);
    expect(JSON.parse((await AsyncStorage.getItem('@novaguard:settings'))!).calibration).toBe(true);

    await ReactTestRenderer.act(async () => { handle.state.toggleCalibration(); });
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(300);
      handle.state.reportDetections([weak], 9 / 16);
    });
    expect(box.viewfinder.probes).toHaveLength(0);
  });
});
