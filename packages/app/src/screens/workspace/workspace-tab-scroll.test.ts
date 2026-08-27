import { describe, expect, it, vi } from "vitest";
import {
  getWorkspaceTabRevealOffset,
  resolveWorkspaceTabWheelDelta,
  scrollWorkspaceTabsWithWheel,
} from "@/screens/workspace/workspace-tab-scroll";

describe("workspace tab horizontal scrolling", () => {
  it("uses ordinary vertical wheel input for horizontal scrolling", () => {
    const preventDefault = vi.fn();
    const target = { clientWidth: 300, scrollWidth: 900, scrollLeft: 100 };

    expect(
      scrollWorkspaceTabsWithWheel(target, {
        deltaX: 0,
        deltaY: 40,
        deltaMode: 0,
        ctrlKey: false,
        defaultPrevented: false,
        preventDefault,
      }),
    ).toBe(true);
    expect(target.scrollLeft).toBe(140);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("prefers the dominant horizontal side-wheel delta", () => {
    expect(resolveWorkspaceTabWheelDelta({ deltaX: -60, deltaY: 10, deltaMode: 0 }, 300)).toBe(-60);
  });

  it("normalizes line and page wheel modes", () => {
    expect(resolveWorkspaceTabWheelDelta({ deltaX: 0, deltaY: 2, deltaMode: 1 }, 300)).toBe(32);
    expect(resolveWorkspaceTabWheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 300)).toBe(300);
  });

  it("does not consume wheel input at the scroll boundary", () => {
    const preventDefault = vi.fn();
    const target = { clientWidth: 300, scrollWidth: 900, scrollLeft: 600 };

    expect(
      scrollWorkspaceTabsWithWheel(target, {
        deltaX: 0,
        deltaY: 40,
        deltaMode: 0,
        ctrlKey: false,
        defaultPrevented: false,
        preventDefault,
      }),
    ).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("reveals active tabs outside either viewport edge and leaves visible tabs stable", () => {
    const base = { viewportWidth: 300, contentWidth: 900 };
    expect(
      getWorkspaceTabRevealOffset({ ...base, currentOffset: 300, itemStart: 120, itemEnd: 220 }),
    ).toBe(120);
    expect(
      getWorkspaceTabRevealOffset({ ...base, currentOffset: 100, itemStart: 500, itemEnd: 620 }),
    ).toBe(320);
    expect(
      getWorkspaceTabRevealOffset({ ...base, currentOffset: 100, itemStart: 180, itemEnd: 260 }),
    ).toBe(100);
  });
});
