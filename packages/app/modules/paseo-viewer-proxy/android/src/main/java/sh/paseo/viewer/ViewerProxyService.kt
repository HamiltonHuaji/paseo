package sh.paseo.viewer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import kotlinx.coroutines.CompletableDeferred

class ViewerProxyService : HeadlessJsTaskService() {
  private var taskStarted = false
  private var disabled = false
  val proxy = LoopbackViewerProxy { name, payload ->
    val sink = eventSink
    if (sink == null) false else { sink(name, payload); true }
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(CHANNEL, "Viewer proxy", NotificationManager.IMPORTANCE_LOW))
    val stop = PendingIntent.getService(this, 0, Intent(this, ViewerProxyService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val notification = Notification.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_menu_view)
      .setContentTitle("Paseo viewer proxy")
      .setContentText("Remote viewers are available in your browser")
      .setOngoing(true)
      .addAction(Notification.Action.Builder(null, "Stop", stop).build())
    if (launch != null) notification.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE))
    startForeground(1, notification.build())
    ready.complete(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == STOP) {
      disabled = true
      stopSelf()
      return START_NOT_STICKY
    }
    if (!taskStarted) {
      taskStarted = true
      startTask(HeadlessJsTaskConfig("PaseoViewerProxy", Arguments.createMap(), 0, true))
    }
    return START_NOT_STICKY
  }

  fun removeListener(serverId: String) {
    proxy.removeListener(serverId)
    if (proxy.isEmpty) stopSelf()
  }

  override fun onDestroy() {
    proxy.close()
    instance = null
    ready = CompletableDeferred()
    eventSink?.invoke("onStopped", mapOf("disabled" to disabled))
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL = "paseo-viewer-proxy"
    private const val STOP = "sh.paseo.viewer.STOP"
    @Volatile var instance: ViewerProxyService? = null
    @Volatile var ready = CompletableDeferred<ViewerProxyService>()
    @Volatile var eventSink: ((String, Map<String, Any>) -> Unit)? = null
  }
}
