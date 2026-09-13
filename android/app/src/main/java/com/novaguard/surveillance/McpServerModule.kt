package com.novaguard.surveillance

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

/**
 * NovaGuard's MCP server, on the device.
 *
 * The TypeScript server under `novaguard-mcp/` is Node: it imports `http`,
 * `dns` and `net` and allocates `Buffer`s, none of which exist in Hermes. It
 * could therefore never be what the Setup toggle started, and for a while the
 * toggle started nothing at all — it wrote a setting no code read, which is
 * the inert-section failure this repository has already shipped once.
 *
 * This module is the half that runs where the data is. It speaks JSON-RPC 2.0
 * over HTTP and answers out of a snapshot JavaScript pushes whenever the
 * history or the settings change, so nothing here touches the frame path: the
 * analysis pipeline never waits on a socket.
 *
 * Read-only is structural, not a policy check bolted on top: this module holds
 * no reference able to modify surveillance state. It reads a snapshot and two
 * directories of files, and that is the whole of its reach.
 */
class McpServerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  private var serverSocket: ServerSocket? = null
  private var threadPool = Executors.newCachedThreadPool()
  private var currentPort: Int = DEFAULT_PORT
  private var boundToLoopbackOnly: Boolean = true

  @Volatile private var isServerRunning: Boolean = false
  /** SHA-256 of the bearer token, so the token itself is not held in memory. */
  @Volatile private var tokenDigest: ByteArray? = null
  @Volatile private var snapshot: Snapshot = Snapshot.empty()

  private val requestCount = AtomicLong(0)
  private val lastActivityAt = AtomicLong(0)
  private val rateLimiter = ConcurrentHashMap<String, RateWindow>()

  // ---------------------------------------------------------------- lifecycle

  @ReactMethod
  fun startServer(port: Int, token: String?, promise: Promise) {
    try {
      if (isServerRunning) stopServerInternal()

      currentPort = if (port in 1024..65535) port else DEFAULT_PORT
      val trimmed = token?.trim().orEmpty()
      tokenDigest = if (trimmed.length >= MIN_TOKEN_LENGTH) sha256(trimmed) else null

      // No token means no way to tell a caller apart, so there is nothing to
      // expose to: the socket stays on loopback, reachable only by something
      // already running on this phone. A LAN bind is what a token buys.
      boundToLoopbackOnly = tokenDigest == null
      val bindAddress =
        if (boundToLoopbackOnly) InetAddress.getByName("127.0.0.1") else null

      serverSocket = ServerSocket().apply {
        reuseAddress = true
        bind(InetSocketAddress(bindAddress, currentPort))
      }

      isServerRunning = true
      if (threadPool.isShutdown) threadPool = Executors.newCachedThreadPool()
      threadPool.execute { listenForConnections() }

      Log.i(TAG, "MCP server listening on $currentPort (loopbackOnly=$boundToLoopbackOnly)")
      promise.resolve(statusMap())
    } catch (e: Exception) {
      Log.e(TAG, "Failed to start MCP server: ${e.message}", e)
      isServerRunning = false
      promise.reject("MCP_SERVER_ERROR", "Failed to start MCP server: ${e.message}")
    }
  }

  @ReactMethod
  fun stopServer(promise: Promise) {
    try {
      stopServerInternal()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("MCP_SERVER_ERROR", "Failed to stop MCP server: ${e.message}")
    }
  }

  @ReactMethod
  fun getServerStatus(promise: Promise) {
    promise.resolve(statusMap())
  }

  /**
   * Mints a bearer token.
   *
   * `SecureRandom` rather than JavaScript's `Math.random`, which was what
   * produced these: it is a fast non-cryptographic generator whose state is
   * recoverable from its own output, and the string it produced is the single
   * credential standing between this server and everything on the Wi-Fi.
   */
  @ReactMethod
  fun generateToken(promise: Promise) {
    val random = java.security.SecureRandom()
    val builder = StringBuilder(TOKEN_LENGTH)
    repeat(TOKEN_LENGTH) { builder.append(TOKEN_ALPHABET[random.nextInt(TOKEN_ALPHABET.length)]) }
    promise.resolve("mcp_$builder")
  }

  /**
   * The state this server answers from, pushed by JavaScript.
   *
   * Called when the history, the storage figures or the settings change —
   * never per frame. Parsing happens here, off the caller's thread being the
   * point: a request must not pay for a JSON decode, and the JS thread must
   * not pay for a request.
   */
  @ReactMethod
  fun updateSnapshot(json: String) {
    try {
      snapshot = Snapshot.parse(JSONObject(json))
    } catch (e: Exception) {
      Log.w(TAG, "Ignored malformed MCP snapshot: ${e.message}")
    }
  }

  override fun invalidate() {
    stopServerInternal()
    super.invalidate()
  }

  private fun stopServerInternal() {
    isServerRunning = false
    try {
      serverSocket?.close()
    } catch (e: Exception) {
      Log.w(TAG, "Error closing MCP socket: ${e.message}")
    }
    serverSocket = null
    rateLimiter.clear()
    tokenDigest = null
    Log.i(TAG, "MCP server stopped")
  }

  private fun statusMap() = Arguments.createMap().apply {
    val ip = if (boundToLoopbackOnly) null else localIpAddress()
    val host = ip ?: "127.0.0.1"
    putBoolean("running", isServerRunning)
    putInt("port", currentPort)
    putString("ipAddress", ip)
    putString("url", if (isServerRunning) "http://$host:$currentPort/mcp" else null)
    putBoolean("hasToken", tokenDigest != null)
    putBoolean("loopbackOnly", boundToLoopbackOnly)
    putDouble("requestCount", requestCount.get().toDouble())
    val last = lastActivityAt.get()
    if (last > 0) putDouble("lastActivityAt", last.toDouble()) else putNull("lastActivityAt")
  }

  // ------------------------------------------------------------------- socket

  private fun listenForConnections() {
    while (isServerRunning) {
      try {
        val socket = serverSocket?.accept() ?: break
        threadPool.execute { handleClient(socket) }
      } catch (e: Exception) {
        if (!isServerRunning) break
        Log.w(TAG, "MCP accept error: ${e.message}")
      }
    }
  }

  private fun handleClient(socket: Socket) {
    try {
      socket.soTimeout = SOCKET_TIMEOUT_MS
      val input = socket.getInputStream()
      val output = socket.getOutputStream()
      val remote = socket.inetAddress?.hostAddress ?: return respond(output, 400, jsonError("Invalid client address"))

      val requestLine = readLine(input, MAX_LINE_BYTES) ?: return
      val parts = requestLine.split(" ")
      val method = parts.getOrNull(0) ?: ""
      val path = (parts.getOrNull(1) ?: "/").substringBefore('?')

      var contentLength = 0
      var authHeader: String? = null
      var origin: String? = null
      var host: String? = null
      var contentType = ""
      var headerCount = 0
      while (true) {
        val line = readLine(input, MAX_LINE_BYTES) ?: break
        if (line.isEmpty()) break
        if (++headerCount > MAX_HEADERS) return respond(output, 431, jsonError("Too many headers"))
        val name = line.substringBefore(':').trim().lowercase()
        val value = line.substringAfter(':', "").trim()
        when (name) {
          "content-length" -> contentLength = value.toIntOrNull() ?: 0
          "authorization" -> authHeader = value
          "origin" -> origin = value
          "host" -> host = value
          "content-type" -> contentType = value.lowercase()
        }
      }

      // Browser-originated requests are refused outright. A page on some other
      // site must not be able to drive this server through the user's own
      // browser just because it reaches the phone's address — the DNS
      // rebinding case the MCP transport guidance calls out.
      if (origin != null && !isAllowedOrigin(origin)) {
        return respond(output, 403, jsonError("Forbidden origin"))
      }
      // The other half of the same defence. `Origin` is a browser header, so
      // an ordinary client sends none and the check above passes it through;
      // `Host` is sent by everything, and a page whose hostname was pointed at
      // this device carries a Host this server does not answer to.
      if (!isAllowedHost(host)) {
        return respond(output, 421, jsonError("Misdirected Request"))
      }
      if (!allowRequest(remote)) {
        return respond(output, 429, jsonError("Too Many Requests"), mapOf("Retry-After" to "60"))
      }

      if (method == "GET" && path == "/health") {
        return respond(output, 200, JSONObject().put("status", "ok").toString())
      }
      if (method != "POST") {
        return respond(output, 405, jsonError("Method Not Allowed"))
      }
      if (!contentType.contains("application/json")) {
        return respond(output, 415, jsonError("Content-Type must be application/json"))
      }
      if (contentLength <= 0 || contentLength > MAX_BODY_BYTES) {
        return respond(output, 413, jsonError("Request Entity Too Large"))
      }

      val body = readBody(input, contentLength) ?: return respond(output, 400, jsonError("Truncated body"))

      requestCount.incrementAndGet()
      lastActivityAt.set(System.currentTimeMillis())

      val request = try {
        JSONObject(body)
      } catch (_: Exception) {
        return respond(output, 400, parseErrorResponse())
      }

      val authorized = isAuthorized(authHeader, remote)
      val response = dispatch(request, authorized)
        ?: return respond(output, 202, "") // a notification: accepted, no body

      val status = httpStatusFor(response)
      respond(output, status, response.toString(), mapOf("MCP-Protocol-Version" to LATEST_PROTOCOL))
    } catch (e: Exception) {
      Log.w(TAG, "MCP client error: ${e.message}")
    } finally {
      try {
        if (!socket.isClosed) socket.close()
      } catch (_: Exception) {}
    }
  }

  private fun isAllowedOrigin(origin: String): Boolean =
    expectedAuthorities().any { origin == "http://$it" }

  private fun isAllowedHost(host: String?): Boolean {
    if (host == null) return false
    return expectedAuthorities().contains(host.lowercase())
  }

  /**
   * The authorities this server answers to.
   *
   * The LAN address is included only when the socket is actually bound off
   * loopback — without a token it is not, and accepting a Host it never
   * listens on would give back exactly what the check is for.
   */
  private fun expectedAuthorities(): List<String> {
    val authorities = mutableListOf(
      "127.0.0.1:$currentPort",
      "localhost:$currentPort",
      "[::1]:$currentPort",
    )
    if (!boundToLoopbackOnly) localIpAddress()?.let { authorities.add("$it:$currentPort") }
    return authorities
  }

  private fun allowRequest(remote: String): Boolean {
    val now = System.currentTimeMillis()
    // Pruned on every pass rather than only on stop: one entry per peer that
    // ever connected is a slow leak on a server meant to run for weeks.
    if (rateLimiter.size > MAX_RATE_ENTRIES) {
      rateLimiter.entries.removeAll { it.value.resetAt <= now }
    }
    val window = rateLimiter.compute(remote) { _, existing ->
      if (existing == null || existing.resetAt <= now) RateWindow(1, now + RATE_WINDOW_MS)
      else RateWindow(existing.count + 1, existing.resetAt)
    }!!
    return window.count <= MAX_REQUESTS_PER_WINDOW
  }

  private fun isAuthorized(authHeader: String?, remote: String): Boolean {
    val expected = tokenDigest
    val presented = authHeader
      ?.let { if (it.startsWith("Bearer ", ignoreCase = true)) it.substring(7) else it }
      ?.trim()
      .orEmpty()

    if (expected != null && presented.isNotEmpty()) {
      // Digest comparison through MessageDigest.isEqual: a token must not be
      // recoverable one byte at a time from how long the comparison took.
      if (MessageDigest.isEqual(expected, sha256(presented))) return true
    }
    // Loopback needs no token: the caller is already running on this device,
    // where it could read the clips directly. Anything off the device does.
    return isLoopback(remote)
  }

  private fun isLoopback(remote: String): Boolean =
    remote == "127.0.0.1" || remote == "::1" || remote == "0:0:0:0:0:0:0:1" || remote == "::ffff:127.0.0.1"

  // ----------------------------------------------------------------- protocol

  /** Returns null for a notification, which JSON-RPC forbids answering. */
  private fun dispatch(request: JSONObject, authorized: Boolean): JSONObject? {
    val id: Any? = if (request.has("id") && !request.isNull("id")) request.get("id") else null
    val method = request.optString("method")
    val isNotification = !request.has("id")

    if (request.optString("jsonrpc") != "2.0" || method.isEmpty() || method.length > MAX_METHOD_LENGTH) {
      if (isNotification) return null
      return errorResponse(id, -32600, "NOVAGUARD_INVALID_REQUEST", "Invalid JSON-RPC request")
    }
    if (method.startsWith("notifications/")) return null

    if (!authorized) {
      return errorResponse(id, -32603, "NOVAGUARD_AUTH_REQUIRED", "Authentication token is required for non-loopback connections")
    }

    val params = request.optJSONObject("params") ?: JSONObject()
    return try {
      when (method) {
        "initialize" -> successResponse(id, initializeResult(params))
        "ping" -> successResponse(id, JSONObject())
        "tools/list" -> successResponse(id, JSONObject().put("tools", McpCatalog.tools()))
        "tools/call" -> successResponse(id, callToolReportingFailures(params))
        "resources/list" -> successResponse(id, JSONObject().put("resources", McpCatalog.resources(snapshot)))
        "resources/templates/list" -> successResponse(id, JSONObject().put("resourceTemplates", McpCatalog.resourceTemplates()))
        "resources/read" -> successResponse(id, readResource(params.optString("uri")))
        else -> errorResponse(id, -32601, "NOVAGUARD_NOT_FOUND", "Method '$method' not found")
      }
    } catch (e: McpException) {
      errorResponse(id, e.rpcCode, e.code, e.message ?: "Request failed")
    } catch (e: Exception) {
      Log.w(TAG, "MCP dispatch error on $method: ${e.message}")
      // Deliberately not e.message: an internal failure must not describe the
      // device's filesystem to a caller across the network.
      errorResponse(id, -32603, "NOVAGUARD_DEVICE_UNAVAILABLE", "Internal server error")
    }
  }

  /**
   * Runs a tool, turning a failure of the tool itself into a result.
   *
   * The specification separates the two: a protocol fault — an unknown or
   * refused tool, missing authorisation — is a JSON-RPC error the caller
   * cannot work around, while a call that reached a tool and could not be
   * answered comes back as a result carrying `isError`. Only the second form
   * reaches the model that asked; as a transport error it is invisible to it,
   * so "event 9999 does not exist" would look like the server being broken
   * rather than like an id to correct.
   */
  private fun callToolReportingFailures(params: JSONObject): JSONObject {
    // Both checks sit outside the catch on purpose. A refused or unknown tool
    // is a protocol fault — nothing ran, and no argument a caller sends would
    // change that — so it stays a JSON-RPC error where the specification puts
    // it rather than becoming a result the model is invited to work around.
    val rawName = params.optString("name")
    assertNotForbidden(rawName)
    if (!McpCatalog.isKnownTool(rawName)) {
      throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Unknown tool: '$rawName'", -32602)
    }
    return try {
      callTool(params)
    } catch (e: McpException) {
      if (!TOOL_EXECUTION_FAILURES.contains(e.code)) throw e
      JSONObject()
        .put("content", JSONArray().put(JSONObject().put("type", "text").put("text", "${e.code}: ${e.message}")))
        .put("isError", true)
    }
  }

  private fun assertNotForbidden(rawName: String) {
    val operation = McpCatalog.TOOL_PREFIXES.firstNotNullOfOrNull { prefix ->
      if (rawName.startsWith(prefix)) rawName.removePrefix(prefix) else null
    } ?: rawName
    if (FORBIDDEN_OPERATIONS.contains(operation)) {
      throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Operation '$rawName' is forbidden on a read-only server", -32602)
    }
  }

  private fun initializeResult(params: JSONObject): JSONObject {
    val requested = params.optString("protocolVersion")
    // Negotiate rather than refuse. Pinning one version and erroring on every
    // other means no client that does not already know this server's private
    // version string can complete a handshake.
    val agreed = if (SUPPORTED_PROTOCOLS.contains(requested)) requested else LATEST_PROTOCOL
    return JSONObject()
      .put("protocolVersion", agreed)
      .put(
        "capabilities",
        JSONObject()
          .put("tools", JSONObject().put("listChanged", false))
          .put("resources", JSONObject().put("subscribe", false).put("listChanged", false))
      )
      .put("serverInfo", JSONObject().put("name", "novaguard-mcp").put("version", SERVER_VERSION))
  }

  private fun callTool(params: JSONObject): JSONObject {
    val rawName = params.optString("name")
    if (rawName.isEmpty() || rawName.length > MAX_METHOD_LENGTH) {
      throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Tool name is required", -32602)
    }
    // `mcp.md` names the tools with dots; the Claude API's tool-name pattern
    // rejects them. The underscore form is what `tools/list` advertises, and
    // the dotted form stays accepted so documented calls keep working. An
    // unprefixed name is neither, and is not a tool this server ever named.
    val name = McpCatalog.TOOL_PREFIXES.firstNotNullOfOrNull { prefix ->
      if (rawName.startsWith(prefix)) rawName.removePrefix(prefix) else null
    }
    assertNotForbidden(rawName)
    if (name == null) throw McpException("NOVAGUARD_NOT_FOUND", "Unknown tool: '$rawName'", -32601)
    val args = params.optJSONObject("arguments") ?: JSONObject()
    McpCatalog.validateArguments(name, args)

    val payload: Any = when (name) {
      "get_status" -> snapshot.statusJson()
      "get_storage" -> snapshot.storageJson()
      "get_configuration" -> snapshot.configurationJson()
      "get_camera_info" -> snapshot.cameraInfoJson()
      "get_event" -> snapshot.requireEvent(args.optLong("eventId", -1)).toJson()
      "get_latest_events" -> snapshot.latestEvents(args)
      "search_events" -> snapshot.searchEvents(args)
      "get_statistics" -> snapshot.statistics(args)
      else -> throw McpException("NOVAGUARD_NOT_FOUND", "Unknown tool: '$rawName'", -32601)
    }

    val result = JSONObject()
      .put("content", JSONArray().put(JSONObject().put("type", "text").put("text", payload.toString())))
      .put("isError", false)
    // `structuredContent` is specified as an object. A tool whose payload is a
    // list (get_latest_events) carries it in `content` only rather than
    // handing a client a shape the schema does not allow.
    if (payload is JSONObject) result.put("structuredContent", payload)
    return result
  }

  private fun readResource(uri: String): JSONObject {
    val parsed = McpCatalog.parseResourceUri(uri)
    val contents = JSONObject().put("uri", uri)

    when (parsed.type) {
      "status" -> contents.put("mimeType", "application/json").put("text", snapshot.statusJson().toString())
      "event" -> contents.put("mimeType", "application/json")
        .put("text", snapshot.requireEvent(parsed.param.toLong()).toJson().toString())
      "timeline" -> contents.put("mimeType", "application/json")
        .put("text", snapshot.timeline(parsed.param).toString())
      "statistics" -> contents.put("mimeType", "application/json")
        .put("text", snapshot.statisticsForPeriod(parsed.param).toString())
      "thumbnail" -> {
        val event = snapshot.requireEvent(parsed.param.toLong())
        contents.put("mimeType", "image/jpeg")
          .put("blob", readMediaBase64(event.thumbPath, MAX_THUMBNAIL_BYTES, parsed.param))
      }
      "video" -> {
        val event = snapshot.requireEvent(parsed.param.toLong())
        contents.put("mimeType", "video/mp4")
          .put("blob", readMediaBase64(event.videoPath, MAX_VIDEO_BYTES, parsed.param))
      }
      else -> throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Unknown resource type", -32602)
    }
    return JSONObject().put("contents", JSONArray().put(contents))
  }

  /**
   * Reads one clip or still off disk.
   *
   * The path comes from the snapshot, never from the request: a URI names an
   * event id, and the id is what selects the path. There is no request shape
   * that reaches a file NovaGuard did not record, which is why no amount of
   * traversal in the URI matters here — the containment check below is the
   * second lock, for a snapshot that went wrong.
   */
  private fun readMediaBase64(path: String?, maxBytes: Long, eventId: String): String {
    if (path.isNullOrEmpty()) {
      throw McpException("NOVAGUARD_MEDIA_UNAVAILABLE", "Media for event $eventId unavailable", -32603)
    }
    val file = File(path)
    val root = reactContext.filesDir.canonicalFile
    val canonical = try {
      file.canonicalFile
    } catch (_: Exception) {
      throw McpException("NOVAGUARD_MEDIA_UNAVAILABLE", "Media for event $eventId unavailable", -32603)
    }
    if (!canonical.path.startsWith(root.path + File.separator)) {
      throw McpException("NOVAGUARD_MEDIA_FORBIDDEN", "Media outside the recordings directory", -32603)
    }
    if (!canonical.isFile) {
      throw McpException("NOVAGUARD_MEDIA_UNAVAILABLE", "Media for event $eventId unavailable", -32603)
    }
    if (canonical.length() > maxBytes) {
      throw McpException("NOVAGUARD_MEDIA_TOO_LARGE", "Media exceeds the ${maxBytes} byte maximum", -32603)
    }
    val bytes = canonical.readBytes()
    return android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
  }

  // ------------------------------------------------------------------ plumbing

  private fun httpStatusFor(response: JSONObject): Int {
    val code = response.optJSONObject("error")?.optJSONObject("data")?.optString("mcpErrorCode")
      ?: return 200
    return when (code) {
      "NOVAGUARD_AUTH_REQUIRED" -> 401
      "NOVAGUARD_AUTH_FORBIDDEN" -> 403
      "NOVAGUARD_NOT_FOUND" -> 404
      "NOVAGUARD_INVALID_ARGUMENT", "NOVAGUARD_INVALID_REQUEST" -> 400
      "NOVAGUARD_MEDIA_TOO_LARGE" -> 413
      else -> 500
    }
  }

  private fun successResponse(id: Any?, result: JSONObject) = JSONObject()
    .put("jsonrpc", "2.0")
    .put("id", id ?: JSONObject.NULL)
    .put("result", result)

  private fun errorResponse(id: Any?, rpcCode: Int, mcpCode: String, message: String) = JSONObject()
    .put("jsonrpc", "2.0")
    .put("id", id ?: JSONObject.NULL)
    .put(
      "error",
      JSONObject()
        .put("code", rpcCode)
        .put("message", "$mcpCode: $message")
        .put("data", JSONObject().put("mcpErrorCode", mcpCode))
    )

  private fun parseErrorResponse() = JSONObject()
    .put("jsonrpc", "2.0")
    .put("id", JSONObject.NULL)
    .put("error", JSONObject().put("code", -32700).put("message", "Parse error"))
    .toString()

  private fun jsonError(message: String) = JSONObject().put("error", message).toString()

  private fun respond(out: OutputStream, status: Int, body: String, extra: Map<String, String> = emptyMap()) {
    val bytes = body.toByteArray(Charsets.UTF_8)
    val reason = when (status) {
      200 -> "OK"; 202 -> "Accepted"; 400 -> "Bad Request"; 401 -> "Unauthorized"
      403 -> "Forbidden"; 404 -> "Not Found"; 405 -> "Method Not Allowed"
      413 -> "Payload Too Large"; 415 -> "Unsupported Media Type"; 421 -> "Misdirected Request"
      429 -> "Too Many Requests"; 431 -> "Request Header Fields Too Large"
      else -> "Internal Server Error"
    }
    val headers = StringBuilder("HTTP/1.1 $status $reason\r\n")
      .append("Content-Type: application/json\r\n")
      .append("Content-Length: ${bytes.size}\r\n")
      .append("Cache-Control: no-store\r\n")
      .append("Connection: close\r\n")
    if (status == 401) headers.append("WWW-Authenticate: Bearer realm=\"NovaGuard MCP\"\r\n")
    extra.forEach { (k, v) -> headers.append("$k: $v\r\n") }
    headers.append("\r\n")
    out.write(headers.toString().toByteArray(Charsets.UTF_8))
    if (bytes.isNotEmpty()) out.write(bytes)
    out.flush()
  }

  /** Reads a CRLF-terminated line without buffering past it. */
  private fun readLine(input: InputStream, limit: Int): String? {
    val builder = StringBuilder()
    while (builder.length <= limit) {
      val b = input.read()
      if (b == -1) return if (builder.isEmpty()) null else builder.toString()
      if (b == '\n'.code) return builder.toString().removeSuffix("\r")
      builder.append(b.toChar())
    }
    return null
  }

  private fun readBody(input: InputStream, length: Int): String? {
    val buffer = ByteArray(length)
    var read = 0
    while (read < length) {
      val n = input.read(buffer, read, length - read)
      if (n == -1) return null
      read += n
    }
    return String(buffer, Charsets.UTF_8)
  }

  private fun sha256(value: String): ByteArray =
    MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))

  private fun localIpAddress(): String? {
    try {
      val interfaces = NetworkInterface.getNetworkInterfaces()
      while (interfaces.hasMoreElements()) {
        val nic = interfaces.nextElement()
        if (nic.isLoopback || !nic.isUp) continue
        val addresses = nic.inetAddresses
        while (addresses.hasMoreElements()) {
          val addr = addresses.nextElement()
          if (!addr.isLoopbackAddress && addr is Inet4Address) {
            val ip = addr.hostAddress
            if (ip != null && !ip.startsWith("127.")) return ip
          }
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Error resolving IP address: ${e.message}")
    }
    return null
  }

  private data class RateWindow(val count: Int, val resetAt: Long)

  companion object {
    const val NAME = "McpServer"
    private const val TAG = "NovaGuardMcp"
    private const val DEFAULT_PORT = 8081
    private const val SERVER_VERSION = "1.0.0"
    private const val LATEST_PROTOCOL = "2025-06-18"
    private val SUPPORTED_PROTOCOLS = setOf("2024-11-05", "2025-03-26", "2025-06-18", "2026-07-28")
    private const val MIN_TOKEN_LENGTH = 16
    private const val TOKEN_LENGTH = 32
    private const val TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    private const val MAX_BODY_BYTES = 256 * 1024
    private const val MAX_LINE_BYTES = 8 * 1024
    private const val MAX_HEADERS = 64
    private const val MAX_METHOD_LENGTH = 128
    private const val SOCKET_TIMEOUT_MS = 30_000
    private const val RATE_WINDOW_MS = 60_000L
    private const val MAX_REQUESTS_PER_WINDOW = 120
    private const val MAX_RATE_ENTRIES = 1_024
    private const val MAX_THUMBNAIL_BYTES = 2L * 1024 * 1024
    private const val MAX_VIDEO_BYTES = 20L * 1024 * 1024

    /**
     * Names this server refuses by name as well as by absence.
     *
     * Every one of them is already unreachable — no branch implements them —
     * so this list buys one thing: a caller that asks to stop surveillance is
     * told it is forbidden rather than that the tool is unknown, and the day
     * someone adds a write path they collide with this set first.
     */
    /**
     * Failures that mean the tool ran and could not answer, as opposed to the
     * request never reaching a tool. The first come back as a result carrying
     * `isError`; everything else stays a JSON-RPC error.
     */
    private val TOOL_EXECUTION_FAILURES = setOf(
      "NOVAGUARD_NOT_FOUND", "NOVAGUARD_INVALID_ARGUMENT", "NOVAGUARD_RANGE_TOO_LARGE",
      "NOVAGUARD_LIMIT_EXCEEDED", "NOVAGUARD_MEDIA_UNAVAILABLE", "NOVAGUARD_MEDIA_TOO_LARGE",
      "NOVAGUARD_STORAGE_UNAVAILABLE", "NOVAGUARD_DEVICE_UNAVAILABLE", "NOVAGUARD_TIMEOUT",
    )

    private val FORBIDDEN_OPERATIONS = setOf(
      "start_surveillance", "stop_surveillance", "arm_camera", "disarm_camera",
      "set_camera", "set_detection_threshold", "set_detection_zone", "set_sensitivity",
      "set_recording_quality", "set_retention", "set_notification_settings",
      "delete_event", "delete_video", "clear_history", "change_stream_pin",
      "restart_camera", "update_configuration"
    )

    internal val ISO: DateTimeFormatter = DateTimeFormatter.ISO_INSTANT
    internal fun isoOf(epochMs: Long): String = ISO.format(Instant.ofEpochMilli(epochMs))
    internal fun zone(): ZoneId = ZoneId.systemDefault()
    internal fun today(): LocalDate = LocalDate.now(zone())
  }
}

/** Carries both the MCP error code and the JSON-RPC code it maps to. */
internal class McpException(
  val code: String,
  message: String,
  val rpcCode: Int
) : Exception(message)
