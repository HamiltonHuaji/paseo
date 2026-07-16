import { useEffect, type RefObject } from "react";
import type { View } from "react-native";
import { isWeb } from "@/constants/platform";
import { createHoverSafeZoneTracker, type RectLike } from "@/hooks/hover-safe-zone-tracker";

interface UseHoverSafeZoneParams {
  enabled: boolean;
  triggerRef: RefObject<View | null>;
  contentRef: RefObject<View | null>;
  retainOnContentSelection?: boolean;
  onEnterSafeZone: () => void;
  onLeaveSafeZone: () => void;
}

function readRect(ref: RefObject<View | null>): RectLike | null {
  const node = ref.current as unknown as Element | null;
  return node ? node.getBoundingClientRect() : null;
}

function hasContentSelection(ref: RefObject<View | null>): boolean {
  if (!isWeb || typeof window === "undefined") return false;
  const element = ref.current as unknown as Element | null;
  const selection = window.getSelection();
  if (!element || !selection || selection.isCollapsed || selection.rangeCount === 0) return false;

  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).intersectsNode(element)) return true;
  }
  return false;
}

export function useHoverSafeZone({
  enabled,
  triggerRef,
  contentRef,
  retainOnContentSelection = false,
  onEnterSafeZone,
  onLeaveSafeZone,
}: UseHoverSafeZoneParams): void {
  useEffect(() => {
    if (!isWeb || !enabled) return;

    const tracker = createHoverSafeZoneTracker({
      getTriggerRect: () => readRect(triggerRef),
      getContentRect: () => readRect(contentRef),
      shouldRetainAfterLeave: () => retainOnContentSelection && hasContentSelection(contentRef),
      onEnterSafeZone,
      onLeaveSafeZone,
    });

    function handlePointerMove(event: PointerEvent) {
      tracker.pointerMoved(event.clientX, event.clientY);
    }

    function handlePointerOut(event: PointerEvent) {
      if (event.relatedTarget === null) {
        tracker.pointerLeftWindow();
      }
    }

    function handleBlur() {
      tracker.windowBlurred();
    }

    function handleSelectionChange() {
      tracker.retentionChanged();
    }

    document.addEventListener("pointermove", handlePointerMove);
    if (retainOnContentSelection) {
      document.addEventListener("selectionchange", handleSelectionChange);
    }
    window.addEventListener("pointerout", handlePointerOut);
    window.addEventListener("blur", handleBlur);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      if (retainOnContentSelection) {
        document.removeEventListener("selectionchange", handleSelectionChange);
      }
      window.removeEventListener("pointerout", handlePointerOut);
      window.removeEventListener("blur", handleBlur);
    };
  }, [enabled, triggerRef, contentRef, retainOnContentSelection, onEnterSafeZone, onLeaveSafeZone]);
}
