package sh.paseo.viewer

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
import java.util.concurrent.atomic.AtomicBoolean

/** One accepted TCP socket is one bridge stream. HTTP framing belongs to the daemon. */
class LoopbackViewerProxy(private val sendEvent: (String, Map<String, Any>) -> Boolean) {
  private val listeners = ConcurrentHashMap<String, ServerSocket>()
  private val streams = ConcurrentHashMap<String, Stream>()
  private val workers = Executors.newCachedThreadPool()
  private val slots = Semaphore(64)
  @Volatile private var closed = false

  private class Stream(val host: String, val socket: Socket) {
    val gate = Object()
    val released = AtomicBoolean(false)
    var readable = false
    @Volatile var inputEnded = false
    @Volatile var outputEnded = false
    @Volatile var readBytes = 0L
    @Volatile var writtenBytes = 0L
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
      try { listener.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port)) }
      catch (error: BindException) {
        listener.close()
        if (error.message?.contains("EADDRINUSE") != true && error.message?.contains("Address already in use") != true) throw error
        continue
      } catch (error: IOException) { listener.close(); throw error }
      listeners[serverId] = listener
      workers.execute { accept(serverId, listener) }
      return listener.localPort
    }
    throw IOException("No available viewer proxy port")
  }

  private fun emit(name: String, payload: Map<String, Any>): Boolean =
    try { sendEvent(name, payload) } catch (_: Exception) { false }

  private fun accept(serverId: String, listener: ServerSocket) {
    while (!listener.isClosed) {
      val socket = try { listener.accept() } catch (_: IOException) { break }
      if (!slots.tryAcquire()) { socket.close(); continue }
      socket.tcpNoDelay = true
      val id = UUID.randomUUID().toString()
      val stream = Stream(serverId, socket)
      val registered = synchronized(this) {
        if (closed || listeners[serverId] !== listener) false
        else { streams[id] = stream; true }
      }
      if (!registered) { socket.close(); slots.release(); continue }
      try { workers.execute { read(id, stream) } }
      catch (_: RejectedExecutionException) { reset(id) }
    }
  }

  private fun read(id: String, stream: Stream) {
    try {
      if (!emit("onOpen", mapOf("id" to id, "serverId" to stream.host))) { reset(id); return }
      val buffer = ByteArray(64 * 1024)
      val input = stream.socket.getInputStream()
      while (!stream.socket.isClosed) {
        synchronized(stream.gate) {
          while (!stream.readable && !stream.socket.isClosed) stream.gate.wait()
          stream.readable = false
        }
        if (stream.socket.isClosed) return
        val count = input.read(buffer)
        if (count == -1) {
          stream.inputEnded = true
          if (!emit("onEnd", mapOf("id" to id))) { reset(id); return }
          if (stream.outputEnded) release(id, stream)
          return
        }
        stream.readBytes += count
        // One outstanding bridge chunk; JS resumes only when the tunnel has send credit.
        val bytes = Base64.getEncoder().encodeToString(buffer.copyOf(count))
        if (!emit("onData", mapOf("id" to id, "base64" to bytes))) { reset(id); return }
      }
    } catch (_: IOException) { reset(id) }
    catch (_: InterruptedException) { Thread.currentThread().interrupt(); reset(id) }
  }

  fun resume(id: String) {
    val stream = streams[id] ?: return
    synchronized(stream.gate) { stream.readable = true; stream.gate.notifyAll() }
  }

  fun write(id: String, base64: String) {
    val stream = streams[id] ?: throw IOException("Viewer connection closed")
    val bytes = Base64.getDecoder().decode(base64)
    require(bytes.size <= 64 * 1024)
    if (stream.outputEnded) throw IOException("Viewer write after end")
    // JS serializes writes and awaits the actual socket write before returning tunnel credit.
    stream.socket.getOutputStream().write(bytes)
    stream.writtenBytes += bytes.size
  }

  fun end(id: String) {
    val stream = streams[id] ?: return
    if (stream.outputEnded) return
    stream.socket.shutdownOutput()
    stream.outputEnded = true
    if (stream.inputEnded) release(id, stream)
  }

  private fun release(id: String, stream: Stream) {
    if (!stream.released.compareAndSet(false, true)) return
    streams.remove(id, stream)
    stream.socket.close()
    synchronized(stream.gate) { stream.gate.notifyAll() }
    slots.release()
  }

  fun reset(id: String) {
    val stream = streams[id] ?: return
    try { stream.socket.setSoLinger(true, 0) } catch (_: IOException) { /* Already closed. */ }
    release(id, stream)
    emit("onReset", mapOf("id" to id))
  }

  fun state(): List<Map<String, Any>> = listeners.map { (serverId, listener) ->
    mapOf("serverId" to serverId, "target" to "service:viewers", "port" to listener.localPort,
      "streams" to streams.filterValues { it.host == serverId }.map { (id, stream) ->
        mapOf("id" to id, "readBytes" to stream.readBytes, "writtenBytes" to stream.writtenBytes,
          "inputEnded" to stream.inputEnded, "outputEnded" to stream.outputEnded)
      })
  }

  @Synchronized
  fun removeListener(serverId: String) {
    listeners.remove(serverId)?.close()
    for ((id, stream) in streams) if (stream.host == serverId) reset(id)
  }

  val isEmpty: Boolean get() = listeners.isEmpty()

  @Synchronized
  fun close() {
    closed = true
    for (listener in listeners.values) listener.close()
    listeners.clear()
    for (id in streams.keys) reset(id)
    workers.shutdownNow()
  }
}
