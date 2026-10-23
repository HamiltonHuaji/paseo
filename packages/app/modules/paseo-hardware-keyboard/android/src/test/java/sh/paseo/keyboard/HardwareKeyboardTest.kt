package sh.paseo.keyboard

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HardwareKeyboardTest {
  private fun resolve(
    key: Int = KeyEvent.KEYCODE_ENTER, ctrl: Boolean = false, cmd: Boolean = false,
    alt: Boolean = false, shift: Boolean = false, soft: Boolean = false,
    composing: Boolean = false, running: Boolean = false,
  ) = resolveHardwareAction(key, ctrl, cmd, alt, shift, soft, composing, running)

  @Test fun enterRemainsMultilineAndModifiedEnterSubmits() {
    assertNull(resolve())
    assertEquals(HardwareAction.SUBMIT, resolve(ctrl = true))
    assertEquals(HardwareAction.SUBMIT, resolve(cmd = true))
    assertEquals(HardwareAction.SUBMIT, resolve(key = KeyEvent.KEYCODE_NUMPAD_ENTER, ctrl = true))
    assertNull(resolve(ctrl = true, shift = true))
    assertNull(resolve(ctrl = true, alt = true))
  }

  @Test fun tabQueuesOnlyWhenTheComposerCanQueue() {
    assertNull(resolve(key = KeyEvent.KEYCODE_TAB))
    assertEquals(HardwareAction.QUEUE, resolve(key = KeyEvent.KEYCODE_TAB, running = true))
    assertNull(resolve(key = KeyEvent.KEYCODE_TAB, running = true, shift = true))
    assertNull(resolve(key = KeyEvent.KEYCODE_TAB, running = true, ctrl = true))
    assertNull(resolve(key = KeyEvent.KEYCODE_TAB, running = true, cmd = true))
  }

  @Test fun imeCompositionAndSoftwareKeyboardNeverTriggerActions() {
    assertNull(resolve(ctrl = true, composing = true))
    assertNull(resolve(ctrl = true, soft = true))
    assertNull(resolve(key = KeyEvent.KEYCODE_TAB, running = true, composing = true))
    assertNull(resolve(key = KeyEvent.KEYCODE_TAB, running = true, soft = true))
  }
}
