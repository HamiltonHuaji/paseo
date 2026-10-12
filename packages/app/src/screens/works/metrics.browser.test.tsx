import React, { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { Metrics } from "./metrics";
import { WorksContext, type WorksContextValue } from "./context";
import type { WorkDataQueryResult } from "@getpaseo/protocol/work-data";

// Exercise actual SVG elements in Chromium, rather than the suite's native SVG stub.
vi.mock("react-native-svg", () => import("react-native-svg/lib/module/elements.web.js"));
vi.mock("react-native-unistyles", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../test-stubs/react-native-unistyles")>();
  const theme = original.StyleSheet.create((value) => value);
  return {
    ...original,
    withUnistyles: <P extends object>(Component: ComponentType<P>) => {
      return function WithTheme({
        uniProps,
        ...props
      }: P & { uniProps?: (value: typeof theme) => Partial<P> }) {
        return createElement(Component, { ...uniProps?.(theme), ...props } as P);
      };
    },
  };
});
const mounted: Array<{ root: Root; container: HTMLDivElement; cache: QueryClient }> = [];
afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.cache.clear();
    entry.container.remove();
  }
});
const data: WorkDataQueryResult = {
  runId: "baseline",
  generation: "one",
  revision: 1,
  activityAt: "2026-10-12T00:00:00.000Z",
  caughtUp: true,
  ended: false,
  lastStep: 100,
  error: null,
  series: [
    {
      key: ["loss"],
      status: "available",
      points: [
        [0, 1],
        [20, 0.6],
        [50, 0.4],
        [100, 0.1],
      ],
      count: 4,
      last: 0.1,
      min: 0.1,
      max: 1,
      mean: 0.525,
      time: null,
    },
  ],
};
function mount(readData: WorksContextValue["readData"], active = true) {
  const context: WorksContextValue = {
    serverId: "host",
    projectId: "project",
    client: null,
    active,
    connected: true,
    readData,
    openViewer: async () => {},
  };
  const container = document.createElement("div");
  container.style.width = "380px";
  document.body.appendChild(container);
  const root = createRoot(container);
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  act(() => root.render(renderPanel(cache, context)));
  mounted.push({ root, container, cache });
  return container;
}
const panel = {
  panels: [
    {
      id: "loss",
      title: "Training loss",
      source: { objectId: "card_1234abcd", source: "training" },
      display: "line" as const,
      series: [{ key: ["loss"], label: "Loss" }],
    },
  ],
};
function renderPanel(cache: QueryClient, context: WorksContextValue) {
  return (
    <QueryClientProvider client={cache}>
      <WorksContext.Provider value={context}>
        <Metrics value={panel} />
      </WorksContext.Provider>
    </QueryClientProvider>
  );
}

it("renders a loss curve without Progress or an HTML viewer", async () => {
  const container = mount(async () => data);
  await expect.element(page.getByText("Loss: 0.1")).toBeVisible();
  expect(container.querySelectorAll("svg polyline").length).toBe(1);
  expect(container.querySelector("svg polyline")?.getAttribute("points")).toContain("288,110");
  await page.screenshot({ path: "/tmp/paseo-works-metric.png" });
});

it("shows source failures and keeps hidden panels from reading", async () => {
  mount(async () => {
    throw new Error("W&B source directory is unavailable");
  });
  await expect.element(page.getByText("W&B source directory is unavailable")).toBeVisible();
  const read = vi.fn(async () => data);
  mount(read, false);
  expect(read).not.toHaveBeenCalled();
});
