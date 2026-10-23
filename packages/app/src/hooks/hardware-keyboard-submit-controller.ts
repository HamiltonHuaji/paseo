export interface HardwareKeyboardSubmitListenerPort {
  addListener(handler: () => void): { remove: () => void };
  addQueueListener(handler: () => void): { remove: () => void };
  setEnabled(enabled: boolean, queueEnabled: boolean): void;
}

export interface HardwareKeyboardSubmitController {
  setOnSubmit(handler: () => void): void;
  setOnQueue(handler: () => void): void;
  setQueueEnabled(enabled: boolean): void;
  enable(): void;
  disable(): void;
}

export function createHardwareKeyboardSubmitController(
  port: HardwareKeyboardSubmitListenerPort,
): HardwareKeyboardSubmitController {
  let subscriptions: Array<{ remove: () => void }> = [];
  let onSubmit: () => void = () => {};
  let queueEnabled = false;
  let onQueue: () => void = () => {};

  return {
    setOnSubmit(handler) {
      onSubmit = handler;
    },
    setOnQueue(handler) {
      onQueue = handler;
    },
    setQueueEnabled(enabled) {
      queueEnabled = enabled;
      if (subscriptions.length) port.setEnabled(true, queueEnabled);
    },
    enable() {
      if (subscriptions.length > 0) return;
      subscriptions = [
        port.addListener(() => onSubmit()),
        port.addQueueListener(() => {
          if (queueEnabled) onQueue();
        }),
      ];
      port.setEnabled(true, queueEnabled);
    },
    disable() {
      if (subscriptions.length === 0) return;
      port.setEnabled(false, false);
      for (const subscription of subscriptions) subscription.remove();
      subscriptions = [];
    },
  };
}
