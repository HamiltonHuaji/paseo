export interface HardwareKeyboardSubmitListenerPort {
  addListener(handler: () => void): { remove: () => void };
  addQueueListener(handler: () => void): { remove: () => void };
  setEnabled(enabled: boolean): void;
}

export interface HardwareKeyboardSubmitController {
  setOnSubmit(handler: () => void): void;
  setOnQueue(handler: () => void): void;
  enable(): void;
  disable(): void;
}

export function createHardwareKeyboardSubmitController(
  port: HardwareKeyboardSubmitListenerPort,
): HardwareKeyboardSubmitController {
  let subscriptions: Array<{ remove: () => void }> = [];
  let onSubmit: () => void = () => {};
  let onQueue: () => void = () => {};

  return {
    setOnSubmit(handler) {
      onSubmit = handler;
    },
    setOnQueue(handler) {
      onQueue = handler;
    },
    enable() {
      if (subscriptions.length > 0) return;
      subscriptions = [port.addListener(() => onSubmit()), port.addQueueListener(() => onQueue())];
      port.setEnabled(true);
    },
    disable() {
      if (subscriptions.length === 0) return;
      port.setEnabled(false);
      for (const subscription of subscriptions) subscription.remove();
      subscriptions = [];
    },
  };
}
