import { useEffect, useRef } from "react";
import {
  addHardwareKeyboardQueueListener,
  addHardwareKeyboardSubmitListener,
  setHardwareKeyboardSubmitEnabled,
} from "@/native/hardware-keyboard-submit";
import {
  createHardwareKeyboardSubmitController,
  type HardwareKeyboardSubmitController,
} from "./hardware-keyboard-submit-controller";

interface UseHardwareKeyboardSubmitInput {
  isEnabled: boolean;
  queueEnabled: boolean;
  onSubmit: () => void;
  onQueue: () => void;
}

export function useHardwareKeyboardSubmit(input: UseHardwareKeyboardSubmitInput) {
  const controllerRef = useRef<HardwareKeyboardSubmitController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createHardwareKeyboardSubmitController({
      addListener: addHardwareKeyboardSubmitListener,
      addQueueListener: addHardwareKeyboardQueueListener,
      setEnabled: setHardwareKeyboardSubmitEnabled,
    });
  }
  const controller = controllerRef.current;

  controller.setOnSubmit(() => {
    if (input.isEnabled) input.onSubmit();
  });
  controller.setOnQueue(() => {
    if (input.isEnabled && input.queueEnabled) input.onQueue();
  });

  useEffect(() => {
    if (!input.isEnabled) {
      return;
    }
    controller.setQueueEnabled(input.queueEnabled);
    controller.enable();
    return () => controller.disable();
  }, [controller, input.isEnabled, input.queueEnabled]);
}
