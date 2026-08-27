import type { EventSubscription } from "expo-modules-core";

type HardwareKeyboardSubmitHandler = () => void;
type HardwareKeyboardQueueHandler = () => void;

export function setHardwareKeyboardSubmitEnabled(_enabled: boolean) {}

export function addHardwareKeyboardSubmitListener(
  _handler: HardwareKeyboardSubmitHandler,
): EventSubscription {
  return {
    remove: () => {},
  };
}

export function addHardwareKeyboardQueueListener(
  _handler: HardwareKeyboardQueueHandler,
): EventSubscription {
  return {
    remove: () => {},
  };
}
