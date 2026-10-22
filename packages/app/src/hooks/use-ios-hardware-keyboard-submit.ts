import { useEffect, useRef } from "react";
import {
  addHardwareKeyboardQueueListener,
  addHardwareKeyboardSubmitListener,
  setHardwareKeyboardSubmitEnabled,
} from "@/native/ios-hardware-keyboard-submit";
import {
  createHardwareKeyboardSubmitController,
  type HardwareKeyboardSubmitController,
} from "./hardware-keyboard-submit-controller";

interface UseIosHardwareKeyboardSubmitInput {
  isEnabled: boolean;
  onSubmit: () => void;
  onQueue: () => void;
}

export function useIosHardwareKeyboardSubmit(input: UseIosHardwareKeyboardSubmitInput) {
  const controllerRef = useRef<HardwareKeyboardSubmitController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createHardwareKeyboardSubmitController({
      addListener: addHardwareKeyboardSubmitListener,
      addQueueListener: addHardwareKeyboardQueueListener,
      setEnabled: setHardwareKeyboardSubmitEnabled,
    });
  }
  const controller = controllerRef.current;

  controller.setOnSubmit(input.onSubmit);
  controller.setOnQueue(input.onQueue);

  useEffect(() => {
    if (!input.isEnabled) {
      return;
    }
    controller.enable();
    return () => controller.disable();
  }, [controller, input.isEnabled]);
}
