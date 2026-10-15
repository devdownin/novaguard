package com.novaguard.surveillance

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.BatteryManager
import android.os.PowerManager
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.lang.ref.WeakReference
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * NovaGuard's MCP server, on the device.
 *
 * A TypeScript server once lived under `novaguard-mcp/`. It was Node: it imported `http`,
 * `dns` and `net` and allocated `Buffer`s, none of which exist in Hermes. It
 * could therefore never be what the Setup toggle started, and for a while the
 * toggle started nothing at all — it wrote a setting no code read, which is
 * the inert-section failure this repository has already shipped once.
 *
 * This module is the half that runs where the data is. It speaks JSON-RPC 2.0
 * over HTTP and answers out of a snapshot JavaScript pushes whenever the
 * history or the settings change, so nothing here touches the frame path: the
 * analysis pipeline never waits on a socket.
 *
 * It holds no reference able to modify surveillance state. Reading is from a
 * snapshot and the recordings directory; control — only when the device's own
 * switch allows it, and only for a caller holding the control token — is a
 * request handed to JavaScript, which carries it out with the screens' own
 * callbacks or refuses it (`mcpCommands.ts`). Nothing destructive is reachable.
 */
class McpServerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  private var serverSocket: ServerSocket? = null
  /**
   * Bounded, and fronted by `gate`: the cached pool this replaces grew one
   * thread per connection for as long as a peer kept them open, in the process
   * that runs the camera and the encoder.
   */
  private var threadPool = Executors.newFixedThreadPool(MAX_CONNECTIONS)
  private val gate = McpRules.ConnectionGate(MAX_CONNECTIONS, MAX_CONNECTIONS_PER_PEER)
  private var currentPort: Int = DEFAULT_PORT
  private var boundToLoopbackOnly: Boolean = true

  @Volatile private var isServerRunning: Boolean = false
  /** SHA-256 of the bearer token, so the token itself is not held in memory. */
  @Volatile private var tokenDigest: ByteArray? = null
  /** SHA-256 of the control token; null while the device does not allow control. */
  @Volatile private var controlDigest: ByteArray? = null
  /** Epoch ms after which the control token stops working; 0 for never. */
  @Volatile private var controlExpiresAt: Long = 0
  /** The DNS-SD registration while the socket is on the LAN, so a client finds a moved address. */
  private var nsdListener: NsdManager.RegistrationListener? = null
  @Volatile private var snapshot: Snapshot = Snapshot.empty()
  /** Signalled on every snapshot push, for `wait_for_event`. */
  private val snapshotLock = ReentrantLock()
  private val snapshotPushed = snapshotLock.newCondition()

  /** Control calls waiting on JavaScript, by request id. */
  private val pendingCommands = ConcurrentHashMap<String, CompletableFuture<String>>()
  private val commandSerial = AtomicLong(0)

  private val requestCount = AtomicLong(0)
  private val lastActivityAt = AtomicLong(0)
  private val rateLimiter = ConcurrentHashMap<String, RateWindow>()

  init {
    current = WeakReference(this)
  }

  // ---------------------------------------------------------------- lifecycle

  @ReactMethod
  fun startServer(
    port: Int, token: String?, controlToken: String?, controlEnabled: Boolean, controlExpiresAt: Double, promise: Promise,
  ) {
    try {
      if (isServerRunning) stopServerInternal()

      currentPort = if (port in 1024..65535) port else DEFAULT_PORT
      val trimmed = token?.trim().orEmpty()
      tokenDigest = if (trimmed.length >= MIN_TOKEN_LENGTH) sha256(trimmed) else null
      // The device switch grants control; the token only says who holds it.
      val control = controlToken?.trim().orEmpty()
      controlDigest = if (controlEnabled && control.length >= MIN_TOKEN_LENGTH) sha256(control) else null
      this.controlExpiresAt = controlExpiresAt.toLong()

      // No token means no way to tell a caller apart, so there is nothing to
      // expose to: the socket stays on loopback, reachable only by something
      // already running on this phone. A LAN bind is what a token buys.
      boundToLoopbackOnly = tokenDigest == null && controlDigest == null
      val bindAddress =
        if (boundToLoopbackOnly) InetAddress.getByName("127.0.0.1") else null

      serverSocket = ServerSocket().apply {
        reuseAddress = true
        bind(InetSocketAddress(bindAddress, currentPort))
      }

      isServerRunning = true
      if (threadPool.isShutdown) threadPool = Executors.newFixedThreadPool(MAX_CONNECTIONS)
      // Its own thread, not a pool slot: accepting must go on while every slot
      // is busy, so the excess can be refused quickly instead of queuing.
      Thread({ listenForConnections() }, "NovaGuardMcpAccept").apply { isDaemon = true; start() }

      if (!boundToLoopbackOnly) advertise()
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
      val next = Snapshot.parse(JSONObject(json), snapshot, System.currentTimeMillis())
      snapshotLock.withLock {
        snapshot = next
        snapshotPushed.signalAll()
      }
    } catch (e: Exception) {
      Log.w(TAG, "Ignored malformed MCP snapshot: ${e.message}")
    }
  }

  override fun invalidate() {
    stopServerInternal()
    super.invalidate()
  }

  /**
   * Control off, now — from the notification's "Couper le pilotage", which
   * must work with the screen off and whatever state the JS side is in. The
   * digest goes first, so no call is accepted after the tap; JavaScript is
   * then told to switch the setting off, which restarts the server without it.
   */
  fun revokeControl() {
    controlDigest = null
    pendingCommands.values.forEach { it.complete(REVOKED_OUTCOME) }
    try {
      if (reactContext.hasActiveReactInstance()) {
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(REVOKED_EVENT, null)
      }
    } catch (e: Exception) {
      Log.w(TAG, "Could not tell JS control was revoked: ${e.message}")
    }
  }

  private fun controlAvailable(): Boolean =
    controlDigest != null && McpRules.controlLive(controlExpiresAt, System.currentTimeMillis())

  /**
   * DNS-SD, `_novaguard-mcp._tcp`. The address a client was configured with is
   * a DHCP lease, and it moves without saying so; a client that browses the
   * service type finds the phone again. Only while the socket is on the LAN:
   * advertising a loopback server tells the network about something it cannot reach.
   */
  private fun advertise() {
    val nsd = reactContext.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return
    val info = NsdServiceInfo().apply {
      serviceName = SERVICE_NAME
      serviceType = SERVICE_TYPE
      port = currentPort
      setAttribute("path", "/mcp")
      setAttribute("auth", "bearer")
    }
    val listener = object : NsdManager.RegistrationListener {
      override fun onServiceRegistered(registered: NsdServiceInfo) { Log.i(TAG, "Advertised as ${registered.serviceName}") }
      override fun onRegistrationFailed(failed: NsdServiceInfo, errorCode: Int) { Log.w(TAG, "DNS-SD registration failed: $errorCode") }
      override fun onServiceUnregistered(gone: NsdServiceInfo) {}
      override fun onUnregistrationFailed(failed: NsdServiceInfo, errorCode: Int) {}
    }
    try {
      nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
      nsdListener = listener
    } catch (e: Exception) {
      Log.w(TAG, "DNS-SD unavailable: ${e.message}")
    }
  }

  private fun withdraw() {
    val listener = nsdListener ?: return
    nsdListener = null
    try {
      (reactContext.getSystemService(Context.NSD_SERVICE) as? NsdManager)?.unregisterService(listener)
    } catch (_: Exception) {}
  }

  private fun stopServerInternal() {
    isServerRunning = false
    try {
      serverSocket?.close()
    } catch (e: Exception) {
      Log.w(TAG, "Error closing MCP socket: ${e.message}")
    }
    serverSocket = null
    withdraw()
    rateLimiter.clear()
    tokenDigest = null
    controlDigest = null
    // A control call in flight is answered rather than left to time out.
    pendingCommands.values.forEach { it.complete(STOPPED_OUTCOME) }
    pendingCommands.clear()
    snapshotLock.withLock { snapshotPushed.signalAll() }
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
    putBoolean("controlEnabled", controlAvailable())
    putBoolean("advertised", nsdListener != null)
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
        val peer = socket.inetAddress?.hostAddress.orEmpty()
        if (!gate.tryEnter(peer)) {
          refuseBusy(socket)
          continue
        }
        try {
          threadPool.execute {
            try { handleClient(socket) } finally { gate.leave(peer) }
          }
        } catch (_: RejectedExecutionException) {
          gate.leave(peer)
          closeQuietly(socket)
        }
      } catch (e: Exception) {
        if (!isServerRunning) break
        Log.w(TAG, "MCP accept error: ${e.message}")
      }
    }
  }

  /** Over capacity: answered at once and closed, never queued behind the slow ones. */
  private fun refuseBusy(socket: Socket) {
    try {
      socket.soTimeout = 1_000
      respond(socket.getOutputStream(), 503, jsonError("Server busy"), mapOf("Retry-After" to "5"))
    } catch (_: Exception) {
    } finally {
      closeQuietly(socket)
    }
  }

  private fun closeQuietly(socket: Socket) {
    try { socket.close() } catch (_: Exception) {}
  }

  private fun handleClient(socket: Socket) {
    try {
      socket.soTimeout = SOCKET_TIMEOUT_MS
      val input = socket.getInputStream()
      val output = socket.getOutputStream()
      val remote = socket.inetAddress?.hostAddress ?: return respond(output, 400, jsonError("Invalid client address"))
      // The read timeout is renewed by every byte, so it bounds silence, not
      // duration: a peer trickling one byte a second held its slot forever.
      val deadline = McpRules.Deadline(System.currentTimeMillis(), REQUEST_DEADLINE_MS)

      val requestLine = readLine(socket, input, MAX_LINE_BYTES, deadline) ?: return
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
        val line = readLine(socket, input, MAX_LINE_BYTES, deadline) ?: break
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

      val body = readBody(socket, input, contentLength, deadline) ?: return respond(output, 400, jsonError("Truncated body"))

      requestCount.incrementAndGet()
      lastActivityAt.set(System.currentTimeMillis())

      val request = try {
        JSONObject(body)
      } catch (_: Exception) {
        return respond(output, 400, parseErrorResponse())
      }

      val (principal, expired) = principalFor(authHeader, remote)
      val response = dispatch(request, principal, expired)
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

  /** The caller's principal, and whether it presented a control token that has expired. */
  private fun principalFor(authHeader: String?, remote: String): Pair<Int, Boolean> {
    val presented = authHeader
      ?.let { if (it.startsWith("Bearer ", ignoreCase = true)) it.substring(7) else it }
      ?.trim()
      .orEmpty()
    // Digest comparison through MessageDigest.isEqual: a token must not be
    // recoverable one byte at a time from how long the comparison took.
    val digest = if (presented.isNotEmpty()) sha256(presented) else null
    fun matches(expected: ByteArray?) = expected != null && digest != null && MessageDigest.isEqual(expected, digest)
    val control = matches(controlDigest)
    val live = McpRules.controlLive(controlExpiresAt, System.currentTimeMillis())
    return McpRules.principal(control, live, matches(tokenDigest), isLoopback(remote)) to (control && !live)
  }

  private fun isLoopback(remote: String): Boolean =
    remote == "127.0.0.1" || remote == "::1" || remote == "0:0:0:0:0:0:0:1" || remote == "::ffff:127.0.0.1"

  // ----------------------------------------------------------------- protocol

  /** Returns null for a notification, which JSON-RPC forbids answering. */
  private fun dispatch(request: JSONObject, principal: Int, controlExpired: Boolean = false): JSONObject? {
    val id: Any? = if (request.has("id") && !request.isNull("id")) request.get("id") else null
    val method = request.optString("method")
    val isNotification = !request.has("id")

    if (request.optString("jsonrpc") != "2.0" || method.isEmpty() || method.length > MAX_METHOD_LENGTH) {
      if (isNotification) return null
      return errorResponse(id, -32600, "NOVAGUARD_INVALID_REQUEST", "Invalid JSON-RPC request")
    }
    if (method.startsWith("notifications/")) return null

    if (principal == McpRules.PRINCIPAL_NONE) {
      val why = if (controlExpired) "The control token has expired; the owner can issue a new one in Réglages"
        else "Authentication token is required for non-loopback connections"
      return errorResponse(id, -32603, "NOVAGUARD_AUTH_REQUIRED", why)
    }

    val params = request.optJSONObject("params") ?: JSONObject()
    return try {
      when (method) {
        "initialize" -> successResponse(id, initializeResult(params))
        "ping" -> successResponse(id, JSONObject())
        "tools/list" -> successResponse(id, JSONObject().put("tools", McpCatalog.tools(controlAvailable())))
        "tools/call" -> successResponse(id, callToolReportingFailures(params, principal))
        "resources/list" -> successResponse(id, JSONObject().put("resources", McpCatalog.resources(snapshot)))
        "resources/templates/list" -> successResponse(id, JSONObject().put("resourceTemplates", McpCatalog.resourceTemplates()))
        "resources/read" -> successResponse(id, readResource(params.optString("uri")))
        "prompts/list" -> successResponse(id, JSONObject().put("prompts", McpCatalog.prompts()))
        "prompts/get" -> successResponse(id, McpCatalog.renderPrompt(params, zone(), Instant.now()))
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
  private fun callToolReportingFailures(params: JSONObject, principal: Int): JSONObject {
    // Both checks sit outside the catch on purpose. A refused or unknown tool
    // is a protocol fault — nothing ran, and no argument a caller sends would
    // change that — so it stays a JSON-RPC error where the specification puts
    // it rather than becoming a result the model is invited to work around.
    val rawName = params.optString("name")
    assertNotForbidden(rawName)
    if (!McpCatalog.isKnownTool(rawName, controlAvailable())) {
      throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Unknown tool: '$rawName'", -32602)
    }
    // Refused before anything runs, like an unknown tool: no argument would
    // change the answer, only the other token.
    if (operationOf(rawName) in McpCatalog.CONTROL_TOOLS && principal != McpRules.PRINCIPAL_CONTROL) {
      throw McpException("NOVAGUARD_AUTH_FORBIDDEN", "'$rawName' needs the control token", -32001)
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
          .put("prompts", JSONObject().put("listChanged", false))
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
    if (name == "get_event_frames") return eventFrames(args)
    if (name == "wait_for_event") return toolResult(waitForEvent(args))
    if (name in McpCatalog.CONTROL_TOOLS) return toolResult(runCommand(name, args))

    val payload: Any = when (name) {
      "get_status" -> snapshot.statusJson()
      "get_storage" -> snapshot.storageJson()
      "get_configuration" -> snapshot.configurationJson()
      "get_camera_info" -> snapshot.cameraInfoJson()
      "get_event" -> snapshot.requireEvent(args.optLong("eventId", -1)).toJson()
      "get_latest_events" -> snapshot.latestEvents(args)
      "search_events" -> snapshot.searchEvents(args)
      "get_statistics" -> snapshot.statistics(args)
      "get_diagnostics" -> snapshot.diagnosticsJson().put("device", deviceLoad())
      else -> throw McpException("NOVAGUARD_NOT_FOUND", "Unknown tool: '$rawName'", -32601)
    }

    return toolResult(payload)
  }

  private fun toolResult(payload: Any): JSONObject {
    val result = JSONObject()
      .put("content", JSONArray().put(JSONObject().put("type", "text").put("text", payload.toString())))
      .put("isError", false)
    // `structuredContent` is specified as an object. A tool whose payload is a
    // list (get_latest_events) carries it in `content` only rather than
    // handing a client a shape the schema does not allow.
    if (payload is JSONObject) result.put("structuredContent", payload)
    return result
  }

  /**
   * Heat and power, read when asked rather than pushed: they move over
   * minutes, and the JS side samples them only while monitoring. -1 and null
   * are "the platform does not say", which most of the fleet answers.
   */
  private fun deviceLoad(): JSONObject {
    val power = reactContext.getSystemService(PowerManager::class.java)
    val battery = reactContext.getSystemService(BatteryManager::class.java)
    val level = battery?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
    return JSONObject()
      .put("thermalStatus", power?.currentThermalStatus ?: -1)
      .put("batteryPercent", if (level in 0..100) level else JSONObject.NULL)
      .put("charging", battery?.isCharging ?: JSONObject.NULL)
  }

  private fun operationOf(rawName: String): String =
    McpCatalog.TOOL_PREFIXES.firstNotNullOfOrNull { prefix ->
      if (rawName.startsWith(prefix)) rawName.removePrefix(prefix) else null
    } ?: rawName

  /**
   * Holds the request until an event newer than `afterEventId` is pushed, or
   * the budget runs out. A long poll on the existing transport: the server has
   * no stream to push on, and an agent polling `get_latest_events` every
   * second would cost a request — and a connection slot — per second.
   */
  private fun waitForEvent(args: JSONObject): JSONObject {
    val budget = McpRules.waitBudgetMs(args.optInt("timeoutSeconds", McpRules.DEFAULT_WAIT_SECONDS))
    val kind = args.optString("kind").takeIf { it.isNotEmpty() }
    val after = if (args.has("afterEventId")) args.optLong("afterEventId") else snapshot.latestEventId()
    val deadline = System.currentTimeMillis() + budget
    var found: List<McpEvent> = emptyList()
    snapshotLock.withLock {
      while (true) {
        found = snapshot.eventsAfter(after, kind)
        val left = deadline - System.currentTimeMillis()
        if (found.isNotEmpty() || left <= 0 || !isServerRunning) break
        snapshotPushed.await(left, TimeUnit.MILLISECONDS)
      }
    }
    val current = snapshot
    return JSONObject()
      .put("events", JSONArray().apply { found.forEach { put(it.toJson()) } })
      .put("timedOut", found.isEmpty())
      .put("latestEventId", current.latestEventId())
      .put("status", current.statusJson())
  }

  /**
   * A control call, carried out by JavaScript with the same callbacks the
   * screens use, so an agent's "stop" goes through exactly what the button
   * does. The request thread waits for the answer; the app's state is never
   * reached from here directly, which keeps this module unable to change
   * anything the JavaScript side has not agreed to.
   */
  private fun runCommand(name: String, args: JSONObject): JSONObject {
    if (!reactContext.hasActiveReactInstance()) {
      throw McpException("NOVAGUARD_DEVICE_UNAVAILABLE", "The app is not running", -32603)
    }
    val id = "c${commandSerial.incrementAndGet()}"
    val future = CompletableFuture<String>()
    pendingCommands[id] = future
    try {
      val payload = Arguments.createMap().apply {
        putString("id", id)
        putString("command", name)
        putString("args", args.toString())
      }
      reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(COMMAND_EVENT, payload)
      val raw = try {
        future.get(COMMAND_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      } catch (_: TimeoutException) {
        throw McpException("NOVAGUARD_TIMEOUT", "The app did not answer in time", -32603)
      }
      val outcome = JSONObject(raw)
      if (!outcome.optBoolean("ok")) {
        throw McpException(
          outcome.optString("code").ifEmpty { "NOVAGUARD_DEVICE_UNAVAILABLE" },
          outcome.optString("message").ifEmpty { "Command failed" },
          -32603,
        )
      }
      return (outcome.optJSONObject("result") ?: JSONObject()).put("changed", outcome.optBoolean("changed"))
    } finally {
      pendingCommands.remove(id)
    }
  }

  /** JavaScript's answer to a control call (see `resolveMcpCommand`). */
  @ReactMethod
  fun resolveCommand(id: String, outcomeJson: String) {
    pendingCommands[id]?.complete(outcomeJson)
  }

  /** Required by `NativeEventEmitter`; the events are emitted regardless. */
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Double) {}

  /**
   * Stills from an event's clip as image content — the form a model looks at.
   *
   * A text block first, saying where in the clip each image was taken, so the
   * model can tell "at 3 s" from "at 40 s" without guessing from the order.
   */
  private fun eventFrames(args: JSONObject): JSONObject {
    val event = snapshot.requireEvent(args.optLong("eventId", -1))
    val count = args.optInt("count", McpRules.DEFAULT_FRAMES)
    val maxEdge = args.optInt("maxEdge", McpFrames.DEFAULT_MAX_EDGE)
    val idText = event.id.toString()

    // No size cap on the clip: it is decoded in place, never loaded or encoded.
    val video = event.videoPath?.let { path -> runCatching { mediaFile(path, Long.MAX_VALUE, idText) }.getOrNull() }
    val frames: List<McpFrame>
    val source: String
    if (video != null) {
      frames = McpFrames.fromVideo(video, count, maxEdge)
      source = "video"
    } else {
      val still = mediaFile(event.thumbPath, MAX_THUMBNAIL_BYTES, idText)
      frames = listOf(McpFrame(0, android.util.Base64.encodeToString(still.readBytes(), android.util.Base64.NO_WRAP)))
      source = "thumbnail"
    }
    if (frames.isEmpty()) {
      throw McpException("NOVAGUARD_MEDIA_UNAVAILABLE", "No frame could be decoded for event $idText", -32603)
    }

    val summary = JSONObject()
      .put("eventId", event.id)
      .put("source", source)
      .put("frames", JSONArray().apply {
        frames.forEachIndexed { i, f -> put(JSONObject().put("index", i).put("offsetSeconds", f.offsetMs / 1000.0)) }
      })
    val content = JSONArray().put(JSONObject().put("type", "text").put("text", summary.toString()))
    frames.forEach { content.put(JSONObject().put("type", "image").put("mimeType", "image/jpeg").put("data", it.jpegBase64)) }
    return JSONObject().put("content", content).put("isError", false).put("structuredContent", summary)
  }

  /**
   * A resource that cannot be produced — no such event, no file on disk — is
   * `-32002`, as the specification and this repository's documentation say;
   * the lookups it shares with the tools carry their own code otherwise.
   */
  private fun readResource(uri: String): JSONObject =
    try {
      readResourceUnchecked(uri)
    } catch (e: McpException) {
      throw McpException(e.code, e.message ?: "Resource unavailable", McpRules.resourceRpcCode(e.code, e.rpcCode))
    }

  private fun readResourceUnchecked(uri: String): JSONObject {
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
    val bytes = mediaFile(path, maxBytes, eventId).readBytes()
    return android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
  }

  /** The recorded file behind `path`, checked: present, under `filesDir`, within `maxBytes`. */
  private fun mediaFile(path: String?, maxBytes: Long, eventId: String): File {
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
    return canonical
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
      429 -> "Too Many Requests"; 431 -> "Request Header Fields Too Large"; 503 -> "Service Unavailable"
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

  /** Bounds the next blocking read by what is left of the request's budget. */
  private fun budget(socket: Socket, deadline: McpRules.Deadline) {
    val left = deadline.remainingMs(System.currentTimeMillis())
    if (left <= 0) throw SocketTimeoutException("MCP request deadline exceeded")
    socket.soTimeout = minOf(left, SOCKET_TIMEOUT_MS.toLong()).toInt()
  }

  /** Reads a CRLF-terminated line without buffering past it. */
  private fun readLine(socket: Socket, input: InputStream, limit: Int, deadline: McpRules.Deadline): String? {
    budget(socket, deadline)
    val builder = StringBuilder()
    while (builder.length <= limit) {
      if (deadline.expired(System.currentTimeMillis())) throw SocketTimeoutException("MCP request deadline exceeded")
      val b = input.read()
      if (b == -1) return if (builder.isEmpty()) null else builder.toString()
      if (b == '\n'.code) return builder.toString().removeSuffix("\r")
      builder.append(b.toChar())
    }
    return null
  }

  private fun readBody(socket: Socket, input: InputStream, length: Int, deadline: McpRules.Deadline): String? {
    val buffer = ByteArray(length)
    var read = 0
    while (read < length) {
      budget(socket, deadline)
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
    /** Whole request line, headers and body; responses are not counted. */
    private const val REQUEST_DEADLINE_MS = 15_000L
    private const val MAX_CONNECTIONS = 8
    private const val COMMAND_EVENT = "McpCommand"
    private const val COMMAND_TIMEOUT_MS = 5_000L
    private const val REVOKED_EVENT = "McpControlRevoked"
    private const val REVOKED_OUTCOME = "{\"ok\":false,\"code\":\"NOVAGUARD_AUTH_FORBIDDEN\",\"message\":\"Control was revoked on the device\"}"
    private const val SERVICE_NAME = "NovaGuard"
    private const val SERVICE_TYPE = "_novaguard-mcp._tcp"
    private const val STOPPED_OUTCOME = "{\"ok\":false,\"code\":\"NOVAGUARD_DEVICE_UNAVAILABLE\",\"message\":\"Server stopped\"}"
    private const val MAX_CONNECTIONS_PER_PEER = 4
    private const val RATE_WINDOW_MS = 60_000L
    private const val MAX_REQUESTS_PER_WINDOW = 120
    private const val MAX_RATE_ENTRIES = 1_024
    private const val MAX_THUMBNAIL_BYTES = 2L * 1024 * 1024
    private const val MAX_VIDEO_BYTES = 20L * 1024 * 1024

    /**
     * Names this server refuses by name as well as by absence.
     *
     * Every one of them is already unreachable — no branch implements them —
     * so this list buys one thing: a caller that asks to delete a clip is
     * told it is forbidden rather than that the tool is unknown, and the day
     * someone adds a destructive path they collide with this set first.
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
      "NOVAGUARD_PERMISSION_REQUIRED",
    )

    private val FORBIDDEN_OPERATIONS = setOf(
      "arm_camera", "disarm_camera",
      "set_camera", "set_detection_threshold", "set_detection_zone",
      "set_recording_quality", "set_retention", "set_notification_settings",
      "delete_event", "delete_video", "clear_history", "change_stream_pin",
      "restart_camera", "update_configuration"
    )

    /** The live module, for the notification action; null once React has torn it down. */
    @Volatile private var current: WeakReference<McpServerModule>? = null

    fun revokeControlFromNotification() {
      current?.get()?.revokeControl()
    }

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
