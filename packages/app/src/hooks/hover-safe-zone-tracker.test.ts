import { describe, expect, it } from "vitest";
import { createHoverSafeZoneTracker, type RectLike } from "@/hooks/hover-safe-zone-tracker";

const TRIGGER: RectLike = { left: 0, right: 100, top: 20, bottom: 60 };
const CONTENT: RectLike = { left: 120, right: 240, top: 20, bottom: 120 };

interface TrackerHandle {
  pointerMoved(x: number, y: number): void;
  pointerLeftWindow(): void;
  windowBlurred(): void;
  readonly enters: number;
  readonly leaves: number;
}

function createHandle(
  rects: { trigger: RectLike | null; content: RectLike | null } = {
    trigger: TRIGGER,
    content: CONTENT,
  },
): TrackerHandle {
  let enters = 0;
  let leaves = 0;
  const tracker = createHoverSafeZoneTracker({
    getTriggerRect: () => rects.trigger,
    getContentRect: () => rects.content,
    onEnterSafeZone: () => {
      enters += 1;
    },
    onLeaveSafeZone: () => {
      leaves += 1;
    },
  });
  return {
    pointerMoved: tracker.pointerMoved,
    pointerLeftWindow: tracker.pointerLeftWindow,
    windowBlurred: tracker.windowBlurred,
    get enters() {
      return enters;
    },
    get leaves() {
      return leaves;
    },
  };
}

describe("hover safe-zone tracker", () => {
  it("tracks transitions across trigger, bridge, content, and outside space", () => {
    const handle = createHandle();

    // Bridge between trigger and content.
    handle.pointerMoved(110, 40);
    expect(handle.enters).toBe(1);
    expect(handle.leaves).toBe(0);

    // Outside everything — fires leave once.
    handle.pointerMoved(300, 40);
    expect(handle.leaves).toBe(1);

    // Back into the bridge — fires enter again.
    handle.pointerMoved(130, 40);
    expect(handle.enters).toBe(2);
  });

  it("refreshes the safe-zone enter callback while moving inside", () => {
    const handle = createHandle();

    handle.pointerMoved(110, 40);
    handle.pointerMoved(130, 40);

    expect(handle.enters).toBe(2);
    expect(handle.leaves).toBe(0);
  });

  it("treats leaving the browser window as leaving the safe zone", () => {
    const handle = createHandle();

    handle.pointerLeftWindow();
    expect(handle.leaves).toBe(1);

    // Already outside — blur does not fire a second leave.
    handle.windowBlurred();
    expect(handle.leaves).toBe(1);
  });

  it("retains an outside pointer while content interaction is active", () => {
    let retainAfterLeave = true;
    let enters = 0;
    let leaves = 0;
    const tracker = createHoverSafeZoneTracker({
      getTriggerRect: () => TRIGGER,
      getContentRect: () => CONTENT,
      shouldRetainAfterLeave: () => retainAfterLeave,
      onEnterSafeZone: () => {
        enters += 1;
      },
      onLeaveSafeZone: () => {
        leaves += 1;
      },
    });

    tracker.pointerMoved(300, 40);
    expect(enters).toBe(1);
    expect(leaves).toBe(0);

    retainAfterLeave = false;
    tracker.retentionChanged();
    expect(leaves).toBe(1);

    retainAfterLeave = true;
    tracker.retentionChanged();
    expect(enters).toBe(2);

    retainAfterLeave = false;
    tracker.retentionChanged();
    expect(leaves).toBe(2);
  });

  it("falls back to trigger-or-content membership when a rect is missing", () => {
    const handle = createHandle({ trigger: TRIGGER, content: null });

    // Inside the trigger.
    handle.pointerMoved(50, 40);
    expect(handle.enters).toBe(1);

    // Inside the (now-missing) bridge — counts as outside.
    handle.pointerMoved(110, 40);
    expect(handle.leaves).toBe(1);
  });

  it("bridges content placed above the trigger", () => {
    const handle = createHandle({
      trigger: { left: 40, right: 140, top: 80, bottom: 100 },
      content: { left: 20, right: 200, top: 20, bottom: 70 },
    });

    handle.pointerMoved(100, 75);
    expect(handle.enters).toBe(1);
    expect(handle.leaves).toBe(0);
  });

  it("bridges content placed below the trigger", () => {
    const handle = createHandle({
      trigger: { left: 40, right: 140, top: 20, bottom: 40 },
      content: { left: 20, right: 200, top: 50, bottom: 100 },
    });

    handle.pointerMoved(100, 45);
    expect(handle.enters).toBe(1);
    expect(handle.leaves).toBe(0);
  });

  it("does not invent a bridge when trigger and content overlap", () => {
    const handle = createHandle({
      trigger: { left: 0, right: 200, top: 0, bottom: 80 },
      content: { left: 100, right: 300, top: 60, bottom: 120 },
    });

    // Inside their bounding box, but outside both actual rects.
    handle.pointerMoved(250, 20);
    expect(handle.leaves).toBe(1);
  });
});
