import { useEffect } from "react";
import { CANVAS_ZOOM_STEP, canvasWheelDelta, zoomCamera } from "./camera";
import type { CanvasInputOptions } from "./input";

export function useCanvasInput({
  active,
  viewportRef,
  cameraRef,
  updateCamera,
  onZoom,
  onFit,
  onFocus,
}: CanvasInputOptions): void {
  useEffect(() => {
    if (!active) return;
    const element = viewportRef.current as unknown as HTMLElement | null;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      // Changing scale during a drag would move the card away from its pointer.
      if (event.buttons) return;
      const rect = element.getBoundingClientRect();
      const delta = canvasWheelDelta(event, rect.height);
      const current = cameraRef.current;
      if (event.ctrlKey || event.metaKey) {
        updateCamera(
          zoomCamera(current, current.zoom * Math.exp(-delta.y * 0.002), {
            x: event.clientX - rect.left - element.clientLeft,
            y: event.clientY - rect.top - element.clientTop,
          }),
        );
      } else {
        updateCamera({
          ...current,
          x: current.x - (event.shiftKey && delta.x === 0 ? delta.y : delta.x),
          y: current.y - (event.shiftKey && delta.x === 0 ? 0 : delta.y),
        });
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditing(event.target)) return;
      const action = keyboardAction(event);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "fit") onFit();
      else if (action === "focus") onFocus();
      else if (action === "reset") onZoom(1);
      else
        onZoom(
          cameraRef.current.zoom * (action === "in" ? CANVAS_ZOOM_STEP : 1 / CANVAS_ZOOM_STEP),
        );
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    element.addEventListener("keydown", handleKeyDown);
    return () => {
      element.removeEventListener("wheel", handleWheel);
      element.removeEventListener("keydown", handleKeyDown);
    };
  }, [active, viewportRef, cameraRef, updateCamera, onZoom, onFit, onFocus]);
}

function isEditing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || !!target.closest("input, textarea, select, [role='textbox']"))
  );
}

function keyboardAction(event: KeyboardEvent): "in" | "out" | "reset" | "fit" | "focus" | null {
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey) {
    if (event.key === "+" || event.key === "=") return "in";
    if (event.key === "-") return "out";
    if (event.key === "0") return "reset";
  } else if (event.shiftKey) {
    if (event.code === "Digit1") return "fit";
    if (event.code === "Digit2") return "focus";
  }
  return null;
}
