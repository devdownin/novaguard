package com.novaguard.surveillance

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request as HttpRequest
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * The one place this app dials out: a WebSocket to the relay the owner chose.
 *
 * It exists only while the owner has switched cloud access on, and `docs/CONNEXION.md`
 * §14 says what that means for privacy. It carries requests the relay forwards to
 * the MCP server and the server's answers back; it opens no other connection and
 * sends nothing of its own accord. `__tests__/playRelease.test.ts` allows an
 * outgoing connection in this file and nowhere else.
 *
 * What it decides without Android — the address, the signed message, who to
 * retry — lives in `McpRelayRules`, which a bare JVM tests.
 */
class RelayRequest(val method: String, val path: String, val headers: Map<String, String>, val body: ByteArray)
class RelayReply(val status: Int, val headers: Map<String, String>, val body: ByteArray)

class McpRelayClient(
  private val base: String,
  private val handle: (RelayRequest) -> RelayReply,
  private val onState: (String) -> Unit,
) {
  @Volatile var state: String = STATE_CONNECTING
    private set
  @Volatile var publicUrl: String? = null
    private set

  @Volatile private var stopped = false
  @Volatile private var socket: WebSocket? = null
  @Volatile private var failures = 0

  private val http = OkHttpClient.Builder()
    .pingInterval(30, TimeUnit.SECONDS)
    .readTimeout(0, TimeUnit.MILLISECONDS)
    .build()
  private val timer = ScheduledThreadPoolExecutor(1).apply { removeOnCancelPolicy = true }
  // Bounded without a queue: a request the pool cannot start is answered 503 at once
  // instead of waiting behind `wait_for_event` calls that hold a thread for 25 s.
  private val workers = ThreadPoolExecutor(0, WORKERS, 30, TimeUnit.SECONDS, SynchronousQueue())

  fun start() = connect()

  fun stop() {
    stopped = true
    publicUrl = null
    try { socket?.close(1000, "off") } catch (_: Exception) {}
    socket = null
    timer.shutdownNow()
    workers.shutdownNow()
    http.dispatcher.executorService.shutdown()
    http.connectionPool.evictAll()
    set(STATE_OFF)
  }

  private fun set(next: String) {
    state = next
    onState(next)
  }

  private fun connect() {
    if (stopped) return
    set(STATE_CONNECTING)
    socket = http.newWebSocket(HttpRequest.Builder().url(McpRelayRules.connectUrl(base)).build(), Listener())
  }

  private fun retryOrStay(code: Int) {
    publicUrl = null
    if (stopped) return
    if (!McpRelayRules.shouldReconnect(code)) return set(STATE_REFUSED)
    set(STATE_OFFLINE)
    val delay = McpRelayRules.backoffMs(failures++)
    try { timer.schedule({ connect() }, delay, TimeUnit.MILLISECONDS) } catch (_: RejectedExecutionException) {}
  }

  private inner class Listener : WebSocketListener() {
    override fun onMessage(webSocket: WebSocket, text: String) {
      val frame = try { JSONObject(text) } catch (_: Exception) { return }
      when (frame.optString("t")) {
        "challenge" -> hello(webSocket, frame.optString("nonce"))
        "ready" -> {
          failures = 0
          publicUrl = McpRelayRules.publicUrl(base, frame.optString("id"))
          set(STATE_CONNECTED)
        }
        "req" -> serve(webSocket, frame)
      }
    }

    // OkHttp reports the relay's close frame here and waits for us to answer it;
    // `onClosed` — where the retry decision is made — only follows once we have.
    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
      webSocket.close(code, reason)
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = retryOrStay(code)

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
      Log.w(TAG, "Relay connection failed: ${t.javaClass.simpleName}")
      retryOrStay(1006)
    }
  }

  private fun hello(webSocket: WebSocket, nonce: String) {
    val key = McpRelayKey.privateKey()
    val signature = Signature.getInstance("SHA256withECDSA").run {
      initSign(key)
      update(McpRelayRules.signedMessage(nonce))
      sign()
    }
    val url64 = Base64.getUrlEncoder().withoutPadding()
    webSocket.send(
      JSONObject()
        .put("t", "hello")
        .put("key", url64.encodeToString(McpRelayKey.publicKeyDer()))
        .put("sig", url64.encodeToString(signature))
        .toString()
    )
  }

  private fun serve(webSocket: WebSocket, frame: JSONObject) {
    val id = frame.optString("id")
    fun answer(reply: RelayReply) {
      val body = if (reply.body.size > McpRelayRules.MAX_RESPONSE_BODY_BYTES) ByteArray(0) else reply.body
      val status = if (body !== reply.body) 502 else reply.status
      val headers = JSONObject().also { h -> reply.headers.forEach { (k, v) -> h.put(k, v) } }
      webSocket.send(
        JSONObject().put("t", "res").put("id", id).put("status", status).put("headers", headers)
          .put("body", Base64.getEncoder().encodeToString(body)).toString()
      )
    }
    try {
      workers.execute {
        try {
          answer(handle(parse(frame)))
        } catch (e: Exception) {
          Log.w(TAG, "Relay request failed: ${e.javaClass.simpleName}")
          answer(RelayReply(500, emptyMap(), ByteArray(0)))
        }
      }
    } catch (_: RejectedExecutionException) {
      answer(RelayReply(503, mapOf("retry-after" to "5"), ByteArray(0)))
    }
  }

  private fun parse(frame: JSONObject): RelayRequest {
    val headers = frame.optJSONObject("headers")
    val map = HashMap<String, String>()
    if (headers != null) for (name in headers.keys()) map[name.lowercase()] = headers.optString(name)
    return RelayRequest(
      frame.optString("method"),
      frame.optString("path"),
      map,
      Base64.getDecoder().decode(frame.optString("body", "")),
    )
  }

  companion object {
    private const val TAG = "NovaGuardRelay"
    private const val WORKERS = 4
    const val STATE_OFF = "off"
    const val STATE_CONNECTING = "connecting"
    const val STATE_CONNECTED = "connected"
    const val STATE_OFFLINE = "offline"
    const val STATE_REFUSED = "refused"
  }
}

/**
 * The phone's identity at the relay: a P-256 key made in the Android Keystore,
 * which never leaves it. Its public half names the phone (`McpRelayRules.deviceId`),
 * so switching the feature off and on keeps the address, and clearing the app's
 * data gives a new one.
 */
object McpRelayKey {
  private const val ALIAS = "novaguard_relay_key"
  private const val PROVIDER = "AndroidKeyStore"

  private fun store(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }

  private fun ensure() {
    val keys = store()
    if (keys.containsAlias(ALIAS)) return
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER).apply {
      initialize(
        KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
          .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
          .setDigests(KeyProperties.DIGEST_SHA256)
          .build()
      )
      generateKeyPair()
    }
  }

  fun privateKey(): PrivateKey {
    ensure()
    return store().getKey(ALIAS, null) as PrivateKey
  }

  /** X.509 SubjectPublicKeyInfo, the form `relay/src/protocol.js` hashes and verifies against. */
  fun publicKeyDer(): ByteArray {
    ensure()
    return store().getCertificate(ALIAS).publicKey.encoded
  }
}
