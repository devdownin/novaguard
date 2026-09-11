package com.novaguard.surveillance

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
import java.util.concurrent.Executors

/**
 * Embedded HTTP server running on the device using standard Android ServerSocket API.
 * Provides local status and web viewer page on the local Wi-Fi network.
 */
class LocalStreamServerModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "LocalStreamServer"

  private var serverSocket: ServerSocket? = null
  private var threadPool = Executors.newCachedThreadPool()
  private var currentPort: Int = 8080
  @Volatile private var isServerRunning: Boolean = false

  @ReactMethod
  fun startServer(port: Int, promise: Promise) {
    try {
      if (isServerRunning) {
        stopServerInternal()
      }

      currentPort = if (port in 1024..65535) port else 8080
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

      Log.i(TAG, "Local HTTP Stream Server started on port $currentPort")

      val ip = getLocalIpAddress()
      val result = Arguments.createMap().apply {
        putBoolean("running", true)
        putInt("port", currentPort)
        putString("ipAddress", ip)
        putString("url", if (ip != null) "http://$ip:$currentPort" else null)
      }
      promise.resolve(result)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to start LocalStreamServer: ${e.message}", e)
      isServerRunning = false
      promise.reject("SERVER_ERROR", "Failed to start server: ${e.message}")
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
    }
    promise.resolve(status)
  }

  private fun stopServerInternal() {
    isServerRunning = false
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
      socket.use { s ->
        val reader = BufferedReader(InputStreamReader(s.getInputStream(), Charsets.UTF_8))
        val requestLine = reader.readLine() ?: return
        val tokens = requestLine.split(" ")
        val path = if (tokens.size >= 2) tokens[1] else "/"

        val output = s.getOutputStream()
        if (path.startsWith("/status")) {
          sendJsonResponse(output, """{"status":"ok","app":"NovaGuard","server":"running"}""")
        } else {
          sendHtmlResponse(output)
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "Client handle error: ${e.message}")
    }
  }

  private fun sendHtmlResponse(out: OutputStream) {
    val html = """
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>NovaGuard - Stream Local</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c0e15; color: #e9e9ed; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; min-height: 100vh; }
          .card { background: #181b26; border: 1px solid #2a2d3d; border-radius: 12px; padding: 24px; max-width: 600px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.5); text-align: center; }
          h1 { color: #9184d9; font-size: 24px; margin-top: 0; letter-spacing: 1px; }
          .badge { display: inline-block; background: #222533; border: 1px solid #9184d9; color: #c4bbf0; padding: 4px 12px; border-radius: 999px; font-size: 12px; margin-bottom: 20px; }
          .status-box { background: #10121a; border-radius: 8px; padding: 16px; margin-top: 16px; text-align: left; font-family: monospace; font-size: 13px; color: #a2a5b5; }
          .pulse { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #4caf50; margin-right: 6px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>NOVAGUARD</h1>
          <div class="badge"><span class="pulse"></span> Serveur Web Wi-Fi Local Active</div>
          <p>Le serveur web local NovaGuard est en cours d'exécution sur votre réseau Wi-Fi local.</p>
          <div class="status-box">
            <div>Port : $currentPort</div>
            <div>Statut : En écoute</div>
            <div>Accès : Réseau Wi-Fi Local</div>
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

    out.write(header.toByteArray(Charsets.UTF_8))
    out.write(bytes)
    out.flush()
  }

  private fun sendJsonResponse(out: OutputStream, json: String) {
    val bytes = json.toByteArray(Charsets.UTF_8)
    val header = "HTTP/1.1 200 OK\r\n" +
      "Content-Type: application/json\r\n" +
      "Content-Length: ${bytes.size}\r\n" +
      "Connection: close\r\n\r\n"

    out.write(header.toByteArray(Charsets.UTF_8))
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
