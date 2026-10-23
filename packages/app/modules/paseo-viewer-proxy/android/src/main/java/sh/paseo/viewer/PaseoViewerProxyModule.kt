package sh.paseo.viewer

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

class PaseoViewerProxyModule : Module() {
  private val sink: (String, Map<String, Any>) -> Unit = { name, payload -> sendEvent(name, payload) }
  override fun definition() = ModuleDefinition {
    Name("PaseoViewerProxy")
    Events("onRequest", "onCancel", "onStopped")

    OnCreate {
      ViewerProxyService.eventSink = sink
    }
    OnDestroy {
      if (ViewerProxyService.eventSink === sink) {
        ViewerProxyService.eventSink = null
        appContext.reactContext?.stopService(Intent(appContext.reactContext, ViewerProxyService::class.java))
      }
    }

    AsyncFunction("ensureListener") Coroutine { serverId: String, ports: List<Int> ->
      val context = requireNotNull(appContext.reactContext)
      withContext(Dispatchers.Main) {
        context.startForegroundService(Intent(context, ViewerProxyService::class.java))
      }
      val service = withTimeout(10_000) { ViewerProxyService.ready.await() }
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
    AsyncFunction("headers") Coroutine { id: String, status: Int, headers: Map<String, String> ->
      withContext(Dispatchers.IO) { requireNotNull(ViewerProxyService.instance).proxy.headers(id, status, headers) }
    }
    AsyncFunction("getServiceId") { ViewerProxyService.instance?.serviceId }
    AsyncFunction("write") Coroutine { id: String, base64: String ->
      withContext(Dispatchers.IO) { requireNotNull(ViewerProxyService.instance).proxy.write(id, base64) }
    }
    AsyncFunction("finish") Coroutine { id: String ->
      withContext(Dispatchers.IO) { ViewerProxyService.instance?.proxy?.finish(id) }
    }
    AsyncFunction("fail") Coroutine { id: String ->
      withContext(Dispatchers.IO) { ViewerProxyService.instance?.proxy?.fail(id) }
    }
  }
}
