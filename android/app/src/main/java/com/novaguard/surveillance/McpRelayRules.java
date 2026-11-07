package com.novaguard.surveillance;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;

/**
 * What the relay client decides without Android, a socket or JSON.
 *
 * The relay is the one place this app dials out, so the rules that bound it
 * live where a bare JVM can test them: which address is acceptable, what the
 * phone signs, which requests may reach the server through it, and how long to
 * wait before trying again. `docs/CONNEXION.md` §14 is the contract.
 */
public final class McpRelayRules {
  private McpRelayRules() {}

  /** What the phone signs with the challenge; the label keeps a signature from being replayed elsewhere. */
  public static final String SIGNED_PREFIX = "novaguard-relay-v1\n";

  public static byte[] signedMessage(String nonce) {
    return (SIGNED_PREFIX + nonce).getBytes(StandardCharsets.UTF_8);
  }

  /** Requests the relay may carry: the server's own limits, repeated because the relay is not trusted to enforce them. */
  public static final int MAX_REQUEST_BODY_BYTES = 256 * 1024;

  /** Largest answer the relay passes on; a bigger one is a 502 there, so the phone does not send it. */
  public static final int MAX_RESPONSE_BODY_BYTES = 8 * 1024 * 1024;

  private static final String BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

  /**
   * The phone's public identifier: a hash of its key, so nobody can take another
   * phone's address. Must match `deviceIdFor` in `relay/src/protocol.js`.
   */
  public static String deviceId(byte[] spki) {
    byte[] digest;
    try {
      digest = MessageDigest.getInstance("SHA-256").digest(spki);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
    StringBuilder out = new StringBuilder();
    int bits = 0;
    int value = 0;
    for (int i = 0; i < 16; i++) {
      value = (value << 8) | (digest[i] & 0xff);
      bits += 8;
      while (bits >= 5) {
        out.append(BASE32.charAt((value >>> (bits - 5)) & 31));
        bits -= 5;
      }
      value &= (1 << bits) - 1;
    }
    if (bits > 0) out.append(BASE32.charAt((value << (5 - bits)) & 31));
    return out.toString();
  }

  /**
   * The relay's address as the owner typed it, reduced to `https://host[:port]`.
   * Anything else is null: plain `http` would send the bearer token and the
   * camera's images in clear, and a path, query or credentials in the address
   * are either a mistake or an attempt to point the phone somewhere else.
   */
  public static String relayBase(String typed) {
    if (typed == null) return null;
    String text = typed.trim();
    if (text.endsWith("/")) text = text.substring(0, text.length() - 1);
    if (!text.toLowerCase(Locale.ROOT).startsWith("https://")) return null;
    String authority = text.substring("https://".length());
    if (authority.isEmpty() || authority.length() > 253) return null;
    if (!authority.matches("[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?")) return null;
    int colon = authority.indexOf(':');
    if (colon >= 0) {
      int port = Integer.parseInt(authority.substring(colon + 1));
      if (port < 1 || port > 65535) return null;
    }
    return "https://" + authority.toLowerCase(Locale.ROOT);
  }

  public static String connectUrl(String base) {
    return "wss://" + base.substring("https://".length()) + "/connect";
  }

  public static String publicUrl(String base, String deviceId) {
    return base + "/d/" + deviceId + "/mcp";
  }

  /**
   * Whether a path the relay forwarded is one the server answers. Only the MCP
   * endpoint for now; the OAuth documents join it with the authorization server.
   */
  public static boolean pathAllowed(String path) {
    if (path == null) return false;
    String bare = path.indexOf('?') >= 0 ? path.substring(0, path.indexOf('?')) : path;
    return "/mcp".equals(bare);
  }

  /** The authorization server's own endpoints, as the phone sees them behind the relay. */
  public static boolean oauthPath(String path) {
    if (path == null) return false;
    String bare = path.indexOf('?') >= 0 ? path.substring(0, path.indexOf('?')) : path;
    switch (bare) {
      case "/.well-known/oauth-protected-resource/mcp":
      case "/.well-known/oauth-authorization-server":
      case "/register":
      case "/authorize":
      case "/authorize/status":
      case "/token":
        return true;
      default:
        return false;
    }
  }

  /** The authorization server's identifier: where its endpoints hang, public side. */
  public static String issuer(String base, String deviceId) {
    return base + "/d/" + deviceId;
  }

  /** RFC 9728 puts the well-known part before the resource's path, so the relay's `/d/<id>` comes after it. */
  public static String resourceMetadataUrl(String base, String deviceId) {
    return base + "/.well-known/oauth-protected-resource/d/" + deviceId + "/mcp";
  }

  /** What a 401 through the relay tells a client, so it can find out how to obtain a token. */
  public static String challenge(String base, String deviceId) {
    return "Bearer realm=\"NovaGuard MCP\", resource_metadata=\"" + resourceMetadataUrl(base, deviceId) + "\"";
  }

  /** Seconds to wait after the `attempt`-th failure in a row (0-based): 1, 2, 4 … 60, then 60. */
  public static long backoffMs(int attempt) {
    int capped = Math.min(Math.max(attempt, 0), 6);
    return Math.min(60_000L, 1_000L << capped);
  }

  /** Close codes the relay uses, and what each asks of the client. */
  public static final int CLOSE_REPLACED = 4000;
  public static final int CLOSE_UNAUTHORIZED = 4003;

  /**
   * Whether to dial again after a close. A phone told it was replaced by a newer
   * connection of its own must not fight it, and one refused for its signature
   * will be refused again: both stay down until the owner switches the feature
   * off and on.
   */
  public static boolean shouldReconnect(int closeCode) {
    return closeCode != CLOSE_REPLACED && closeCode != CLOSE_UNAUTHORIZED;
  }
}
