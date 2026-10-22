package sh.paseo.viewer

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.IOException
import java.net.BindException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import java.util.concurrent.RejectedExecutionException

class LoopbackViewerProxy(private val sendEvent: (String, Map<String, Any>) -> Boolean) {
  private val listeners = ConcurrentHashMap<String, ServerSocket>()
  private val requests = ConcurrentHashMap<String, Request>()
  private val sockets = ConcurrentHashMap<Socket, String>()
  private val workers = Executors.newCachedThreadPool()
  private val slots = Semaphore(64)
  @Volatile private var closed = false

  private class Request(val host: String, val socket: Socket, val head: Boolean) {
    val output = BufferedOutputStream(socket.getOutputStream())
    var headersSent = false
    var chunked = false
  }

  @Synchronized
  fun ensureListener(serverId: String, ports: List<Int>): Int {
    listeners[serverId]?.let { return it.localPort }
    check(!closed) { "Viewer proxy is closed" }
    require(serverId.isNotBlank() && ports.isNotEmpty())
    for (port in ports) {
      require(port == 0 || port in 1024..65535)
      val listener = ServerSocket()
      listener.reuseAddress = true
      try {
        listener.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port))
      } catch (error: BindException) {
        listener.close()
        // Permission and address failures are not port conflicts.
        if (error.message?.contains("EADDRINUSE") != true && error.message?.contains("Address already in use") != true) throw error
        continue
      } catch (error: IOException) {
        listener.close()
        throw error
      }
      listeners[serverId] = listener
      workers.execute { accept(serverId, listener) }
      return listener.localPort
    }
    throw IOException("No available viewer proxy port")
  }

  private fun accept(serverId: String, listener: ServerSocket) {
    while (!listener.isClosed) {
      val socket = try { listener.accept() } catch (_: IOException) { break }
      if (!slots.tryAcquire()) {
        socket.close()
        continue
      }
      sockets[socket] = serverId
      try {
        workers.execute {
          try { serve(serverId, socket) } finally {
            sockets.remove(socket)
            slots.release()
          }
        }
      } catch (_: RejectedExecutionException) {
        sockets.remove(socket)
        socket.close()
        slots.release()
      }
    }
  }

  private fun readLine(input: BufferedInputStream): String {
    val bytes = ArrayList<Byte>()
    while (bytes.size < 8192) {
      val byte = input.read()
      if (byte == -1) throw IOException("Browser disconnected")
      if (byte == 10) return bytes.toByteArray().toString(Charsets.ISO_8859_1).removeSuffix("\r")
      bytes.add(byte.toByte())
    }
    throw IOException("HTTP header exceeds limit")
  }

  private fun serve(serverId: String, socket: Socket) {
    var id: String? = null
    try {
      socket.soTimeout = 10_000
      val input = BufferedInputStream(socket.getInputStream())
      val start = readLine(input).split(" ")
      require(start.size == 3 && start[2].startsWith("HTTP/1."))
      val method = start[0]
      val path = start[1]
      val headers = mutableMapOf<String, String>()
      var headerBytes = 0
      while (true) {
        val line = readLine(input)
        if (line.isEmpty()) break
        headerBytes += line.length
        require(headerBytes <= 65536)
        val colon = line.indexOf(':')
        require(colon > 0)
        headers[line.substring(0, colon).lowercase()] = line.substring(colon + 1).trim()
      }
      socket.soTimeout = 0
      val request = Request(serverId, socket, method == "HEAD")
      val requestId = UUID.randomUUID().toString()
      id = requestId
      requests[requestId] = request
      if (method != "GET" && method != "HEAD") {
        headers(requestId, 405, mapOf("Allow" to "GET, HEAD", "Content-Length" to "0"))
        finish(requestId)
        return
      }
      if (path != "/" && !path.startsWith("/view/")) {
        headers(requestId, 404, mapOf("Content-Length" to "0"))
        finish(requestId)
        return
      }
      require(headers["transfer-encoding"] == null && (headers["content-length"] ?: "0") == "0")
      val delivered = sendEvent("onRequest", mapOf("id" to requestId, "serverId" to serverId, "method" to method, "path" to path, "headers" to headers))
      if (!delivered) { fail(requestId); return }
      // Observe browser cancellation even while daemon response headers are pending.
      // Closing the socket also releases this reader when the response completes.
      while (input.read() != -1) { /* The response advertises Connection: close. */ }
    } catch (_: IOException) {
      // Socket closure is the browser's cancellation boundary.
    } catch (_: IllegalArgumentException) {
      socket.getOutputStream().write("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
    } finally {
      if (id != null) {
        requests.remove(id)
        sendEvent("onCancel", mapOf("id" to id))
      }
      socket.close()
    }
  }

  fun headers(id: String, status: Int, headers: Map<String, String>) {
    val request = requests[id] ?: throw IOException("Browser disconnected")
    synchronized(request) {
      require(status in 200..599 && !request.headersSent)
      val output = StringBuilder("HTTP/1.1 $status Response\r\n")
      var contentLength: String? = null
      for ((name, value) in headers) {
        require(name.matches(Regex("[!#$%&'*+.^_`|~0-9A-Za-z-]+")) && !value.contains('\r') && !value.contains('\n'))
        if (name.lowercase() in setOf("connection", "transfer-encoding", "keep-alive")) continue
        if (name.equals("content-length", true)) contentLength = value
        output.append("$name: $value\r\n")
      }
      request.chunked = contentLength == null && !request.head && status != 204 && status != 304
      if (request.chunked) output.append("Transfer-Encoding: chunked\r\n")
      output.append("Connection: close\r\n\r\n")
      request.output.write(output.toString().toByteArray(Charsets.ISO_8859_1))
      request.output.flush()
      request.headersSent = true
    }
  }

  fun write(id: String, base64: String) {
    val request = requests[id] ?: throw IOException("Browser disconnected")
    val bytes = Base64.getDecoder().decode(base64)
    synchronized(request) {
      require(request.headersSent && !request.head)
      if (request.chunked) request.output.write("${bytes.size.toString(16)}\r\n".toByteArray())
      request.output.write(bytes)
      if (request.chunked) request.output.write("\r\n".toByteArray())
      request.output.flush()
    }
  }

  fun finish(id: String) {
    val request = requests.remove(id) ?: return
    synchronized(request) {
      try {
        if (request.chunked) request.output.write("0\r\n\r\n".toByteArray())
        request.output.flush()
      } finally { request.socket.close() }
    }
  }

  fun fail(id: String) {
    val request = requests[id] ?: return
    synchronized(request) {
      try {
        if (!request.headersSent) {
          val body = "Viewer is temporarily unavailable".toByteArray()
          headers(id, 502, mapOf("Content-Length" to body.size.toString(), "Cache-Control" to "no-store", "Content-Type" to "text/plain; charset=utf-8"))
          if (!request.head) request.output.write(body)
          request.output.flush()
        }
      } finally {
        request.socket.close()
        requests.remove(id)
      }
    }
  }

  @Synchronized
  fun removeListener(serverId: String) {
    listeners.remove(serverId)?.close()
    for ((socket, host) in sockets) {
      if (host == serverId) socket.close()
    }
    for ((id, request) in requests) {
      if (request.host == serverId) {
        requests.remove(id)
        request.socket.close()
      }
    }
  }

  val isEmpty: Boolean get() = listeners.isEmpty()

  @Synchronized
  fun close() {
    closed = true
    for (listener in listeners.values) listener.close()
    for (socket in sockets.keys) socket.close()
    listeners.clear()
    requests.clear()
    sockets.clear()
    workers.shutdownNow()
  }
}
