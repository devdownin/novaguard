import AsyncStorage from '@react-native-async-storage/async-storage';
import { CONNECT_LAST_KEY, loadLast, parseLast, saveLast } from '../src/surveillance/connectMemory';

beforeEach(async () => { await AsyncStorage.clear(); });

describe('parseLast', () => {
  it('accepts what the screen could have produced', () => {
    expect(parseLast(JSON.stringify({ where: 'lan', agent: 'claude-code', access: 'read' })))
      .toEqual({ where: 'lan', agent: 'claude-code', access: 'read' });
    expect(parseLast(JSON.stringify({ where: 'cloud', agent: 'chatgpt', access: 'read' }))).not.toBeNull();
  });
  it.each([
    ['nothing', null],
    ['not JSON', '{oops'],
    ['not an object', '42'],
    ['an unknown place', JSON.stringify({ where: 'moon', agent: 'json', access: 'read' })],
    ['an agent that place does not offer', JSON.stringify({ where: 'cloud', agent: 'claude-code', access: 'read' })],
    ['an unknown agent', JSON.stringify({ where: 'lan', agent: 'nobody', access: 'read' })],
    ['an unknown access level', JSON.stringify({ where: 'lan', agent: 'json', access: 'root' })],
  ])('rejects %s', (_name, raw) => {
    expect(parseLast(raw as string | null)).toBeNull();
  });
});

describe('storage', () => {
  it('remembers the last choice and gives it back', async () => {
    await saveLast({ where: 'phone', agent: 'hermes', access: 'read' });
    expect(await loadLast()).toEqual({ where: 'phone', agent: 'hermes', access: 'read' });
  });
  it('treats a damaged entry as no memory rather than an error', async () => {
    await AsyncStorage.setItem(CONNECT_LAST_KEY, '{damaged');
    expect(await loadLast()).toBeNull();
  });
});
