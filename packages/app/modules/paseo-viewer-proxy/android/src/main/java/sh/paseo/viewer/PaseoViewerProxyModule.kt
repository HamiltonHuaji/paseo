package sh.paseo.viewer

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class PaseoViewerProxyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PaseoViewerProxy")
    Events("onOpen", "onData", "onEnd", "onReset", "onStopped")

    OnCreate {
      ViewerProxyService.eventSink = { name, payload -> sendEvent(name, payload) }
    }
    OnDestroy {
      ViewerProxyService.eventSink = null
      appContext.reactContext?.stopService(Intent(appContext.reactContext, ViewerProxyService::class.java))
    }

    AsyncFunction("ensureListener") Coroutine { serverId: String, ports: List<Int> ->
      val context = requireNotNull(appContext.reactContext)
      withContext(Dispatchers.Main) {
        context.startForegroundService(Intent(context, ViewerProxyService::class.java))
      }
      val service = ViewerProxyService.ready.await()
      withContext(Dispatchers.IO) {
        try { service.proxy.ensureListener(serverId, ports) }
        catch (error: Exception) {
          if (service.proxy.isEmpty) service.stopSelf()
          throw error
        }
      }
    }
    AsyncFunction("removeListener") Coroutine { serverId: String ->
      withContext(Dispatchers.IO) { ViewerProxyService.instance?.removeListener(serverId) }
    }
    AsyncFunction("resume") Coroutine { id: String ->
      withContext(Dispatchers.IO) { ViewerProxyService.instance?.proxy?.resume(id) }
    }
    AsyncFunction("getState") Coroutine { ->
      withContext(Dispatchers.IO) { ViewerProxyService.instance?.proxy?.state() ?: emptyList() }
    }
    AsyncFunction("write") Coroutine { id: String, base64: String ->
      withContext(Dispatchers.IO) { requireNotNull(ViewerProxyService.instance).proxy.write(id, base64) }
    }
    AsyncFunction("end") Coroutine { id: String ->
      withContext(Dispatchers.IO) { ViewerProxyService.instance?.proxy?.end(id) }
    }
    AsyncFunction("reset") Coroutine { id: String ->
      withContext(Dispatchers.IO) { ViewerProxyService.instance?.proxy?.reset(id) }
    }
  }
}
