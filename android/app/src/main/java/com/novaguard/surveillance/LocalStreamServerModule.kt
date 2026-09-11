package com.novaguard.surveillance

import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

/**
 * Embedded HTTP server running on the device using standard Android ServerSocket API.
 * Provides MJPEG stream (/stream.mjpeg), JPEG snapshot (/snapshot.jpg), status (/status),
 * web UI (/), and PIN authentication.
 */
class LocalStreamServerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "LocalStreamServer"

  private var serverSocket: ServerSocket? = null
  private var threadPool = Executors.newCachedThreadPool()
  private var currentPort: Int = 8080
  private var streamPin: String = ""
  @Volatile private var isServerRunning: Boolean = false

  @Volatile private var latestFrameJpeg: ByteArray? = null
  private val activeStreamClients = CopyOnWriteArrayList<OutputStream>()

  @ReactMethod
  fun startServer(port: Int, pin: String?, promise: Promise) {
    try {
      if (isServerRunning) {
        stopServerInternal()
      }

      currentPort = if (port in 1024..65535) port else 8080
      streamPin = pin?.trim() ?: ""

      serverSocket = ServerSocket().apply {
        reuseAddress = true
        bind(InetSocketAddress(currentPort))
      }

      isServerRunning = true
      if (threadPool.isShutdown) {
        threadPool = Executors.newCachedThreadPool()
      }

      threadPool.execute {
        listenForConnections()
      }

      Log.i(TAG, "Local HTTP Stream Server started on port $currentPort (PIN protection: ${streamPin.isNotEmpty()})")

      val ip = getLocalIpAddress()
      val result = Arguments.createMap().apply {
        putBoolean("running", true)
        putInt("port", currentPort)
        putString("ipAddress", ip)
        putString("url", if (ip != null) "http://$ip:$currentPort" else null)
        putBoolean("hasPin", streamPin.isNotEmpty())
      }
      promise.resolve(result)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to start LocalStreamServer: ${e.message}", e)
      isServerRunning = false
      promise.reject("SERVER_ERROR", "Failed to start server: ${e.message}")
    }
  }

  @ReactMethod
  fun updateFrameBase64(base64Jpeg: String) {
    if (!isServerRunning) return
    try {
      val bytes = Base64.decode(base64Jpeg, Base64.DEFAULT)
      latestFrameJpeg = bytes

      if (activeStreamClients.isNotEmpty()) {
        broadcastFrameToClients(bytes)
      }
    } catch (e: Exception) {
      Log.w(TAG, "Error updating frame: ${e.message}")
    }
  }

  @ReactMethod
  fun stopServer(promise: Promise) {
    try {
      stopServerInternal()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SERVER_ERROR", "Failed to stop server: ${e.message}")
    }
  }

  @ReactMethod
  fun getServerStatus(promise: Promise) {
    val ip = getLocalIpAddress()
    val status: WritableMap = Arguments.createMap().apply {
      putBoolean("running", isServerRunning)
      putInt("port", currentPort)
      putString("ipAddress", ip)
      putString("url", if (isServerRunning && ip != null) "http://$ip:$currentPort" else null)
      putBoolean("hasPin", streamPin.isNotEmpty())
      putInt("activeClients", activeStreamClients.size)
    }
    promise.resolve(status)
  }

  private fun stopServerInternal() {
    isServerRunning = false
    activeStreamClients.clear()
    latestFrameJpeg = null
    try {
      serverSocket?.close()
    } catch (e: Exception) {
      Log.w(TAG, "Error closing server socket: ${e.message}")
    }
    serverSocket = null
    Log.i(TAG, "Local HTTP Stream Server stopped")
  }

  private fun listenForConnections() {
    while (isServerRunning) {
      try {
        val socket = serverSocket?.accept() ?: break
        threadPool.execute {
          handleClient(socket)
        }
      } catch (e: Exception) {
        if (!isServerRunning) break
        Log.w(TAG, "Socket accept error: ${e.message}")
      }
    }
  }

  private fun handleClient(socket: Socket) {
    try {
      val reader = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
      val requestLine = reader.readLine() ?: return
      val tokens = requestLine.split(" ")
      val method = if (tokens.isNotEmpty()) tokens[0] else "GET"
      var path = if (tokens.size >= 2) tokens[1] else "/"

      var authorized = streamPin.isEmpty()
      var authHeader = ""

      var line: String?
      while (reader.readLine().also { line = it } != null) {
        if (line.isNull_or_empty()) break
        if (line!!.startsWith("Authorization:", ignoreCase = true)) {
          authHeader = line!!.substring(14).trim()
        }
      }

      if (streamPin.isNotEmpty()) {
        if (path.contains("pin=$streamPin")) {
          authorized = true
        } else if (authHeader.startsWith("Basic ", ignoreCase = true)) {
          try {
            val decoded = String(Base64.decode(authHeader.substring(6), Base64.DEFAULT), Charsets.UTF_8)
            val parts = decoded.split(":")
            if (parts.size >= 2 && parts[1] == streamPin) {
              authorized = true
            }
          } catch (_: Exception) {}
        }
      }

      val output = socket.getOutputStream()

      if (!authorized) {
        sendUnauthorizedResponse(output)
        socket.close()
        return
      }

      if (path.contains("?")) {
        path = path.substring(0, path.indexOf("?"))
      }

      when {
        path == "/stream.mjpeg" -> handleMjpegStream(socket, output)
        path == "/snapshot.jpg" -> handleSnapshot(output)
        path.startsWith("/status") -> sendJsonResponse(output, """{"status":"ok","app":"NovaGuard","server":"running","activeClients":${activeStreamClients.size}}""")
        else -> sendHtmlResponse(output)
      }

    } catch (e: Exception) {
      Log.w(TAG, "Client handle error: ${e.message}")
    } finally {
      try {
        if (!socket.isClosed) {
          socket.close()
        }
      } catch (_: Exception) {}
    }
  }

  private fun handleSnapshot(out: OutputStream) {
    val frame = latestFrameJpeg
    if (frame == null) {
      val errorMsg = "No frame available".toByteArray()
      val header = "HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\nContent-Length: ${errorMsg.size}\r\n\r\n"
      out.write(header.toByteArray())
      out.write(errorMsg)
      out.flush()
      return
    }

    val header = "HTTP/1.1 200 OK\r\n" +
      "Content-Type: image/jpeg\r\n" +
      "Content-Length: ${frame.size}\r\n" +
      "Cache-Control: no-cache, no-store, must-revalidate\r\n" +
      "Connection: close\r\n\r\n"

    out.write(header.toByteArray())
    out.write(frame)
    out.flush()
  }

  private fun handleMjpegStream(socket: Socket, out: OutputStream) {
    val header = "HTTP/1.1 200 OK\r\n" +
      "Content-Type: multipart/x-mixed-replace; boundary=--jpgboundary\r\n" +
      "Cache-Control: no-cache, no-store, must-revalidate\r\n" +
      "Pragma: no-cache\r\n" +
      "Connection: close\r\n\r\n"

    out.write(header.toByteArray())
    out.flush()

    activeStreamClients.add(out)

    // Write current frame immediately if available
    latestFrameJpeg?.let { frame ->
      try {
        writeJpegFrame(out, frame)
      } catch (_: Exception) {
        activeStreamClients.remove(out)
      }
    }

    // Keep stream socket open; worker loop / updateFrameBase64 broadcasts to `activeStreamClients`
    while (isServerRunning && !socket.isClosed && activeStreamClients.contains(out)) {
      try {
        Thread.sleep(500)
      } catch (_: InterruptedException) {
        break
      }
    }
    activeStreamClients.remove(out)
  }

  private fun broadcastFrameToClients(jpegBytes: ByteArray) {
    val deadClients = mutableListOf<OutputStream>()
    for (client in activeStreamClients) {
      try {
        writeJpegFrame(client, jpegBytes)
      } catch (e: Exception) {
        deadClients.add(client)
      }
    }
    if (deadClients.isNotEmpty()) {
      activeStreamClients.removeAll(deadClients)
    }
  }

  private fun writeJpegFrame(out: OutputStream, jpegBytes: ByteArray) {
    val boundary = "--jpgboundary\r\n" +
      "Content-Type: image/jpeg\r\n" +
      "Content-Length: ${jpegBytes.size}\r\n\r\n"
    out.write(boundary.toByteArray())
    out.write(jpegBytes)
    out.write("\r\n".toByteArray())
    out.flush()
  }

  private fun sendUnauthorizedResponse(out: OutputStream) {
    val body = "401 Unauthorized - PIN Required".toByteArray()
    val header = "HTTP/1.1 401 Unauthorized\r\n" +
      "WWW-Authenticate: Basic realm=\"NovaGuard Stream\"\r\n" +
      "Content-Type: text/plain\r\n" +
      "Content-Length: ${body.size}\r\n" +
      "Connection: close\r\n\r\n"
    out.write(header.toByteArray())
    out.write(body)
    out.flush()
  }

  private fun sendHtmlResponse(out: OutputStream) {
    val pinQuery = if (streamPin.isNotEmpty()) "?pin=$streamPin" else ""
    val html = """
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>NovaGuard - Direct Wi-Fi Local</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c0e15; color: #e9e9ed; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; min-height: 100vh; }
          .card { background: #181b26; border: 1px solid #2a2d3d; border-radius: 14px; padding: 20px; max-width: 720px; width: 100%; box-shadow: 0 8px 30px rgba(0,0,0,0.6); text-align: center; }
          h1 { color: #9184d9; font-size: 22px; margin-top: 0; letter-spacing: 1.5px; }
          .badge { display: inline-block; background: #222533; border: 1px solid #9184d9; color: #c4bbf0; padding: 4px 12px; border-radius: 999px; font-size: 12px; margin-bottom: 16px; }
          .stream-container { position: relative; width: 100%; background: #000; border-radius: 10px; overflow: hidden; min-height: 240px; display: flex; align-items: center; justify-content: center; }
          .stream-img { width: 100%; height: auto; max-height: 480px; object-fit: contain; display: block; }
          .controls { display: flex; gap: 10px; justify-content: center; margin-top: 16px; }
          .btn { background: #282c3d; color: #e9e9ed; border: 1px solid #3d4257; padding: 8px 16px; border-radius: 8px; cursor: pointer; text-decoration: none; font-size: 13px; font-weight: 500; }
          .btn:hover { background: #34394a; }
          .status-box { background: #10121a; border-radius: 8px; padding: 12px; margin-top: 16px; text-align: left; font-family: monospace; font-size: 12px; color: #a2a5b5; display: flex; justify-content: space-between; }
          .pulse { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #4caf50; margin-right: 6px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>NOVAGUARD</h1>
          <div class="badge"><span class="pulse"></span> Diffusion locale Wi-Fi active</div>

          <div class="stream-container">
            <img class="stream-img" src="/stream.mjpeg$pinQuery" alt="Flux Vidéo Direct" onerror="this.onerror=null;this.src='/snapshot.jpg$pinQuery';" />
          </div>

          <div class="controls">
            <a class="btn" href="/snapshot.jpg$pinQuery" target="_blank">Capturer une photo</a>
            <a class="btn" href="/stream.mjpeg$pinQuery" target="_blank">Ouvrir flux brut MJPEG</a>
            <a class="btn" href="/status$pinQuery" target="_blank">Statut JSON</a>
          </div>

          <div class="status-box">
            <span>Port : $currentPort</span>
            <span>Sécurité : ${if (streamPin.isNotEmpty()) "PIN Actif" else "Ouvert"}</span>
            <span>Flux : Live MJPEG</span>
          </div>
        </div>
      </body>
      </html>
    """.trimIndent()

    val bytes = html.toByteArray(Charsets.UTF_8)
    val header = "HTTP/1.1 200 OK\r\n" +
      "Content-Type: text/html; charset=utf-8\r\n" +
      "Content-Length: ${bytes.size}\r\n" +
      "Connection: close\r\n\r\n"

    out.write(header.toByteArray())
    out.write(bytes)
    out.flush()
  }

  private fun sendJsonResponse(out: OutputStream, json: String) {
    val bytes = json.toByteArray(Charsets.UTF_8)
    val header = "HTTP/1.1 200 OK\r\n" +
      "Content-Type: application/json\r\n" +
      "Content-Length: ${bytes.size}\r\n" +
      "Connection: close\r\n\r\n"

    out.write(header.toByteArray())
    out.write(bytes)
    out.flush()
  }

  private fun getLocalIpAddress(): String? {
    try {
      val interfaces = NetworkInterface.getNetworkInterfaces()
      while (interfaces.hasMoreElements()) {
        val networkInterface = interfaces.nextElement()
        if (networkInterface.isLoopback || !networkInterface.isUp) continue

        val addresses = networkInterface.inetAddresses
        while (addresses.hasMoreElements()) {
          val addr = addresses.nextElement()
          if (!addr.isLoopbackAddress && addr is Inet4Address) {
            val ip = addr.hostAddress
            if (ip != null && !ip.startsWith("127.")) {
              return ip
            }
          }
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Error resolving IP address: ${e.message}")
    }
    return null
  }

  companion object {
    private const val TAG = "LocalStreamServer"
  }
}

private fun String?.isNull_or_empty(): Boolean = this == null || this.trim().isEmpty()
