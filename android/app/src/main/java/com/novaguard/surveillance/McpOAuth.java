package com.novaguard.surveillance;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * The authorization server cloud clients use to reach this phone through the relay.
 *
 * It runs on the phone, and the decision is the owner's: an authorization request
 * only creates a pending entry, and nothing is issued until the owner taps "Autoriser"
 * on the device. The relay forwards these requests and never sees a decision, a code
 * or a token it could mint. Plain Java, with its clock injected, so the whole flow —
 * PKCE, expiry, single-use codes, rotation and reuse detection — is tested on a bare
 * JVM by `scripts/test-presence-native.sh`; the HTTP and the persistence around it
 * are `McpOAuthServer.kt`. `docs/CONNEXION.md` §14.3 is the contract.
 *
 * Tokens are only ever held as SHA-256 digests, like the static ones.
 */
public final class McpOAuth {
  /** The only scope: reading what was recorded. Control is never reachable from the cloud. */
  public static final String SCOPE = "novaguard:read";

  public static final long PENDING_TTL_MS = 120_000L;
  public static final long CODE_TTL_MS = 60_000L;
  public static final long ACCESS_TTL_MS = 3_600_000L;
  public static final long REFRESH_TTL_MS = 30L * 24 * 3_600_000L;
  private static final long USED_CODE_MEMORY_MS = 600_000L;

  /** Bounds: this is the open internet, so every table has a ceiling. */
  public static final int MAX_PENDING = 3;
  public static final int MAX_CLIENTS = 20;
  public static final int MAX_GRANTS = 10;
  public static final int MAX_REDIRECTS = 5;

  private static final String[] ALLOWED_HOSTS = {"claude.ai", "claude.com", "chatgpt.com", "chat.openai.com"};
  private static final String ALLOWED_SUFFIX = ".azure-apim.net";

  private final LongSupplier clock;
  private final SecureRandom random = new SecureRandom();
  private final Runnable changed;

  private final Map<String, Client> clients = new HashMap<>();
  private final Map<String, Pending> pendings = new HashMap<>();
  private final Map<String, CodeRecord> codes = new HashMap<>();
  private final Map<String, UsedCode> usedCodes = new HashMap<>();
  private final List<Grant> grants = new ArrayList<>();

  /** `changed` runs, never under this object's lock, after clients or grants change, so the caller can persist. */
  public McpOAuth(LongSupplier clock, Runnable changed) {
    this.clock = clock;
    this.changed = changed == null ? () -> { } : changed;
  }

  // ------------------------------------------------------------------ pure checks

  /**
   * Which redirect addresses a client may register. Web clients are the ones this
   * server knows by host; native ones use a loopback address (RFC 8252). A code is
   * handed to this address, so an unknown host is refused at registration instead
   * of trusted at consent.
   */
  public static boolean redirectAllowed(String uri) {
    if (uri == null || uri.length() > 512) return false;
    URI parsed;
    try {
      parsed = new URI(uri);
    } catch (Exception e) {
      return false;
    }
    String scheme = parsed.getScheme();
    String host = parsed.getHost();
    if (scheme == null || host == null || parsed.getRawUserInfo() != null || parsed.getRawFragment() != null) return false;
    host = host.toLowerCase(Locale.ROOT);
    if ("http".equals(scheme)) return host.equals("localhost") || host.equals("127.0.0.1") || host.equals("[::1]");
    if (!"https".equals(scheme)) return false;
    for (String allowed : ALLOWED_HOSTS) if (host.equals(allowed)) return true;
    return host.endsWith(ALLOWED_SUFFIX) && host.length() > ALLOWED_SUFFIX.length();
  }

  public static String redirectHost(String uri) {
    try {
      String host = new URI(uri).getHost();
      return host == null ? "" : host.toLowerCase(Locale.ROOT);
    } catch (Exception e) {
      return "";
    }
  }

  /** PKCE S256: the challenge must be the base64url SHA-256 of the verifier, which RFC 7636 bounds to 43–128 characters. */
  public static boolean pkceMatches(String verifier, String challenge) {
    if (verifier == null || challenge == null) return false;
    if (verifier.length() < 43 || verifier.length() > 128 || !verifier.matches("[A-Za-z0-9._~-]+")) return false;
    byte[] expected = Base64.getUrlEncoder().withoutPadding().encodeToString(sha256(verifier)).getBytes(StandardCharsets.US_ASCII);
    return MessageDigest.isEqual(expected, challenge.getBytes(StandardCharsets.US_ASCII));
  }

