import { describe, expect, it } from "vitest";
import { computeTabDropPreview } from "@/components/split-container-tab-drop-preview";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

function tab(tabId: string): WorkspaceTabDescriptor {
  return {
    key: tabId,
    tabId,
    kind: "draft",
    target: {
      kind: "draft",
      draftId: tabId,
    },
  };
}

describe("computeTabDropPreview", () => {
  const targetTabs = [tab("a"), tab("b"), tab("c"), tab("d")];

  it.each([
    { activeTop: 160, expectedIndex: 2 },
    { activeTop: 230, expectedIndex: 3 },
  ])(
    "uses the target rail's Y axis for cross-pane insertion: $activeTop",
    ({ activeTop, expectedIndex }) => {
      expect(
        computeTabDropPreview({
          activePaneId: "source",
          activeTabId: "x",
          overPaneId: "target",
          overTabId: "c",
          targetTabs,
          orientation: "vertical",
          activeRect: { left: 1000, width: 100, top: activeTop, height: 36 },
          overRect: { left: 0, width: 220, top: 200, height: 36 },
        }),
      ).toEqual({
        paneId: "target",
        insertionIndex: expectedIndex,
        indicatorIndex: expectedIndex,
        verticalIndicator: { tabId: "c", edge: expectedIndex === 2 ? "before" : "after" },
      });
    },
  );

  it("anchors an after-leaf line before the next tree group while correcting same-pane order", () => {
    const result = computeTabDropPreview({
      activePaneId: "pane",
      activeTabId: "source",
      overPaneId: "pane",
      overTabId: "import-copy",
      targetTabs: [
        tab("source"),
        tab("fork"),
        tab("import-copy"),
        tab("research/train/a"),
        tab("research/train/b"),
      ],
      orientation: "vertical",
      activeRect: { left: 0, width: 220, top: 84, height: 36 },
      overRect: { left: 0, width: 220, top: 72, height: 36 },
    });
    expect(result).toEqual({
      paneId: "pane",
      insertionIndex: 2,
      indicatorIndex: 3,
      verticalIndicator: { tabId: "import-copy", edge: "after" },
    });
  });

  it("returns a before-target insertion index for cross-pane drops on the left half", () => {
    expect(
      computeTabDropPreview({
        activePaneId: "source",
        activeTabId: "x",
        overPaneId: "target",
        overTabId: "c",
        targetTabs,
        activeRect: { left: 180, width: 40 },
        overRect: { left: 200, width: 100 },
      }),
    ).toEqual({
      paneId: "target",
      insertionIndex: 2,
      indicatorIndex: 2,
    });
  });

  it("returns an after-target insertion index for cross-pane drops on the right half", () => {
    expect(
      computeTabDropPreview({
        activePaneId: "source",
        activeTabId: "x",
        overPaneId: "target",
        overTabId: "c",
        targetTabs,
        activeRect: { left: 280, width: 40 },
        overRect: { left: 200, width: 100 },
      }),
    ).toEqual({
      paneId: "target",
      insertionIndex: 3,
      indicatorIndex: 3,
    });
  });

  it("adjusts same-pane drops so insertion indexes match arrayMove semantics", () => {
    expect(
      computeTabDropPreview({
        activePaneId: "pane",
        activeTabId: "b",
        overPaneId: "pane",
        overTabId: "d",
        targetTabs,
        activeRect: { left: 460, width: 40 },
        overRect: { left: 400, width: 100 },
      }),
    ).toEqual({
      paneId: "pane",
      insertionIndex: 3,
      indicatorIndex: 4,
    });
  });
});
