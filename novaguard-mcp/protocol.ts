/**
 * Protocol version negotiation.
 *
 * The server used to pin one version and reject every other with
 * NOVAGUARD_INVALID_REQUEST, which meant no client that did not already know
 * this server's private version string could complete a handshake — the
 * opposite of what `initialize` is for. The specification has the client state
 * what it wants and the server answer with a version it can actually speak;
 * disagreeing is the client's business, not grounds for an error.
 */

/** Newest first: the head of this list is what an unknown request falls back to. */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  '2026-07-28',
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

/**
 * The version stated wherever one has to be stated without a client asking —
 * the transport's response header, and the fallback below.
 *
 * `mcp.md` §7 names `2026-07-28` as the target, so it stays the head of the
 * list and the default. Nothing outside this file should hardcode it.
 */
export const LATEST_PROTOCOL_VERSION: ProtocolVersion = SUPPORTED_PROTOCOL_VERSIONS[0];

/**
 * Picks the version to answer `initialize` with.
 *
 * Echoes the client's when it is one this server speaks, and otherwise offers
 * its newest — which the client is then free to accept or to disconnect over.
 */
export function negotiateProtocolVersion(requested: unknown): ProtocolVersion {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested as string)
    ? (requested as ProtocolVersion)
    : LATEST_PROTOCOL_VERSION;
}
