package sh.paseo.keyboard

import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.Window
import android.view.inputmethod.BaseInputConnection
import android.widget.EditText
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PaseoHardwareKeyboardModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var submitEnabled = false
  private var queueEnabled = false
  private var window: Window? = null
  private var callback: HardwareKeyboardCallback? = null

  override fun definition() = ModuleDefinition {
    Name("PaseoHardwareKeyboard")
    Events("onHardwareKeyboardSubmit", "onHardwareKeyboardQueue")
    Function("setHardwareKeyboardSubmitEnabled") { enabled: Boolean, queue: Boolean ->
      main.post {
        submitEnabled = enabled
        queueEnabled = enabled && queue
        if (enabled) attach() else detach()
      }
    }
    OnActivityEntersForeground { main.post { if (submitEnabled) attach() } }
    OnActivityEntersBackground { main.post { detach() } }
    OnActivityDestroys { main.post { detach() } }
    OnDestroy {
      main.post {
        submitEnabled = false
        queueEnabled = false
        detach()
      }
    }
  }

  private fun attach() {
    val activity = appContext.currentActivity ?: return
    val current = activity.window ?: return
    if (window === current && current.callback === callback) return
    detach()
    val previous = current.callback ?: return
    val handler = HardwareKeyboardCallback(previous) { event ->
      val input = activity.currentFocus as? EditText
      if (!submitEnabled || input == null || !input.isEnabled || !input.hasFocus()) null
      else resolveHardwareAction(
        event.keyCode, event.isCtrlPressed, event.isMetaPressed, event.isAltPressed,
        event.isShiftPressed,
        event.flags and KeyEvent.FLAG_SOFT_KEYBOARD != 0,
        BaseInputConnection.getComposingSpanStart(input.text) >= 0,
        queueEnabled,
      )
    }
    handler.emit = { action ->
      sendEvent(if (action == HardwareAction.SUBMIT) "onHardwareKeyboardSubmit" else "onHardwareKeyboardQueue")
    }
    window = current
    callback = handler
    current.callback = handler
  }

  private fun detach() {
    val handler = callback ?: return
    // Another feature may have installed its own wrapper since ours. Do not remove it.
    if (window?.callback === handler) window?.callback = handler.delegate
    handler.active = false
    callback = null
    window = null
  }
}

internal enum class HardwareAction { SUBMIT, QUEUE }

internal fun resolveHardwareAction(
  keyCode: Int,
  control: Boolean,
  command: Boolean,
  alt: Boolean,
  shift: Boolean,
  softwareKeyboard: Boolean,
  composing: Boolean,
  queueEnabled: Boolean,
): HardwareAction? {
  if (softwareKeyboard || composing || alt || shift) return null
  return when {
    (keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER) && (control || command) -> HardwareAction.SUBMIT
    keyCode == KeyEvent.KEYCODE_TAB && !control && !command && !shift && queueEnabled -> HardwareAction.QUEUE
    else -> null
  }
}

// Activity.onKeyDown runs after EditText and cannot stop its newline/focus handling.
// Intercept the window callback, forwarding every unrelated event unchanged.
internal class HardwareKeyboardCallback(
  val delegate: Window.Callback,
  private val resolve: (KeyEvent) -> HardwareAction?,
) : Window.Callback by delegate {
  var active = true
  var emit: (HardwareAction) -> Unit = {}
  private val pressed = mutableSetOf<Int>()

  private fun handle(event: KeyEvent): Boolean {
    if (!active) return false
    if (event.action == KeyEvent.ACTION_UP) return pressed.remove(event.keyCode)
    if (event.action != KeyEvent.ACTION_DOWN) return false
    if (pressed.contains(event.keyCode)) return true
    if (event.repeatCount != 0) return false
    val action = resolve(event) ?: return false
    pressed.add(event.keyCode)
    emit(action)
    return true
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean =
    handle(event) || delegate.dispatchKeyEvent(event)

  override fun dispatchKeyShortcutEvent(event: KeyEvent): Boolean =
    handle(event) || delegate.dispatchKeyShortcutEvent(event)
}
