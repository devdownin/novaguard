/**
 * The "Services MCP" page, opened from Réglages: every service the server
 * offers, and whether an agent can drive the camera right now.
 *
 * @format
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from 'react-native';
import { useCameraPermission } from 'react-native-vision-camera';
import { AppStateProvider } from '../src/state/AppStateContext';
import { SetupScreen } from '../src/screens/SetupScreen';
import { McpServicesSheet } from '../src/components/McpServicesSheet';
import { defaultSettings } from '../src/state/defaults';
import { CONTROL_TOOLS, PROMPTS, READ_TOOLS, TOOL_PREFIX } from '../src/surveillance/mcpServices';
import { Settings } from '../src/state/types';
import { formatWhen } from '../src/utils/date';
import { t } from '../src/i18n';

jest.mock('../src/surveillance/foregroundService');

let tree: ReactTestRenderer.ReactTestRenderer;

async function openPage(stored: Partial<Settings> = {}) {
  await AsyncStorage.setItem('@novaguard:settings', JSON.stringify({
    ...defaultSettings, exp: { ...defaultSettings.exp, mcp: true, adv: true }, ...stored,
  }));
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<AppStateProvider><SetupScreen /><McpServicesSheet /></AppStateProvider>);
  });
  await ReactTestRenderer.act(async () => {});
  const button = tree.root.find(node => node.props.label === t('setup.mcpServices') && node.props.onPress);
  await ReactTestRenderer.act(async () => { button.props.onPress(); });
}

const texts = () => tree.root.findAllByType(Text).map(node => String(node.props.children));
const controlNote = () => tree.root.findByProps({ testID: 'mcp-services-control' })
  .findAllByType(Text).map(node => String(node.props.children))[1];

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (useCameraPermission as jest.Mock).mockReturnValue({ hasPermission: true, requestPermission: jest.fn() });
});
afterEach(async () => {
  if (tree) await ReactTestRenderer.act(async () => { tree.unmount(); });
});

it('opens from Réglages and lists every tool, prompt and limit', async () => {
  await openPage();
  const shown = texts();
  expect(shown).toContain(t('mcpService.title'));
  for (const name of [...READ_TOOLS, ...CONTROL_TOOLS]) expect(shown).toContain(TOOL_PREFIX + name);
  for (const name of PROMPTS) expect(shown).toContain(name);
  expect(shown).toContain('novaguard://video/{eventId}');
  expect(shown).toContain(t('mcpService.never'));
  expect(shown).toContain(t('mcpService.status.stopped'));
});

it('says why an agent cannot drive the camera', async () => {
  await openPage({ mcpEnabled: true });
  expect(controlNote()).toBe(t('mcpService.control.switchOff'));
});

it('says an expired control token is expired', async () => {
  await openPage({ mcpEnabled: true, mcpControlEnabled: true, mcpControlToken: 'mcp_' + 'k'.repeat(32), mcpControlExpiresAt: 1 });
  expect(controlNote()).toBe(t('mcpService.control.expired'));
});

it('says until when control is available', async () => {
  const until = Date.now() + 3_600_000;
  await openPage({ mcpEnabled: true, mcpControlEnabled: true, mcpControlToken: 'mcp_' + 'k'.repeat(32), mcpControlExpiresAt: until });
  expect(controlNote()).toBe(t('mcpService.control.availableUntil', { time: formatWhen(until) }));
});
