/**
 * The relay address the owner typed, reduced to `https://host[:port]`, or null.
 *
 * The same rules as `McpRelayRules.relayBase` on the native side, which has the last
 * word: it refuses to dial anything else. They are repeated here so a bad address is
 * refused where it is typed, not discovered as a relay that never connects. Plain `http`
 * would carry the access token and the camera's images in clear; a path, a query or
 * credentials are a mistake or an attempt to point the phone somewhere else.
 */
export function normalizeRelayUrl(typed: string | null | undefined): string | null {
  if (typeof typed !== 'string') return null;
  let text = typed.trim();
  if (text.endsWith('/')) text = text.slice(0, -1);
  if (!/^https:\/\//i.test(text)) return null;
  const authority = text.slice('https://'.length);
  if (authority.length === 0 || authority.length > 253) return null;
  const match = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::([0-9]{1,5}))?$/.exec(authority);
  if (!match) return null;
  if (match[1] !== undefined) {
    const port = Number(match[1]);
    if (port < 1 || port > 65535) return null;
  }
  return `https://${authority.toLowerCase()}`;
}

/** What the owner is told the relay is called: the address without its scheme. */
export function relayHostOf(url: string): string {
  return url.replace(/^https:\/\//i, '');
}
