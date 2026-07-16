import { arrayMove } from "@dnd-kit/sortable";
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
      paneId: "target",
      insertionIndex: 2,
      indicatorIndex: 2,
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
      paneId: "target",
      insertionIndex: 3,
      indicatorIndex: 3,
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
      paneId: "pane",
      insertionIndex: 3,
      indicatorIndex: 4,
    });
    expect(
      arrayMove(targetTabs, 1, preview?.insertionIndex ?? -1).map((item) => item.tabId),
    ).toEqual(["a", "c", "d", "b"]);
  });
});
