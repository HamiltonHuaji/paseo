// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import type { View } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHoverSafeZone } from "@/hooks/use-hover-safe-zone";

vi.mock("@/constants/platform", () => ({ isWeb: true }));

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function viewRef(element: HTMLElement): RefObject<View | null> {
  return { current: element as unknown as View };
}

describe("useHoverSafeZone", () => {
  it("retains selected content outside the safe zone and removes its listener on cleanup", () => {
    const trigger = document.createElement("div");
    const content = document.createElement("div");
    const path = document.createTextNode("packages/app/src/assistant-file-links/link.tsx");
    content.appendChild(path);
    document.body.append(trigger, content);

    trigger.getBoundingClientRect = () => ({ left: 0, right: 100, top: 20, bottom: 60 }) as DOMRect;
    content.getBoundingClientRect = () =>
      ({ left: 120, right: 240, top: 20, bottom: 120 }) as DOMRect;

    const range = document.createRange();
    range.selectNodeContents(content);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    const onEnterSafeZone = vi.fn();
    const onLeaveSafeZone = vi.fn();
    const { unmount } = renderHook(() =>
      useHoverSafeZone({
        enabled: true,
        triggerRef: viewRef(trigger),
        contentRef: viewRef(content),
        retainOnContentSelection: true,
        onEnterSafeZone,
        onLeaveSafeZone,
      }),
    );

    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 40 }));
    expect(onEnterSafeZone).toHaveBeenCalledTimes(1);
    expect(onLeaveSafeZone).not.toHaveBeenCalled();

    selection?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(onLeaveSafeZone).toHaveBeenCalledTimes(1);

    expect(addEventListener.mock.calls.some(([type]) => type === "selectionchange")).toBe(true);
    unmount();
    expect(removeEventListener.mock.calls.some(([type]) => type === "selectionchange")).toBe(true);
  });
});