  /** The scope to grant, or null when the request asks for anything beyond reading. Absent means the default. */
  public static String scopeFor(String requested) {
    if (requested == null || requested.trim().isEmpty()) return SCOPE;
    for (String part : requested.trim().split("\\s+")) if (!SCOPE.equals(part)) return null;
    return SCOPE;
  }

  /** `base` with `params` appended to its query, URL-encoded; null values are skipped. */
  public static String redirectWith(String base, String... params) {
    StringBuilder out = new StringBuilder(base).append(base.contains("?") ? '&' : '?');
    boolean first = true;
    for (int i = 0; i + 1 < params.length; i += 2) {
      if (params[i + 1] == null) continue;
      if (!first) out.append('&');
      first = false;
      out.append(encode(params[i])).append('=').append(encode(params[i + 1]));
    }
    return out.toString();
  }

  private static String encode(String value) {
    try {
      return URLEncoder.encode(value, "UTF-8");
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static byte[] sha256(String value) {
    try {
      return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  private static String hex(byte[] bytes) {
    StringBuilder out = new StringBuilder();
    for (byte b : bytes) out.append(String.format("%02x", b & 0xff));
    return out.toString();
  }

  private static String digest(String token) {
    return hex(sha256(token));
  }

  private String secret(String prefix) {
    byte[] bytes = new byte[32];
    random.nextBytes(bytes);
    return prefix + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  // ------------------------------------------------------------------ records

  public static final class Client {
    public final String id;
    public final String name;
    public final List<String> redirectUris;
    public final long createdAt;

    public Client(String id, String name, List<String> redirectUris, long createdAt) {
      this.id = id;
      this.name = name;
      this.redirectUris = redirectUris;
      this.createdAt = createdAt;
    }
  }

  public static final class Pending {
    public static final int WAITING = 0;
    public static final int APPROVED = 1;
    public static final int DENIED = 2;

    public final String id;
    /** Four digits shown on the browser page and on the phone, for the owner to compare. */
    public final String verification;
    public final Client client;
    public final String redirectUri;
    public final String state;
    public final String codeChallenge;
    public final long expiresAt;
    int status = WAITING;
    String code;
    long lifetimeMs;

    Pending(String id, String verification, Client client, String redirectUri, String state, String codeChallenge, long expiresAt) {
      this.id = id;
      this.verification = verification;
      this.client = client;
      this.redirectUri = redirectUri;
      this.state = state;
      this.codeChallenge = codeChallenge;
      this.expiresAt = expiresAt;
    }
  }

  private static final class CodeRecord {
    final String clientId;
    final String redirectUri;
    final String codeChallenge;
    final long expiresAt;
    final long lifetimeMs;

    CodeRecord(String clientId, String redirectUri, String codeChallenge, long expiresAt, long lifetimeMs) {
      this.lifetimeMs = lifetimeMs;
      this.clientId = clientId;
      this.redirectUri = redirectUri;
      this.codeChallenge = codeChallenge;
      this.expiresAt = expiresAt;
    }
  }

  private static final class UsedCode {
    final String grantId;
    final long until;

    UsedCode(String grantId, long until) {
      this.grantId = grantId;
      this.until = until;
    }
  }

  /** What survives a restart: digests and metadata, never a token. */
  public static final class Grant {
    public final String id;
    public final String clientId;
    public final String clientName;
    public final String redirectHost;
    public final long createdAt;
    /** The instant the owner chose to end this authorization at, or 0 for none: it then lasts until revoked or unused for the refresh window. */
    public long validUntil;
    public long lastUsedAt;
    public String accessDigest;
    public long accessExpiresAt;
    public String refreshDigest;
    public long refreshExpiresAt;
    public String previousRefreshDigest;

    public Grant(String id, String clientId, String clientName, String redirectHost, long createdAt) {
      this.id = id;
      this.clientId = clientId;
      this.clientName = clientName;
      this.redirectHost = redirectHost;
      this.createdAt = createdAt;
      this.lastUsedAt = createdAt;
    }

    Grant copy() {
      Grant g = new Grant(id, clientId, clientName, redirectHost, createdAt);
      g.lastUsedAt = lastUsedAt;
      g.validUntil = validUntil;
      g.accessDigest = accessDigest;
      g.accessExpiresAt = accessExpiresAt;
      g.refreshDigest = refreshDigest;
      g.refreshExpiresAt = refreshExpiresAt;
      g.previousRefreshDigest = previousRefreshDigest;
      return g;
    }
  }

  public static final class Tokens {
    public final String accessToken;
    public final String refreshToken;
    public final long expiresInSeconds;

    Tokens(String accessToken, String refreshToken, long expiresInSeconds) {
      this.accessToken = accessToken;
      this.refreshToken = refreshToken;
      this.expiresInSeconds = expiresInSeconds;
    }
  }

  /** Either tokens or an RFC 6749 error. */
  public static final class TokenResult {
    public final Tokens tokens;
    public final String error;
    public final String description;

    TokenResult(Tokens tokens, String error, String description) {
      this.tokens = tokens;
      this.error = error;
      this.description = description;
    }
  }

  /** What the browser page learns when it asks: waiting, or where to go next. */
  public static final class Poll {
    public final String status;
    public final String redirect;

    Poll(String status, String redirect) {
      this.status = status;
      this.redirect = redirect;
    }
  }

  // ------------------------------------------------------------------ registration

  /**
   * Dynamic client registration (RFC 7591), for public clients only. Null when a
   * redirect address is not acceptable. The table is bounded: a full one drops the
   * oldest client that holds no grant, and refuses when every one is in use.
   */
  public Client register(String name, List<String> redirectUris) {
    if (redirectUris == null || redirectUris.isEmpty() || redirectUris.size() > MAX_REDIRECTS) return null;
    for (String uri : redirectUris) if (!redirectAllowed(uri)) return null;
    String shown = name == null ? "" : name.replaceAll("[\\p{Cntrl}<>\"&]", "").trim();
    if (shown.length() > 60) shown = shown.substring(0, 60);
    if (shown.isEmpty()) shown = redirectHost(redirectUris.get(0));
    Client client;
    synchronized (this) {
      if (clients.size() >= MAX_CLIENTS && !evictUnusedClient()) return null;
      client = new Client(secret("nvk_"), shown, new ArrayList<>(redirectUris), clock.getAsLong());
      clients.put(client.id, client);
    }
    changed.run();
    return client;
  }

  private boolean evictUnusedClient() {
    Client oldest = null;
    for (Client c : clients.values()) {
      boolean used = false;
      for (Grant g : grants) if (g.clientId.equals(c.id)) used = true;
      if (!used && (oldest == null || c.createdAt < oldest.createdAt)) oldest = c;
    }
    if (oldest == null) return false;
    clients.remove(oldest.id);
    return true;
  }

  public synchronized Client client(String id) {
    return id == null ? null : clients.get(id);
  }

  public synchronized List<Client> clients() {
    return new ArrayList<>(clients.values());
  }

  public synchronized void restoreClients(List<Client> saved) {
    clients.clear();
    for (Client c : saved) clients.put(c.id, c);
  }

  // ------------------------------------------------------------------ authorization

  /**
   * Opens a request waiting for the owner. Null when too many are already waiting:
   * a stranger who can reach the relay must not be able to flood the phone with
   * prompts.
   */
  public synchronized Pending begin(Client client, String redirectUri, String state, String codeChallenge) {
    purge();
    if (waiting().size() >= MAX_PENDING) return null;
    String verification = String.format("%04d", random.nextInt(10_000));
    Pending pending = new Pending(secret("nvp_"), verification, client, redirectUri, state, codeChallenge, clock.getAsLong() + PENDING_TTL_MS);
    pendings.put(pending.id, pending);
    return pending;
  }

  /** The requests the owner has yet to answer, for the prompt and the notification. */
  public synchronized List<Pending> waiting() {
    purge();
    long now = clock.getAsLong();
    List<Pending> out = new ArrayList<>();
    // An unanswered prompt that has timed out is no longer waiting, whether or not it has been swept yet.
    for (Pending p : pendings.values()) if (p.status == Pending.WAITING && now < p.expiresAt) out.add(p);
    return out;
  }

  public synchronized boolean approve(String id) {
    return approve(id, 0L);
  }

  /** `lifetimeMs` is how long the owner grants the access for; 0 or less leaves it open-ended. */
  public synchronized boolean approve(String id, long lifetimeMs) {
    Pending p = pendings.get(id);
    if (p == null || p.status != Pending.WAITING || clock.getAsLong() >= p.expiresAt) return false;
    p.code = secret("nvc_");
    codes.put(digest(p.code), new CodeRecord(p.client.id, p.redirectUri, p.codeChallenge, clock.getAsLong() + CODE_TTL_MS, Math.max(0L, lifetimeMs)));
    p.status = Pending.APPROVED;
    return true;
  }

  public synchronized boolean deny(String id) {
    Pending p = pendings.get(id);
    if (p == null || p.status != Pending.WAITING) return false;
    p.status = Pending.DENIED;
    return true;
  }

  /**
   * What the browser page is told. A decision is delivered once: the pending entry is
   * removed with it, so the address carrying the code cannot be asked for twice.
   */
  public synchronized Poll poll(String id) {
    Pending p = id == null ? null : pendings.get(id);
    if (p == null) return new Poll("expired", null);
    if (p.status == Pending.WAITING) {
      if (clock.getAsLong() >= p.expiresAt) {
        pendings.remove(id);
        return new Poll("expired", null);
      }
      return new Poll("waiting", null);
    }
    pendings.remove(id);
    if (p.status == Pending.APPROVED) return new Poll("approved", redirectWith(p.redirectUri, "code", p.code, "state", p.state));
    return new Poll("denied", redirectWith(p.redirectUri, "error", "access_denied", "state", p.state));
  }

  private void purge() {
    long now = clock.getAsLong();
    for (Iterator<Pending> it = pendings.values().iterator(); it.hasNext(); ) {
      Pending p = it.next();
      if (now >= p.expiresAt + 60_000L) it.remove();
    }
    for (Iterator<CodeRecord> it = codes.values().iterator(); it.hasNext(); ) if (now >= it.next().expiresAt) it.remove();
    for (Iterator<UsedCode> it = usedCodes.values().iterator(); it.hasNext(); ) if (now >= it.next().until) it.remove();
    grants.removeIf(g -> g.validUntil > 0 && now >= g.validUntil);
  }

  // ------------------------------------------------------------------ tokens

  private static TokenResult failure(String error, String description) {
    return new TokenResult(null, error, description);
  }

  public TokenResult exchangeCode(String code, String verifier, String clientId, String redirectUri) {
    TokenResult result;
    boolean saved = false;
    synchronized (this) {
      purge();
      Client client = client(clientId);
      if (client == null) return failure("invalid_client", "Unknown client");
      if (code == null || verifier == null || redirectUri == null) return failure("invalid_request", "code, code_verifier and redirect_uri are required");
      String key = digest(code);
      UsedCode reused = usedCodes.get(key);
      if (reused != null) {
        // A code presented twice means someone else holds it: what it already bought is revoked.
        revokeLocked(reused.grantId);
        saved = true;
        result = failure("invalid_grant", "Authorization code already used");
      } else {
        // Single use even when the rest fails: a wrong verifier does not get a second try.
        CodeRecord record = codes.remove(key);
        if (record == null || clock.getAsLong() >= record.expiresAt) {
          result = failure("invalid_grant", "Authorization code is unknown or expired");
        } else if (!record.clientId.equals(clientId) || !record.redirectUri.equals(redirectUri)) {
          result = failure("invalid_grant", "Code was issued to another client or redirect address");
        } else if (!pkceMatches(verifier, record.codeChallenge)) {
          result = failure("invalid_grant", "PKCE verification failed");
        } else {
          Grant grant = newGrant(client, record.redirectUri, record.lifetimeMs);
          usedCodes.put(key, new UsedCode(grant.id, clock.getAsLong() + USED_CODE_MEMORY_MS));
          result = new TokenResult(issue(grant), null, null);
          saved = true;
        }
      }
    }
    if (saved) changed.run();
    return result;
  }

  public TokenResult refresh(String refreshToken, String clientId) {
    TokenResult result;
    boolean saved = false;
    synchronized (this) {
      if (client(clientId) == null) return failure("invalid_client", "Unknown client");
      if (refreshToken == null) return failure("invalid_request", "refresh_token is required");
      String key = digest(refreshToken);
      Grant match = null;
      Grant replayed = null;
      for (Grant g : grants) {
        if (!g.clientId.equals(clientId)) continue;
        if (key.equals(g.previousRefreshDigest)) replayed = g;
        else if (key.equals(g.refreshDigest)) match = g;
      }
      if (replayed != null) {
        // The token this one replaced came back: it was copied. The whole grant goes.
        revokeLocked(replayed.id);
        saved = true;
        result = failure("invalid_grant", "Refresh token already used");
      } else if (match == null || clock.getAsLong() >= match.refreshExpiresAt) {
        result = failure("invalid_grant", "Refresh token is unknown or expired");
      } else {
        match.previousRefreshDigest = match.refreshDigest;
        result = new TokenResult(issue(match), null, null);
        saved = true;
      }
    }
    if (saved) changed.run();
    return result;
  }

  private Grant newGrant(Client client, String redirectUri, long lifetimeMs) {
    if (grants.size() >= MAX_GRANTS) {
      Grant oldest = grants.get(0);
      for (Grant g : grants) if (g.lastUsedAt < oldest.lastUsedAt) oldest = g;
      grants.remove(oldest);
    }
    Grant grant = new Grant(secret("nvg_"), client.id, client.name, redirectHost(redirectUri), clock.getAsLong());
    if (lifetimeMs > 0) grant.validUntil = grant.createdAt + lifetimeMs;
    grants.add(grant);
    return grant;
  }

  /** No token outlives the end the owner chose for the grant, whichever window it would otherwise get. */
  private static long capped(Grant grant, long expiry) {
    return grant.validUntil > 0 ? Math.min(expiry, grant.validUntil) : expiry;
  }

  /** New access and refresh tokens for a grant; the caller holds the lock. */
  private Tokens issue(Grant grant) {
    long now = clock.getAsLong();
    String access = secret("nva_");
    String refresh = secret("nvr_");
    grant.accessDigest = digest(access);
    grant.accessExpiresAt = capped(grant, now + ACCESS_TTL_MS);
    grant.refreshDigest = digest(refresh);
    grant.refreshExpiresAt = capped(grant, now + REFRESH_TTL_MS);
    grant.lastUsedAt = now;
    return new Tokens(access, refresh, ACCESS_TTL_MS / 1000);
  }

  /** Whether `token` is a live access token. Counts as a use. */
  public synchronized boolean authenticate(String token) {
    if (token == null || !token.startsWith("nva_")) return false;
    byte[] presented = digest(token).getBytes(StandardCharsets.US_ASCII);
    long now = clock.getAsLong();
    boolean ok = false;
    for (Grant g : grants) {
      if (g.accessDigest == null) continue;
      // Every grant is compared: where the match is must not show in how long this takes.
      boolean same = MessageDigest.isEqual(presented, g.accessDigest.getBytes(StandardCharsets.US_ASCII));
      if (same && now < g.accessExpiresAt) {
        g.lastUsedAt = now;
        ok = true;
      }
    }
    return ok;
  }

  // ------------------------------------------------------------------ grants

  public synchronized List<Grant> grants() {
    List<Grant> out = new ArrayList<>();
    long now = clock.getAsLong();
    for (Grant g : grants) if (g.validUntil == 0 || now < g.validUntil) out.add(g.copy());
    return out;
  }

  public synchronized void restoreGrants(List<Grant> saved) {
    grants.clear();
    for (Grant g : saved) grants.add(g.copy());
  }

  public boolean revoke(String grantId) {
    boolean removed;
    synchronized (this) {
      removed = revokeLocked(grantId);
    }
    if (removed) changed.run();
    return removed;
  }

  public void revokeAll() {
    boolean any;
    synchronized (this) {
      any = !grants.isEmpty();
      grants.clear();
    }
    if (any) changed.run();
  }

  private boolean revokeLocked(String grantId) {
    for (Iterator<Grant> it = grants.iterator(); it.hasNext(); ) {
      if (it.next().id.equals(grantId)) {
        it.remove();
        return true;
      }
    }
    return false;
  }
}
