import { describe, expect, it } from "vitest";
import {
  createHardwareKeyboardSubmitController,
  type HardwareKeyboardSubmitListenerPort,
} from "./hardware-keyboard-submit-controller";

interface FakeKeyboard extends HardwareKeyboardSubmitListenerPort {
  emitSubmit(): void;
  emitQueue(): void;
  readonly isEnabled: boolean;
  readonly listenerCount: number;
}

function createFakeKeyboard(): FakeKeyboard {
  const submitHandlers = new Set<() => void>();
  const queueHandlers = new Set<() => void>();
  let enabled = false;
  return {
    addListener(handler) {
      submitHandlers.add(handler);
      return { remove: () => submitHandlers.delete(handler) };
    },
    addQueueListener(handler) {
      queueHandlers.add(handler);
      return { remove: () => queueHandlers.delete(handler) };
    },
    setEnabled(value) {
      enabled = value;
    },
    emitSubmit() {
      submitHandlers.forEach((handler) => handler());
    },
    emitQueue() {
      queueHandlers.forEach((handler) => handler());
    },
    get isEnabled() {
      return enabled;
    },
    get listenerCount() {
      return submitHandlers.size + queueHandlers.size;
    },
  };
}

describe("hardware-keyboard-submit-controller", () => {
  it("dispatches to onSubmit when the keyboard emits while enabled", () => {
    const keyboard = createFakeKeyboard();
    const controller = createHardwareKeyboardSubmitController(keyboard);
    let calls = 0;
    controller.setOnSubmit(() => {
      calls += 1;
    });
    controller.setOnQueue(() => {});

    controller.enable();
    keyboard.emitSubmit();

    expect(calls).toBe(1);
    expect(keyboard.isEnabled).toBe(true);
  });

  it("does not subscribe or enable when never enabled", () => {
    const keyboard = createFakeKeyboard();
    const controller = createHardwareKeyboardSubmitController(keyboard);
    let calls = 0;
    controller.setOnSubmit(() => {
      calls += 1;
    });

    keyboard.emitSubmit();

    expect(calls).toBe(0);
    expect(keyboard.listenerCount).toBe(0);
    expect(keyboard.isEnabled).toBe(false);
  });

  it("disables native hardware submit and unsubscribes on disable", () => {
    const keyboard = createFakeKeyboard();
    const controller = createHardwareKeyboardSubmitController(keyboard);
    controller.setOnSubmit(() => {});

    controller.enable();
    expect(keyboard.isEnabled).toBe(true);
    expect(keyboard.listenerCount).toBe(2);

    controller.disable();
    expect(keyboard.isEnabled).toBe(false);
    expect(keyboard.listenerCount).toBe(0);
  });

  it("dispatches the latest onSubmit handler", () => {
    const keyboard = createFakeKeyboard();
    const controller = createHardwareKeyboardSubmitController(keyboard);
    const received: string[] = [];
    controller.setOnSubmit(() => received.push("first"));
    controller.setOnQueue(() => {});

    controller.enable();
    controller.setOnSubmit(() => received.push("second"));
    keyboard.emitSubmit();

    expect(received).toEqual(["second"]);
  });

  it("does not dispatch after disable", () => {
    const keyboard = createFakeKeyboard();
    const controller = createHardwareKeyboardSubmitController(keyboard);
    let calls = 0;
    controller.setOnSubmit(() => {
      calls += 1;
    });

    controller.enable();
    controller.disable();
    keyboard.emitSubmit();

    expect(calls).toBe(0);
  });

  it("ignores repeated enable calls", () => {
    const keyboard = createFakeKeyboard();
    const controller = createHardwareKeyboardSubmitController(keyboard);
    let calls = 0;
    controller.setOnSubmit(() => {
      calls += 1;
    });

    controller.enable();
    controller.enable();
    keyboard.emitSubmit();

    expect(calls).toBe(1);
    expect(keyboard.listenerCount).toBe(2);
  });

  it("ignores disable without a prior enable", () => {
    const keyboard = createFakeKeyboard();
    const controller = createHardwareKeyboardSubmitController(keyboard);

    controller.disable();

    expect(keyboard.isEnabled).toBe(false);
  });

  it("dispatches queue separately from submit", () => {
    const keyboard = createFakeKeyboard();
    const controller = createHardwareKeyboardSubmitController(keyboard);
    const received: string[] = [];
    controller.setOnSubmit(() => received.push("submit"));
    controller.setOnQueue(() => received.push("queue"));

    controller.enable();
    keyboard.emitQueue();
    keyboard.emitSubmit();

    expect(received).toEqual(["queue", "submit"]);
  });
});
