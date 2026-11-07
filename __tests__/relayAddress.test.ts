import { normalizeRelayUrl, relayHostOf } from '../src/surveillance/relayAddress';

/** Mirrors `testing/native/McpRelayRulesTest.java`: both sides must accept and refuse the same addresses. */
describe('normalizeRelayUrl', () => {
  it.each([
    [' https://Relay.Example.org/ ', 'https://relay.example.org'],
    ['https://relay.example.org:8443', 'https://relay.example.org:8443'],
    ['HTTPS://relay.example.org', 'https://relay.example.org'],
  ])('accepts %j', (typed, expected) => {
    expect(normalizeRelayUrl(typed)).toBe(expected);
  });

  it.each([
    'http://relay.example.org',
    'https://relay.example.org/path',
    'https://user:pw@relay.example.org',
    'https://relay.example.org?x=1',
    'https://relay.example.org:99999',
    'https://relay.example.org:0',
    'https://exa mple.org',
    'https://',
    '',
    'relay.example.org',
    'ftp://relay.example.org',
  ])('refuses %j', typed => {
    expect(normalizeRelayUrl(typed)).toBeNull();
  });

  it('refuses what is not text', () => {
    expect(normalizeRelayUrl(null)).toBeNull();
    expect(normalizeRelayUrl(undefined)).toBeNull();
  });

  it('names the relay without its scheme', () => {
    expect(relayHostOf('https://relay.example.org:8443')).toBe('relay.example.org:8443');
  });
});
