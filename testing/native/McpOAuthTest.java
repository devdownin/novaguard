import com.novaguard.surveillance.McpOAuth;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

/** Checks the authorization server's flow, limits and refusals. */
public final class McpOAuthTest {
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }

  private static final String CLAUDE = "https://claude.ai/api/mcp/auth_callback";
  private static final String VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  private static String challengeFor(String verifier) throws Exception {
    byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
    return Base64.getUrlEncoder().withoutPadding().encodeToString(digest);
  }

  private static String param(String url, String name) {
    for (String pair : url.substring(url.indexOf('?') + 1).split("&")) {
      String[] kv = pair.split("=", 2);
      if (kv[0].equals(name)) return java.net.URLDecoder.decode(kv[1], StandardCharsets.UTF_8);
    }
    return null;
  }

  public static void main(String[] args) throws Exception {
    // RFC 7636 appendix B: a verifier and the challenge it must give.
    check("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM".equals(challengeFor(VERIFIER)), "the RFC's own example");
    check(McpOAuth.pkceMatches(VERIFIER, challengeFor(VERIFIER)), "the verifier matches its challenge");
    check(!McpOAuth.pkceMatches(VERIFIER + "x", challengeFor(VERIFIER)), "another verifier does not");
    check(!McpOAuth.pkceMatches("short", challengeFor("short")), "a verifier under 43 characters is refused");
    check(!McpOAuth.pkceMatches(null, "x") && !McpOAuth.pkceMatches(VERIFIER, null), "nothing, no match");
    check(!McpOAuth.pkceMatches(VERIFIER.replace('-', '+'), challengeFor(VERIFIER.replace('-', '+'))), "outside the RFC's alphabet");

    check(McpOAuth.redirectAllowed(CLAUDE), "claude.ai");
    check(McpOAuth.redirectAllowed("https://claude.com/api/mcp/auth_callback"), "claude.com");
    check(McpOAuth.redirectAllowed("https://chatgpt.com/connector_platform_oauth_redirect"), "ChatGPT");
    check(McpOAuth.redirectAllowed("https://global.consent.azure-apim.net/redirect"), "Copilot Studio");
    check(McpOAuth.redirectAllowed("http://localhost:6274/oauth/callback") && McpOAuth.redirectAllowed("http://127.0.0.1:33418/callback"), "loopback for native clients");
    check(!McpOAuth.redirectAllowed("https://evil.example/cb"), "an unknown host");
    check(!McpOAuth.redirectAllowed("https://claude.ai.evil.example/cb"), "a look-alike host");
    check(!McpOAuth.redirectAllowed("https://evilclaude.ai/cb"), "a suffix is not a match");
    check(!McpOAuth.redirectAllowed("https://azure-apim.net/cb") && !McpOAuth.redirectAllowed("https://x.azure-apim.net.evil.example/cb"), "only subdomains of the Copilot host");
    check(!McpOAuth.redirectAllowed("http://claude.ai/cb"), "plain http only on loopback");
    check(!McpOAuth.redirectAllowed("https://user:pw@claude.ai/cb") && !McpOAuth.redirectAllowed("https://claude.ai/cb#x"), "no credentials, no fragment");
    check(!McpOAuth.redirectAllowed("javascript:alert(1)") && !McpOAuth.redirectAllowed("") && !McpOAuth.redirectAllowed(null), "no other scheme");

    check(McpOAuth.SCOPE.equals(McpOAuth.scopeFor(null)) && McpOAuth.SCOPE.equals(McpOAuth.scopeFor("  ")), "default is reading");
    check(McpOAuth.SCOPE.equals(McpOAuth.scopeFor("novaguard:read")), "reading is granted");
    check(McpOAuth.scopeFor("novaguard:read novaguard:control") == null && McpOAuth.scopeFor("admin") == null, "anything more is refused");

    check("https://a.example/cb?code=c%26d&state=s+t".equals(McpOAuth.redirectWith("https://a.example/cb", "code", "c&d", "state", "s t")), "values are encoded");
    check("https://a.example/cb?x=1&error=access_denied".equals(McpOAuth.redirectWith("https://a.example/cb?x=1", "error", "access_denied", "state", null)), "appended to an existing query, nulls skipped");

    // ---- the whole flow
    AtomicLong now = new AtomicLong(1_000_000L);
    AtomicInteger changes = new AtomicInteger();
    McpOAuth oauth = new McpOAuth(now::get, changes::incrementAndGet);

    check(oauth.register("x", Collections.singletonList("https://evil.example/cb")) == null, "registration refuses an unknown redirect host");
    check(oauth.register("x", Collections.emptyList()) == null && oauth.register("x", null) == null, "and an empty list");
    McpOAuth.Client client = oauth.register("  <b>Claude</b>\n", Collections.singletonList(CLAUDE));
    check(client != null && client.id.startsWith("nvk_"), "a client is registered");
    check("bClaude/b".equals(client.name), "markup and control characters never reach the prompt: " + client.name);
    check(oauth.client(client.id) == client && oauth.client("nope") == null, "found by id");
    check(changes.get() == 1, "registration is persisted");

    String challenge = challengeFor(VERIFIER);
    McpOAuth.Pending pending = oauth.begin(client, CLAUDE, "st", challenge);
    check(pending != null && pending.verification.matches("\\d{4}"), "a pending request with a four-digit code");
    check(oauth.waiting().size() == 1, "the owner has one to answer");
    check("waiting".equals(oauth.poll(pending.id).status), "the browser is told to wait");
    check(oauth.exchangeCode("nvc_guess", VERIFIER, client.id, CLAUDE).error != null, "no code before the owner decides");

    check(oauth.approve(pending.id), "the owner approves");
    check(!oauth.approve(pending.id), "once");
    McpOAuth.Poll approved = oauth.poll(pending.id);
    check("approved".equals(approved.status), "approved");
    String code = param(approved.redirect, "code");
    check(approved.redirect.startsWith(CLAUDE + "?") && "st".equals(param(approved.redirect, "state")) && code.startsWith("nvc_"), "the code goes to the registered address with the state");
    check("expired".equals(oauth.poll(pending.id).status), "and is delivered once");
    check(oauth.waiting().isEmpty(), "nothing left to answer");

    check("invalid_grant".equals(oauth.exchangeCode(code, VERIFIER + "x", client.id, CLAUDE).error), "a wrong verifier");
    check("invalid_grant".equals(oauth.exchangeCode(code, VERIFIER, client.id, CLAUDE).error), "which burns the code");

    // a fresh run
    pending = oauth.begin(client, CLAUDE, "st2", challenge);
    oauth.approve(pending.id);
    code = param(oauth.poll(pending.id).redirect, "code");
    check("invalid_grant".equals(oauth.exchangeCode(code, VERIFIER, client.id, "https://claude.ai/other").error), "another redirect address");
    pending = oauth.begin(client, CLAUDE, "st3", challenge);
    oauth.approve(pending.id);
    code = param(oauth.poll(pending.id).redirect, "code");
    McpOAuth.Client other = oauth.register("Other", Collections.singletonList("https://chatgpt.com/cb"));
    check("invalid_grant".equals(oauth.exchangeCode(code, VERIFIER, other.id, CLAUDE).error), "a code is bound to its client");
    check("invalid_client".equals(oauth.exchangeCode(code, VERIFIER, "nope", CLAUDE).error), "an unknown client");

    pending = oauth.begin(client, CLAUDE, "st4", challenge);
    oauth.approve(pending.id);
    code = param(oauth.poll(pending.id).redirect, "code");
    now.addAndGet(McpOAuth.CODE_TTL_MS);
    check("invalid_grant".equals(oauth.exchangeCode(code, VERIFIER, client.id, CLAUDE).error), "a code lives a minute");

    pending = oauth.begin(client, CLAUDE, "ok", challenge);
    oauth.approve(pending.id);
    code = param(oauth.poll(pending.id).redirect, "code");
    McpOAuth.TokenResult issued = oauth.exchangeCode(code, VERIFIER, client.id, CLAUDE);
    check(issued.tokens != null && issued.tokens.accessToken.startsWith("nva_") && issued.tokens.refreshToken.startsWith("nvr_"), "tokens");
    check(issued.tokens.expiresInSeconds == 3600, "an access token lives an hour");
    check(oauth.authenticate(issued.tokens.accessToken), "the access token opens the door");
    check(!oauth.authenticate(issued.tokens.refreshToken) && !oauth.authenticate("nva_" + "x".repeat(43)) && !oauth.authenticate(null), "nothing else does");
    check(oauth.grants().size() == 1 && oauth.grants().get(0).clientName.equals("bClaude/b") && "claude.ai".equals(oauth.grants().get(0).redirectHost), "a grant is listed with its client");
    check(!oauth.grants().get(0).accessDigest.contains("nva_"), "only a digest is kept");

    // reuse of a code revokes what it bought
    check("invalid_grant".equals(oauth.exchangeCode(code, VERIFIER, client.id, CLAUDE).error), "a used code");
    check(!oauth.authenticate(issued.tokens.accessToken) && oauth.grants().isEmpty(), "and the grant it opened is revoked");

    // ---- refresh
    pending = oauth.begin(client, CLAUDE, "r", challenge);
    oauth.approve(pending.id);
    issued = oauth.exchangeCode(param(oauth.poll(pending.id).redirect, "code"), VERIFIER, client.id, CLAUDE);
    String refresh1 = issued.tokens.refreshToken;
    String access1 = issued.tokens.accessToken;
    McpOAuth.TokenResult rotated = oauth.refresh(refresh1, client.id);
    check(rotated.tokens != null && !rotated.tokens.refreshToken.equals(refresh1), "refreshing rotates");
    check(!oauth.authenticate(access1) && oauth.authenticate(rotated.tokens.accessToken), "the old access token stops, the new one works");
    check("invalid_grant".equals(oauth.refresh(refresh1, other.id).error) || "invalid_client".equals(oauth.refresh(refresh1, other.id).error), "another client cannot refresh it");
    check(oauth.grants().size() == 1, "that did not revoke");
    check("invalid_grant".equals(oauth.refresh(refresh1, client.id).error), "the replaced refresh token is refused");
    check(oauth.grants().isEmpty() && !oauth.authenticate(rotated.tokens.accessToken), "and its grant is revoked: it was copied");

    // ---- expiry
    pending = oauth.begin(client, CLAUDE, "e", challenge);
    oauth.approve(pending.id);
    issued = oauth.exchangeCode(param(oauth.poll(pending.id).redirect, "code"), VERIFIER, client.id, CLAUDE);
    now.addAndGet(McpOAuth.ACCESS_TTL_MS);
    check(!oauth.authenticate(issued.tokens.accessToken), "an access token expires");
    McpOAuth.TokenResult later = oauth.refresh(issued.tokens.refreshToken, client.id);
    check(later.tokens != null && oauth.authenticate(later.tokens.accessToken), "a refresh token renews it");
    now.addAndGet(McpOAuth.REFRESH_TTL_MS);
    check("invalid_grant".equals(oauth.refresh(later.tokens.refreshToken, client.id).error), "a refresh token expires");

    // ---- revocation and persistence
    pending = oauth.begin(client, CLAUDE, "v", challenge);
    oauth.approve(pending.id);
    issued = oauth.exchangeCode(param(oauth.poll(pending.id).redirect, "code"), VERIFIER, client.id, CLAUDE);
    List<McpOAuth.Grant> saved = oauth.grants();
    McpOAuth restored = new McpOAuth(now::get, null);
    restored.restoreClients(oauth.clients());
    restored.restoreGrants(saved);
    check(restored.authenticate(issued.tokens.accessToken), "a grant survives a restart");
    String newest = saved.get(saved.size() - 1).id;
    int before = changes.get();
    check(oauth.revoke(newest) && !oauth.authenticate(issued.tokens.accessToken), "revoking ends it at once");
    check(!oauth.revoke(newest), "once");
    check(changes.get() == before + 1, "and is persisted");

    // ---- a lifetime chosen by the owner
    long day = 24L * 3_600_000L;
    pending = oauth.begin(client, CLAUDE, "t", challenge);
    check(oauth.approve(pending.id, day), "approved for a day");
    issued = oauth.exchangeCode(param(oauth.poll(pending.id).redirect, "code"), VERIFIER, client.id, CLAUDE);
    McpOAuth.Grant timed = null;
    for (McpOAuth.Grant g : oauth.grants()) if (g.validUntil > 0) timed = g;
    check(timed != null && timed.validUntil == timed.createdAt + day, "the grant carries its end");
    check(timed.refreshExpiresAt <= timed.validUntil, "no refresh token outlives it");
    now.addAndGet(day - 1_000L);
    McpOAuth.TokenResult lastHour = oauth.refresh(issued.tokens.refreshToken, client.id);
    check(lastHour.tokens != null && oauth.authenticate(lastHour.tokens.accessToken), "usable until the end");
    now.addAndGet(2_000L);
    check(!oauth.authenticate(lastHour.tokens.accessToken), "dead at the end, though the access window was longer");
    check("invalid_grant".equals(oauth.refresh(lastHour.tokens.refreshToken, client.id).error), "and cannot be refreshed");
    for (McpOAuth.Grant g : oauth.grants()) check(g.validUntil == 0 || g.validUntil > now.get(), "an ended grant is no longer listed");
    pending = oauth.begin(client, CLAUDE, "o", challenge);
    check(oauth.approve(pending.id), "the old call still means no end");
    issued = oauth.exchangeCode(param(oauth.poll(pending.id).redirect, "code"), VERIFIER, client.id, CLAUDE);
    boolean open = false;
    for (McpOAuth.Grant g : oauth.grants()) if (g.validUntil == 0 && g.createdAt == now.get()) open = true;
    check(open, "open-ended when no lifetime is given");

    // ---- limits
    pending = oauth.begin(client, CLAUDE, "1", challenge);
    check(pending != null && oauth.begin(client, CLAUDE, "2", challenge) != null && oauth.begin(client, CLAUDE, "3", challenge) != null, "three prompts may wait");
    check(oauth.begin(client, CLAUDE, "4", challenge) == null, "a fourth is refused: no flooding the phone");
    check(oauth.deny(pending.id), "the owner refuses one");
    McpOAuth.Poll denied = oauth.poll(pending.id);
    check("denied".equals(denied.status) && "access_denied".equals(param(denied.redirect, "error")) && "1".equals(param(denied.redirect, "state")), "the client is told, with its state");
    check(!oauth.approve(pending.id), "a refused one cannot be approved");
    now.addAndGet(McpOAuth.PENDING_TTL_MS);
    check(oauth.waiting().isEmpty(), "unanswered prompts expire");
    McpOAuth.Pending late = oauth.begin(client, CLAUDE, "late", challenge);
    now.addAndGet(McpOAuth.PENDING_TTL_MS);
    check(!oauth.approve(late.id) && "expired".equals(oauth.poll(late.id).status), "too late to approve");

    for (int i = 0; i < McpOAuth.MAX_GRANTS + 3; i++) {
      McpOAuth.Pending p = oauth.begin(client, CLAUDE, "g" + i, challenge);
      oauth.approve(p.id);
      check(oauth.exchangeCode(param(oauth.poll(p.id).redirect, "code"), VERIFIER, client.id, CLAUDE).tokens != null, "grant " + i);
      now.addAndGet(1000);
    }
    check(oauth.grants().size() == McpOAuth.MAX_GRANTS, "grants are bounded");

    McpOAuth crowded = new McpOAuth(now::get, null);
    for (int i = 0; i < McpOAuth.MAX_CLIENTS; i++) check(crowded.register("c" + i, Arrays.asList(CLAUDE)) != null, "client " + i);
    check(crowded.register("one more", Arrays.asList(CLAUDE)) != null && crowded.clients().size() == McpOAuth.MAX_CLIENTS, "a full table drops its oldest unused client");

    System.out.println("McpOAuthTest passed");
  }
}
