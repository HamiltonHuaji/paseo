import { describe, expect, it } from "vitest";
import {
  getWorkspaceTabRevealOffset,
  resolveWorkspaceTabWheelDelta,
  scrollWorkspaceTabsWithWheel,
} from "@/screens/workspace/workspace-tab-scroll";

describe("resolveWorkspaceTabWheelDelta", () => {
  it("maps an ordinary vertical mouse wheel to horizontal pixels", () => {
    expect(resolveWorkspaceTabWheelDelta({ deltaX: 0, deltaY: 120, deltaMode: 0 }, 600)).toBe(120);
  });

  it("preserves a dominant horizontal trackpad gesture", () => {
    expect(resolveWorkspaceTabWheelDelta({ deltaX: -80, deltaY: 12, deltaMode: 0 }, 600)).toBe(-80);
  });

  it("normalizes line and page wheel modes", () => {
    expect(resolveWorkspaceTabWheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 600)).toBe(48);
    expect(resolveWorkspaceTabWheelDelta({ deltaX: 0, deltaY: -1, deltaMode: 2 }, 600)).toBe(-600);
  });
});

describe("scrollWorkspaceTabsWithWheel", () => {
  function createEvent(delta: { deltaX?: number; deltaY?: number }) {
    let prevented = false;
    return {
      event: {
        deltaX: delta.deltaX ?? 0,
        deltaY: delta.deltaY ?? 0,
        deltaMode: 0,
        ctrlKey: false,
        defaultPrevented: false,
        preventDefault: () => {
          prevented = true;
        },
      },
      wasPrevented: () => prevented,
    };
  }

  it("moves for ordinary and side-wheel deltas", () => {
    const target = { clientWidth: 200, scrollWidth: 600, scrollLeft: 100 };
    const ordinaryWheel = createEvent({ deltaY: 120 });
    expect(scrollWorkspaceTabsWithWheel(target, ordinaryWheel.event)).toBe(true);
    expect(target.scrollLeft).toBe(220);
    expect(ordinaryWheel.wasPrevented()).toBe(true);

    const sideWheel = createEvent({ deltaX: -80 });
    expect(scrollWorkspaceTabsWithWheel(target, sideWheel.event)).toBe(true);
    expect(target.scrollLeft).toBe(140);
    expect(sideWheel.wasPrevented()).toBe(true);
  });

  it("leaves wheel input unconsumed at the horizontal edge", () => {
    const target = { clientWidth: 200, scrollWidth: 600, scrollLeft: 400 };
    const wheel = createEvent({ deltaX: 80 });
    expect(scrollWorkspaceTabsWithWheel(target, wheel.event)).toBe(false);
    expect(target.scrollLeft).toBe(400);
    expect(wheel.wasPrevented()).toBe(false);
  });
});

describe("getWorkspaceTabRevealOffset", () => {
  const base = { viewportWidth: 300, contentWidth: 900 };

  it("keeps an already visible active tab stationary", () => {
    expect(
      getWorkspaceTabRevealOffset({
        ...base,
        currentOffset: 200,
        itemStart: 260,
        itemEnd: 360,
      }),
    ).toBe(200);
  });

  it("reveals active tabs beyond either viewport edge", () => {
    expect(
      getWorkspaceTabRevealOffset({
        ...base,
        currentOffset: 300,
        itemStart: 100,
        itemEnd: 200,
      }),
    ).toBe(100);
    expect(
      getWorkspaceTabRevealOffset({
        ...base,
        currentOffset: 200,
        itemStart: 700,
        itemEnd: 800,
      }),
    ).toBe(500);
  });
});
