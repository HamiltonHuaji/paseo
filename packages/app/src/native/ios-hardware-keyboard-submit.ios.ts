import { requireNativeModule, type EventSubscription } from "expo-modules-core";

type HardwareKeyboardSubmitHandler = () => void;
type HardwareKeyboardQueueHandler = () => void;

interface PaseoHardwareKeyboardModule {
  setHardwareKeyboardSubmitEnabled(enabled: boolean): void;
  addListener(
    eventName: "onHardwareKeyboardSubmit" | "onHardwareKeyboardQueue",
    handler: HardwareKeyboardSubmitHandler | HardwareKeyboardQueueHandler,
  ): EventSubscription;
}

const module = requireNativeModule<PaseoHardwareKeyboardModule>("PaseoHardwareKeyboard");

export function setHardwareKeyboardSubmitEnabled(enabled: boolean) {
  module.setHardwareKeyboardSubmitEnabled(enabled);
}

export function addHardwareKeyboardSubmitListener(handler: HardwareKeyboardSubmitHandler) {
  return module.addListener("onHardwareKeyboardSubmit", handler);
}

export function addHardwareKeyboardQueueListener(handler: HardwareKeyboardQueueHandler) {
  return module.addListener("onHardwareKeyboardQueue", handler);
}
