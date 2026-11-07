package com.novaguard.surveillance

import android.content.Context
import android.util.Log
import com.novaguard.R
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URLDecoder
import java.security.SecureRandom
import java.util.Base64

/**
 * The HTTP face of [McpOAuth]: the metadata documents, registration, the
 * authorization page, the token endpoint, and the file the state lives in.
 *
 * Everything here is reached through the relay, and only through it: the LAN
 * socket never accepts an OAuth token (`principalFor`). Every decision is the
 * owner's, taken on the phone — `/authorize` only opens a request and shows a
 * code, and the browser page that asked learns the outcome by polling.
 *
 * The state file holds digests and metadata, never a token, in the app's private
 * directory. Losing it costs the cloud clients a new authorization, nothing more.
 */
class McpOAuthServer(
  private val context: Context,
  /** A request is waiting for the owner: tell them, whatever the app is doing. */
  private val onWaiting: (clientName: String) -> Unit,
) {
  private val file = File(context.filesDir, FILE)
  private val persistLock = Any()
  private val random = SecureRandom()

  /**
   * The browser page's script lives in `res/raw`, not in this file: it is code for the owner's browser,
   * and `playRelease.test.ts` rightly reads any network call named in the Kotlin sources as the app dialling out.
   */
  private val waitScript: String by lazy {
    context.resources.openRawResource(R.raw.mcp_oauth_wait).bufferedReader().use { it.readText() }
  }

  val oauth: McpOAuth = McpOAuth({ System.currentTimeMillis() }, { persist() })

  init {
    load()
  }

  // ------------------------------------------------------------------ routing

  /** Null when `req` is not one of the authorization server's endpoints. */
  fun handle(req: RelayRequest, issuer: String): RelayReply? {
    val path = req.path.substringBefore('?')
    val query = form(req.path.substringAfter('?', ""))
    return when {
      req.method == "GET" && path == "/.well-known/oauth-protected-resource/mcp" -> json(200, resourceMetadata(issuer))
      req.method == "GET" && path == "/.well-known/oauth-authorization-server" -> json(200, serverMetadata(issuer))
      req.method == "POST" && path == "/register" -> register(req)
      req.method == "GET" && path == "/authorize" -> authorize(query, issuer)
      req.method == "GET" && path == "/authorize/status" -> status(query["id"])
      req.method == "POST" && path == "/token" -> token(form(String(req.body, Charsets.UTF_8)))
      else -> null
    }
  }

  private fun resourceMetadata(issuer: String) = JSONObject()
    .put("resource", "$issuer/mcp")
    .put("authorization_servers", JSONArray().put(issuer))
    .put("scopes_supported", JSONArray().put(McpOAuth.SCOPE))
    .put("bearer_methods_supported", JSONArray().put("header"))

  private fun serverMetadata(issuer: String) = JSONObject()
    .put("issuer", issuer)
    .put("authorization_endpoint", "$issuer/authorize")
    .put("token_endpoint", "$issuer/token")
    .put("registration_endpoint", "$issuer/register")
    .put("response_types_supported", JSONArray().put("code"))
    .put("grant_types_supported", JSONArray().put("authorization_code").put("refresh_token"))
    .put("code_challenge_methods_supported", JSONArray().put("S256"))
    .put("token_endpoint_auth_methods_supported", JSONArray().put("none"))
    .put("scopes_supported", JSONArray().put(McpOAuth.SCOPE))

  // ------------------------------------------------------------------ registration

  private fun register(req: RelayRequest): RelayReply {
    val body = try { JSONObject(String(req.body, Charsets.UTF_8)) } catch (_: Exception) {
      return oauthError(400, "invalid_client_metadata", "Body must be JSON")
    }
    val method = body.optString("token_endpoint_auth_method", "none")
    if (method != "none") return oauthError(400, "invalid_client_metadata", "Only public clients are supported")
    val uris = ArrayList<String>()
    val given = body.optJSONArray("redirect_uris")
    if (given != null) for (i in 0 until given.length()) uris.add(given.optString(i))
    val client = oauth.register(body.optString("client_name"), uris)
      ?: return oauthError(400, "invalid_redirect_uri", "Redirect address not accepted")
    return json(
      201,
      JSONObject()
        .put("client_id", client.id)
        .put("client_name", client.name)
        .put("redirect_uris", JSONArray(client.redirectUris))
        .put("token_endpoint_auth_method", "none")
        .put("grant_types", JSONArray().put("authorization_code").put("refresh_token"))
        .put("response_types", JSONArray().put("code"))
        .put("scope", McpOAuth.SCOPE),
    )
  }

  // ------------------------------------------------------------------ authorization

  private fun authorize(query: Map<String, String>, issuer: String): RelayReply {
    // Until the redirect address is proven to be the client's own, nothing is ever sent to it:
    // these errors are shown here, not redirected.
    val client = oauth.client(query["client_id"]) ?: return failPage("Client inconnu · Unknown client")
    val redirect = query["redirect_uri"]
    if (redirect == null || redirect !in client.redirectUris) return failPage("Adresse de retour non enregistrée · Unregistered redirect address")
    if (query["response_type"] != "code") return failPage("response_type=code requis · required")
    val challenge = query["code_challenge"]
    if (query["code_challenge_method"] != "S256" || challenge == null || !challenge.matches(Regex("[A-Za-z0-9_-]{43,128}"))) {
      return failPage("PKCE S256 requis · PKCE S256 required")
    }
    if (McpOAuth.scopeFor(query["scope"]) == null) return failPage("Seule la lecture est possible · Only reading is possible")
    val resource = query["resource"]
    if (resource != null && resource != "$issuer/mcp") return failPage("Ressource inconnue · Unknown resource")

    val pending = oauth.begin(client, redirect, query["state"], challenge)
      ?: return failPage("Trop de demandes en attente · Too many pending requests", 429)
    onWaiting(client.name)
    val host = McpOAuth.redirectHost(redirect)
    val body = "<p>Un assistant — <b>${esc(client.name)}</b> (<code>${esc(host)}</code>) — demande à <b>lire</b> vos enregistrements NovaGuard. " +
      "<br><small>An assistant — <b>${esc(client.name)}</b> — asks to <b>read</b> your NovaGuard recordings.</small></p>" +
      "<p>Sur le téléphone, vérifiez que le code est le même · On the phone, check that the code is the same:</p>" +
      "<p class=\"code\">${esc(pending.verification)}</p>" +
      "<p id=\"s\"><small>En attente de votre confirmation sur le téléphone (2 minutes)… · Waiting for you on the phone…</small></p>"
    val script = waitScript.replace("__ID__", pending.id)
    return page(200, "NovaGuard", body, script)
  }

  private fun status(id: String?): RelayReply {
    val poll = oauth.poll(id)
    return json(200, JSONObject().put("status", poll.status).also { if (poll.redirect != null) it.put("redirect", poll.redirect) })
  }

  // ------------------------------------------------------------------ tokens

  private fun token(form: Map<String, String>): RelayReply {
    val result = when (form["grant_type"]) {
      "authorization_code" -> oauth.exchangeCode(form["code"], form["code_verifier"], form["client_id"], form["redirect_uri"])
      "refresh_token" -> oauth.refresh(form["refresh_token"], form["client_id"])
      else -> return oauthError(400, "unsupported_grant_type", "authorization_code and refresh_token only")
    }
    val tokens = result.tokens
      ?: return oauthError(if (result.error == "invalid_client") 401 else 400, result.error ?: "invalid_request", result.description ?: "")
    return json(
      200,
      JSONObject()
        .put("access_token", tokens.accessToken)
        .put("token_type", "Bearer")
        .put("expires_in", tokens.expiresInSeconds)
        .put("refresh_token", tokens.refreshToken)
        .put("scope", McpOAuth.SCOPE),
    )
  }

  // ------------------------------------------------------------------ responses

  private fun json(status: Int, body: JSONObject) = RelayReply(
    status,
    mapOf("content-type" to "application/json", "cache-control" to "no-store"),
    body.toString().toByteArray(Charsets.UTF_8),
  )

  private fun oauthError(status: Int, error: String, description: String) =
    json(status, JSONObject().put("error", error).put("error_description", description))

  private fun failPage(message: String, status: Int = 400) = page(status, "NovaGuard", "<p>${esc(message)}</p>")

  /** HTML for the owner's browser: no outside resource, a script only with this response's nonce, never framed. */
  private fun page(status: Int, title: String, body: String, script: String? = null): RelayReply {
    val nonce = ByteArray(16).also { random.nextBytes(it) }.let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }
    val html = "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\">" +
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>${esc(title)}</title>" +
      "<style nonce=\"$nonce\">body{font:16px system-ui,sans-serif;max-width:30rem;margin:12vh auto;padding:0 1rem;color:#111}" +
      ".code{font:700 2.5rem monospace;letter-spacing:.3rem}small{color:#555}</style></head>" +
      "<body><h1>${esc(title)}</h1>$body" +
      (if (script != null) "<script nonce=\"$nonce\">$script</script>" else "") + "</body></html>"
    return RelayReply(
      status,
      mapOf(
        "content-type" to "text/html; charset=utf-8",
        "cache-control" to "no-store",
        "content-security-policy" to "default-src 'none'; style-src 'nonce-$nonce'; script-src 'nonce-$nonce'; " +
          "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "referrer-policy" to "no-referrer",
        "x-frame-options" to "DENY",
      ),
      html.toByteArray(Charsets.UTF_8),
    )
  }

  private fun esc(text: String) = text
    .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;")

  /** `a=b&c=d`, decoded. A repeated name keeps its first value. */
  private fun form(raw: String): Map<String, String> {
    val out = LinkedHashMap<String, String>()
    if (raw.isEmpty()) return out
    for (pair in raw.split('&')) {
      if (pair.isEmpty()) continue
      val name = pair.substringBefore('=')
      val value = pair.substringAfter('=', "")
      try {
        out.putIfAbsent(URLDecoder.decode(name, "UTF-8"), URLDecoder.decode(value, "UTF-8"))
      } catch (_: Exception) {
        // A malformed escape drops that parameter, and the request fails on what it then lacks.
      }
    }
    return out
  }

  // ------------------------------------------------------------------ persistence

  private fun persist() {
    synchronized(persistLock) {
      try {
        val clients = JSONArray()
        for (c in oauth.clients()) {
          clients.put(
            JSONObject().put("id", c.id).put("name", c.name).put("redirectUris", JSONArray(c.redirectUris)).put("createdAt", c.createdAt),
          )
        }
        val grants = JSONArray()
        for (g in oauth.grants()) {
          grants.put(
            JSONObject()
              .put("id", g.id).put("clientId", g.clientId).put("clientName", g.clientName).put("redirectHost", g.redirectHost)
              .put("createdAt", g.createdAt).put("validUntil", g.validUntil).put("lastUsedAt", g.lastUsedAt)
              .put("accessDigest", g.accessDigest ?: JSONObject.NULL).put("accessExpiresAt", g.accessExpiresAt)
              .put("refreshDigest", g.refreshDigest ?: JSONObject.NULL).put("refreshExpiresAt", g.refreshExpiresAt)
              .put("previousRefreshDigest", g.previousRefreshDigest ?: JSONObject.NULL),
          )
        }
        val tmp = File(file.path + ".tmp")
        tmp.writeText(JSONObject().put("clients", clients).put("grants", grants).toString())
        if (!tmp.renameTo(file)) {
          file.delete()
          tmp.renameTo(file)
        }
      } catch (e: Exception) {
        Log.w(TAG, "OAuth state not saved: ${e.javaClass.simpleName}")
      }
    }
  }

  private fun load() {
    if (!file.exists()) return
    try {
      val root = JSONObject(file.readText())
      val clients = ArrayList<McpOAuth.Client>()
      val savedClients = root.optJSONArray("clients") ?: JSONArray()
      for (i in 0 until savedClients.length()) {
        val c = savedClients.getJSONObject(i)
        val uris = ArrayList<String>()
        val list = c.getJSONArray("redirectUris")
        for (j in 0 until list.length()) uris.add(list.getString(j))
        clients.add(McpOAuth.Client(c.getString("id"), c.getString("name"), uris, c.optLong("createdAt")))
      }
      val grants = ArrayList<McpOAuth.Grant>()
      val savedGrants = root.optJSONArray("grants") ?: JSONArray()
      for (i in 0 until savedGrants.length()) {
        val g = savedGrants.getJSONObject(i)
        val grant = McpOAuth.Grant(g.getString("id"), g.getString("clientId"), g.optString("clientName"), g.optString("redirectHost"), g.optLong("createdAt"))
        grant.lastUsedAt = g.optLong("lastUsedAt")
        grant.accessDigest = g.optString("accessDigest").ifEmpty { null }
        grant.accessExpiresAt = g.optLong("accessExpiresAt")
        grant.refreshDigest = g.optString("refreshDigest").ifEmpty { null }
        grant.refreshExpiresAt = g.optLong("refreshExpiresAt")
        grant.validUntil = g.optLong("validUntil")
        grant.previousRefreshDigest = g.optString("previousRefreshDigest").ifEmpty { null }
        grants.add(grant)
      }
      oauth.restoreClients(clients)
      oauth.restoreGrants(grants)
    } catch (e: Exception) {
      // An unreadable file is not a reason to refuse to start: clients authorize again.
      Log.w(TAG, "OAuth state unreadable, starting empty: ${e.javaClass.simpleName}")
    }
  }

  companion object {
    private const val TAG = "NovaGuardOAuth"
    private const val FILE = "mcp_oauth.json"
  }
}
