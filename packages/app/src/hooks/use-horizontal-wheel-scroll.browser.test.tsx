import React, { useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useHorizontalWheelScroll } from "./use-horizontal-wheel-scroll";

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = [];
const SCROLL_STYLE = { width: 200, overflowX: "auto" } as const;
const CONTENT_STYLE = { width: 600, height: 20 } as const;

function HorizontalScrollHarness() {
  const scrollRef = useRef<HTMLDivElement>(null);
  useHorizontalWheelScroll(scrollRef, true);

  return (
    <div ref={scrollRef} data-testid="wheel-scroll" style={SCROLL_STYLE}>
      <div style={CONTENT_STYLE} />
    </div>
  );
}

async function mountHarness(): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<HorizontalScrollHarness />));
  mounted.push({ host, root });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const scroll = host.querySelector<HTMLElement>("[data-testid='wheel-scroll']");
  if (!scroll) throw new Error("ScrollView did not render");
  return scroll;
}

afterEach(() => {
  for (const { host, root } of mounted.splice(0)) {
    flushSync(() => root.unmount());
    host.remove();
  }
});

describe("useHorizontalWheelScroll", () => {
  it("uses an ordinary mouse wheel to move a horizontal ScrollView", async () => {
    const scroll = await mountHarness();
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);

    const event = new WheelEvent("wheel", {
      deltaY: 120,
      bubbles: true,
      cancelable: true,
    });
    scroll.dispatchEvent(event);

    expect(scroll.scrollLeft).toBe(120);
    expect(event.defaultPrevented).toBe(true);
  });

  it("uses a mouse side wheel's horizontal delta", async () => {
    const scroll = await mountHarness();
    scroll.scrollLeft = 200;

    const event = new WheelEvent("wheel", {
      deltaX: -80,
      bubbles: true,
      cancelable: true,
    });
    scroll.dispatchEvent(event);

    expect(scroll.scrollLeft).toBe(120);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves the wheel available to ancestors at the horizontal edge", async () => {
    const scroll = await mountHarness();
    scroll.scrollLeft = scroll.scrollWidth - scroll.clientWidth;

    const event = new WheelEvent("wheel", {
      deltaY: 120,
      bubbles: true,
      cancelable: true,
    });
    scroll.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
