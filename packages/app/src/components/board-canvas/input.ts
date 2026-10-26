import type { RefObject } from "react";
import type { View } from "react-native";
import type { CanvasCamera } from "./camera";

export interface CanvasInputOptions {
  active: boolean;
  viewportRef: RefObject<View | null>;
  cameraRef: RefObject<CanvasCamera>;
  updateCamera: (camera: CanvasCamera) => void;
  onZoom: (zoom: number) => void;
  onFit: () => void;
  onFocus: () => void;
}

// Native pan gestures and the shared toolbar are handled by BoardCanvas.
export function useCanvasInput(_options: CanvasInputOptions): void {}
