import { arrayMove } from "@dnd-kit/sortable";
import { describe, expect, it } from "vitest";
import {
  computeTabDropPreview,
  computeTabTreeGroupDropPreview,
  computeTabTreeLeafDropPreview,
} from "@/components/split-container-tab-drop-preview";
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
      kind: "tab",
      paneId: "target",
      insertionIndex: 2,
      indicatorIndex: 2,
      indicatorTabId: "c",
      indicatorEdge: "before",
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
      kind: "tab",
      paneId: "target",
      insertionIndex: 3,
      indicatorIndex: 3,
      indicatorTabId: "c",
      indicatorEdge: "after",
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
      kind: "tab",
      paneId: "pane",
      insertionIndex: 3,
      indicatorIndex: 4,
      indicatorTabId: "d",
      indicatorEdge: "after",
    });
  });

  it("returns a before-target insertion index for vertical cross-pane drops on the top half", () => {
    expect(
      computeTabDropPreview({
        orientation: "vertical",
        activePaneId: "source",
        activeTabId: "x",
        overPaneId: "target",
        overTabId: "c",
        targetTabs,
        activeRect: { top: 180, height: 40 },
        overRect: { top: 200, height: 100 },
      }),
    ).toEqual({
      kind: "tab",
      paneId: "target",
      insertionIndex: 2,
      indicatorIndex: 2,
      indicatorTabId: "c",
      indicatorEdge: "before",
    });
  });

  it("returns an after-target insertion index for vertical cross-pane drops on the bottom half", () => {
    expect(
      computeTabDropPreview({
        orientation: "vertical",
        activePaneId: "source",
        activeTabId: "x",
        overPaneId: "target",
        overTabId: "c",
        targetTabs,
        activeRect: { top: 280, height: 40 },
        overRect: { top: 200, height: 100 },
      }),
    ).toEqual({
      kind: "tab",
      paneId: "target",
      insertionIndex: 3,
      indicatorIndex: 3,
      indicatorTabId: "c",
      indicatorEdge: "after",
    });
  });

  it("uses vertical same-pane indexes directly with arrayMove", () => {
    const preview = computeTabDropPreview({
      orientation: "vertical",
      activePaneId: "pane",
      activeTabId: "b",
      overPaneId: "pane",
      overTabId: "d",
      targetTabs,
      activeRect: { top: 460, height: 40 },
      overRect: { top: 400, height: 100 },
    });

    expect(preview).toEqual({
      kind: "tab",
      paneId: "pane",
      insertionIndex: 3,
      indicatorIndex: 4,
      indicatorTabId: "d",
      indicatorEdge: "after",
    });
    expect(
      arrayMove(targetTabs, 1, preview?.insertionIndex ?? -1).map((item) => item.tabId),
    ).toEqual(["a", "c", "d", "b"]);
  });

  it("returns a vertical edge preview for a tree group", () => {
    expect(
      computeTabTreeGroupDropPreview({
        overPaneId: "pane",
        overGroupId: "group",
        activeRect: { top: 80, height: 20 },
        overRect: { top: 100, height: 40 },
      }),
    ).toEqual({
      kind: "group",
      paneId: "pane",
      groupId: "group",
      indicatorEdge: "before",
    });
    expect(
      computeTabTreeGroupDropPreview({
        overPaneId: "pane",
        overGroupId: "group",
        activeRect: { top: 130, height: 20 },
        overRect: { top: 100, height: 40 },
      }),
    ).toEqual({
      kind: "group",
      paneId: "pane",
      groupId: "group",
      indicatorEdge: "after",
    });
  });

  it("returns a vertical edge preview for a leaf targeted by a tree group", () => {
    expect(
      computeTabTreeLeafDropPreview({
        overPaneId: "pane",
        overTabId: "leaf",
        activeRect: { top: 130, height: 20 },
        overRect: { top: 100, height: 40 },
      }),
    ).toEqual({
      kind: "tree-leaf",
      paneId: "pane",
      tabId: "leaf",
      indicatorEdge: "after",
    });
  });
});
