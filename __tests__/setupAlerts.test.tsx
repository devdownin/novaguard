/**
 * The Setup rows for ignored zones and quiet hours: what they say, and that
 * they reach the state they claim to change.
 *
 * @format
 */

import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../App';
import { SPLASH_TOTAL_MS } from '../src/components/SplashScreen';
import { defaultSettings } from '../src/state/defaults';
import { Settings } from '../src/state/types';

async function boot(settings: Partial<Settings>) {
  await AsyncStorage.setItem('@novaguard:onboardingComplete', JSON.stringify(true));
  await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({
    ...defaultSettings,
    ...settings,
    exp: { ...defaultSettings.exp, det: true, not: true },
  }));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { renderer = ReactTestRenderer.create(<App />); });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(SPLASH_TOTAL_MS + 50); });
  const tabs = renderer.root.findAll(n => n.props?.accessibilityRole === 'tab' && !!n.props?.onPress);
  await ReactTestRenderer.act(async () => { tabs[2].props.onPress(); });
  return renderer;
}

const labelOf = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(n => n.props?.testID === testID && typeof n.props?.accessibilityLabel === 'string')[0]
    ?.props.accessibilityLabel as string | undefined;

const hasSlider = (renderer: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  renderer.root.findAll(n => n.props?.testID === testID).length > 0;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ignored zones row', () => {
  it('says none are set on a fresh install', async () => {
    const renderer = await boot({});
    expect(labelOf(renderer, 'exclusions-button')).toBe('Zones ignorées : Aucune');
  });

  it('counts them', async () => {
    const box = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const renderer = await boot({ exclusions: [box, box] });
    expect(labelOf(renderer, 'exclusions-button')).toBe('Zones ignorées : 2 zones');
  });

  it('opens the editor on the camera tab, to draw one to ignore', async () => {
    const renderer = await boot({});
    const button = renderer.root.findAll(n => n.props?.testID === 'exclusions-button' && !!n.props?.onPress)[0];
    await ReactTestRenderer.act(async () => { button.props.onPress(); });
    const tabs = renderer.root.findAll(n => n.props?.accessibilityRole === 'tab' && !!n.props?.onPress);
    expect(tabs.map(n => n.props.accessibilityState?.selected)).toEqual([true, false, false]);
  });
});

describe('quiet hours row', () => {
  it('hides the hours until the switch is on', async () => {
    const renderer = await boot({});
    expect(hasSlider(renderer, 'setup.quiet.start')).toBe(false);
  });

  it('shows both hours and what they mean once on', async () => {
    const renderer = await boot({ quietHours: true, quietStart: 22, quietEnd: 7 });
    expect(hasSlider(renderer, 'setup.quiet.start')).toBe(true);
    expect(hasSlider(renderer, 'setup.quiet.end')).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).toContain('Aucune alerte de 22 h à 7 h.');
  });

  it('says so when the window is empty', async () => {
    const renderer = await boot({ quietHours: true, quietStart: 7, quietEnd: 7 });
    expect(JSON.stringify(renderer.toJSON())).toContain('Début et fin identiques : aucune heure calme.');
  });
});
