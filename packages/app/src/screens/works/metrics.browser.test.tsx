import React, {
  act,
  createElement,
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type ComponentProps,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Metrics } from "./metrics";
import { numericTicks, plotGeometry, nearestPoint } from "./metric-chart-model";
import { WorksContext, type WorksContextValue } from "./context";
import type { WorkDataQueryResult } from "@getpaseo/protocol/work-data";
import type { WorkCard, WorkView } from "@getpaseo/protocol/work-objects";
import { WorkCardPreview, cardHeight, useCanvasDisplay } from "./preview";
import { CardDetailContent } from "./detail";
import { cardView } from "./components";
import type { FloatingSurfaceProps } from "@/components/ui/floating";

vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
// Prose rendering is covered separately; keep these browser checks on the containing layout.
vi.mock("@/components/markdown/renderer", () => ({
  MarkdownRenderer: ({ text }: { text: string }) => <Text>{text}</Text>,
}));
// Keep the real menu positioning and rows; this runner has no Reanimated Babel transform.
vi.mock("@/components/ui/floating", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/ui/floating")>();
  return {
    ...original,
    FloatingSurface: React.forwardRef<
      View,
      ComponentProps<typeof View> & Pick<FloatingSurfaceProps, "frameStyle">
    >(function Surface({ frameStyle, style, children, onLayout, nativeID }, ref) {
      return (
        <View ref={ref} style={[style, frameStyle]} onLayout={onLayout} nativeID={nativeID}>
          {children}
        </View>
      );
    }),
  };
});

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
function mount(
  readData: WorksContextValue["readData"],
  active = true,
  content?: ReactNode,
  width = 380,
  openViewer: WorksContextValue["openViewer"] = async () => {},
) {
  const context: WorksContextValue = {
    serverId: "host",
    projectId: "project",
    client: null,
    active,
    connected: true,
    readData,
    openViewer,
  };
  const container = document.createElement("div");
  container.style.width = `${width}px`;
  document.body.appendChild(container);
  const root = createRoot(container);
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  act(() => root.render(renderPanel(cache, context, content)));
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
function renderPanel(
  cache: QueryClient,
  context: WorksContextValue,
  content: ReactNode = <Metrics value={panel} />,
) {
  return (
    <QueryClientProvider client={cache}>
      <WorksContext.Provider value={context}>{content}</WorksContext.Provider>
    </QueryClientProvider>
  );
}

it("renders a loss curve without Progress or an HTML viewer", async () => {
  const container = mount(async () => data);
  await expect.element(page.getByText("Loss", { exact: true })).toBeVisible();
  expect(container.querySelectorAll("svg polyline").length).toBe(1);
  expect(container.querySelector("svg polyline")?.getAttribute("points")?.split(" ")).toHaveLength(
    4,
  );
});

const comparison = {
  panels: [
    {
      ...panel.panels[0]!,
      series: [...panel.panels[0]!.series, { key: ["validation_loss"], label: "Validation loss" }],
    },
  ],
};
const comparisonData: WorkDataQueryResult = {
  ...data,
  series: [
    ...data.series,
    {
      ...data.series[0]!,
      key: ["validation_loss"],
      points: [
        [0, 1.2],
        [20, 0.8],
        [50, 0.65],
        [100, 0.5],
      ],
      last: 0.5,
    },
  ],
};
it("reads recorded samples and lets the user isolate a series", async () => {
  await page.viewport(760, 900);
  const container = mount(async () => comparisonData, true, <Metrics value={comparison} />, 700);
  await expect.poll(() => container.querySelectorAll("svg polyline").length).toBe(2);
  expect(container.querySelectorAll("svg line").length).toBeGreaterThan(4);
  await page
    .getByRole("button", { name: "Inspect Training loss" })
    .click({ position: { x: 350, y: 90 } });
  const readout = page.getByTestId("metric-readout-loss");
  await expect.element(readout.getByText("0.4", { exact: true })).toBeVisible();
  await expect.element(readout.getByText("0.65", { exact: true })).toBeVisible();
  await expect.element(readout.getByText("Step 50", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "/tmp/paseo-works-metric-readout.png", element: container });
  await page.getByRole("button", { name: "Hide Validation loss" }).click();
  await expect.poll(() => container.querySelectorAll("svg polyline").length).toBe(1);
  await page.getByRole("button", { name: "Show Validation loss" }).click();
  await expect.poll(() => container.querySelectorAll("svg polyline").length).toBe(2);
});

it("keeps log gaps and small-value ticks readable without interpolating samples", () => {
  const geometry = plotGeometry(
    [
      {
        ...data.series[0]!,
        points: [
          [1, 0.01],
          [2, 0],
          [3, 0.001],
          [4, -1],
        ],
      },
    ],
    true,
  );
  expect(geometry.paths).toEqual([[[[1, -2]], [[3, -3]]]]);
  expect(geometry.excluded).toBe(2);
  expect(numericTicks(0.0001, 0.0005, 5)).toEqual([0.0001, 0.0002, 0.0003, 0.0004, 0.0005]);
  expect(
    nearestPoint(
      [
        [0, 1],
        [20, 0.6],
        [50, 0.4],
      ],
      38,
    ),
  ).toEqual([50, 0.4]);
});

const trainingPanel = {
  panels: [
    {
      ...panel.panels[0]!,
      title: "eval/ar_vla/ce/generated_cot/action_code/loss",
      series: [
        { key: ["baseline"], label: "Baseline · lr=1e-4" },
        { key: ["rebalanced"], label: "Rebalanced data · lr=1e-4" },
        { key: ["warmup"], label: "Longer warmup · lr=2e-4" },
      ],
    },
  ],
};
const trainingData: WorkDataQueryResult = {
  ...data,
  runId: "vla-mixture-comparison",
  series: trainingPanel.panels[0]!.series.map((series, variant) => {
    const points: [number, number][] = Array.from({ length: 400 }, (_, index) => [
      index * 250,
      1 +
        variant * 0.2 +
        8 * Math.exp(-index / (65 + variant * 10)) +
        Math.sin(index * 1.7 + variant) * (0.12 + 0.4 * Math.exp(-index / 100)),
    ]);
    return {
      status: "available" as const,
      min: null,
      max: null,
      mean: null,
      time: null,
      key: series.key,
      points,
      count: points.length,
      last: points.at(-1)![1],
    };
  }),
};

it.each([340, 700])(
  "keeps long metric names and three training curves readable at %i px",
  async (width) => {
    await page.viewport(width + 32, 900);
    const container = mount(
      async () => trainingData,
      true,
      <Metrics value={trainingPanel} />,
      width,
    );
    await expect.poll(() => container.querySelectorAll("svg polyline").length).toBe(3);
    expect(container.scrollWidth).toBeLessThanOrEqual(width);
    await expect
      .element(page.getByText("eval/ar_vla/ce/generated_cot/action_code/loss", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Hide Rebalanced data · lr=1e-4" }))
      .toBeVisible();
    await page.screenshot({
      path: `/tmp/paseo-works-metric-training-${width}.png`,
      element: container,
    });
  },
);

const noAction = () => {};
const manyMetrics = {
  panels: Array.from({ length: 24 }, (_, index) => ({
    ...panel.panels[0]!,
    id: `loss-${index}`,
    title: `Training loss ${index + 1}`,
  })),
};
const card: WorkCard = {
  id: "card_1234abcd",
  kind: "card",
  label: "experiment",
  title: "Multimodal training",
  body: "Compare the training runs and retain their evaluation reports.",
  goal: null,
  basedOn: null,
  viewerSource: null,
  createdAt: "2026-10-19T00:00:00Z",
  updatedAt: "2026-10-19T00:00:00Z",
  startedAt: null,
  endedAt: null,
  archivedAt: null,
  touches: [],
  storageRelpath: "example",
  progressState: { observation: null, checkedAt: null, error: null, catchingUp: false },
  progress: null,
  metrics: manyMetrics,
  result: null,
  config: null,
  sessions: null,
  viewers: {
    entries: Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [
        `Report ${index + 1}`,
        `report-${index}/index.html`,
      ]),
    ),
  },
};

const canvas = { panels: [], disabled: false, onChange: noAction, onResetSize: noAction };
const selected = { ...canvas, panels: ["loss-0", "loss-1"] };

function ConfigurablePreview() {
  const display = useCanvasDisplay();
  const onChange = useCallback(
    (cardId: string, panels: string[]) => display.save.mutate({ cardId, panels }),
    [display.save],
  );
  const options = useMemo(
    () => ({
      panels: display.panels[card.id] ?? [],
      disabled: display.loading || display.save.isPending,
      onChange,
      onResetSize: noAction,
    }),
    [display.panels, display.loading, display.save.isPending, onChange],
  );
  return <WorkCardPreview card={card} count={17} canvas={options} />;
}

it("remembers per-card curve choices and can hide them without changing metrics", async () => {
  await page.viewport(800, 900);
  await AsyncStorage.removeItem('["works-canvas-display","host","project"]');
  const container = mount(async () => data, true, <ConfigurablePreview />);
  const trigger = page.getByRole("button", { name: "Canvas display for Multimodal training" });
  await trigger.click();
  await page.getByRole("menuitem", { name: "Training loss 1", exact: true }).click();
  await page.getByRole("menuitem", { name: "Training loss 2", exact: true }).click();
  await expect.poll(() => container.querySelectorAll("svg polyline").length).toBe(2);
  await userEvent.keyboard("{Escape}");
  await page.screenshot({ path: "/tmp/paseo-works-selected-curves.png", element: container });
  const previous = mounted.pop()!;
  act(() => previous.root.unmount());
  previous.cache.clear();
  previous.container.remove();
  const reopened = mount(async () => data, true, <ConfigurablePreview />);
  await expect.poll(() => reopened.querySelectorAll("svg polyline").length).toBe(2);
  await page.getByRole("button", { name: "Canvas display for Multimodal training" }).click();
  await page.getByRole("menuitem", { name: "Hide all metrics", exact: true }).click();
  await expect.poll(() => reopened.querySelectorAll("svg polyline").length).toBe(0);
  expect(card.metrics?.panels).toHaveLength(24);
  await AsyncStorage.removeItem('["works-canvas-display","host","project"]');
});

it("keeps a canvas summary small even with many metrics and viewers, and shows all chosen curves together", async () => {
  const read = vi.fn(async () => data);
  const container = mount(read, true, <WorkCardPreview card={card} count={17} canvas={canvas} />);
  expect(container.querySelectorAll("svg polyline")).toHaveLength(0);
  expect(read).not.toHaveBeenCalled();
  expect(container.getBoundingClientRect().height).toBeLessThan(240);
  expect(cardHeight(card) * 24).toBeLessThanOrEqual(264);
  expect(container.textContent).not.toContain("Report 17");
  const selectedContainer = mount(
    async () => data,
    true,
    <WorkCardPreview card={card} count={17} canvas={selected} />,
  );
  await expect.poll(() => selectedContainer.querySelectorAll("svg polyline").length).toBe(2);
  expect(selectedContainer.textContent).toContain("Training loss 1");
  expect(selectedContainer.textContent).toContain("Training loss 2");
  expect(selectedContainer.textContent).not.toContain("Training loss 3");
  expect(selectedContainer.getBoundingClientRect().height + 58).toBeLessThan(
    cardHeight(card, selected.panels) * 24,
  );
});

const viewerEntries = {
  entries: Array.from({ length: 17 }, (_, index) => ({
    name: `训练报告 ${index + 1}`,
    path: `/view/report-${index}`,
    available: true,
    unavailableReason: null,
  })),
  sources: [],
  inheritedFrom: null,
};
const items: WorkView[] = [
  {
    id: "item_1111abcd",
    parentCardId: card.id,
    kind: "item",
    label: "attempt",
    title: "Baseline run",
    body: "Establish a baseline before changing the data mixture.",
    createdAt: "2026-10-18T00:00:00Z",
    viewerEntries: {
      ...viewerEntries,
      entries: [{ ...viewerEntries.entries[0]!, path: "/view/baseline" }],
    },
  },
  {
    id: "item_2222abcd",
    parentCardId: card.id,
    kind: "item",
    label: "attempt",
    title: "Rebalanced mixture",
    body: "Increase the language data share and compare against the baseline.",
    createdAt: "2026-10-19T00:00:00Z",
    viewerEntries,
  },
];

const cards = [card];
function DetailFixture() {
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const onItemExpandedChange = useCallback((id: string, expanded: boolean) => {
    setExpandedItems((current) => ({ ...current, [id]: expanded }));
  }, []);
  const view = useMemo(() => cardView(card), []);
  return (
    <CardDetailContent
      card={view}
      items={items}
      cards={cards}
      onSelect={noAction}
      onClose={noAction}
      expandedItems={expandedItems}
      onItemExpandedChange={onItemExpandedChange}
    />
  );
}

it.each([380, 720])("keeps viewers inside their expanded item at %i px", async (width) => {
  await page.viewport(width + 32, 900);
  const open = vi.fn(async () => {});
  const container = mount(async () => data, true, <DetailFixture />, width, open);
  container.style.height = "850px";
  await expect
    .element(page.getByRole("button", { name: "Collapse Rebalanced mixture" }))
    .toBeVisible();
  const first = page.getByTestId("work-item-item_1111abcd");
  const second = page.getByTestId("work-item-item_2222abcd");
  await expect
    .element(first.getByText("Establish a baseline before changing the data mixture."))
    .toBeVisible();
  await expect
    .element(first.getByRole("button", { name: "训练报告 1", exact: true }))
    .not.toBeInTheDocument();
  await second.getByRole("button", { name: "训练报告 1", exact: true }).click();
  expect(open).toHaveBeenLastCalledWith("/view/report-0");
  await page.getByRole("button", { name: "Expand Baseline run" }).click();
  await first.getByRole("button", { name: "训练报告 1", exact: true }).click();
  expect(open).toHaveBeenLastCalledWith("/view/baseline");
  const link = second.getByRole("button", { name: "训练报告 17" }).element();
  expect(getComputedStyle(link).justifyContent).toBe("flex-start");
  expect(link.getBoundingClientRect().width).toBeLessThan(width);
  expect(container.scrollWidth).toBeLessThanOrEqual(width);
  await page.screenshot({ path: `/tmp/paseo-works-detail-${width}.png`, element: container });
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
