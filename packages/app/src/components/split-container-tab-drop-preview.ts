import type { DragOrientation } from "@/components/drag-orientation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

export interface TabTargetDropPreview {
  kind: "tab";
  paneId: string;
  insertionIndex: number;
  indicatorIndex: number;
  indicatorTabId: string;
  indicatorEdge: "before" | "after";
}

export interface TabTreeGroupDropPreview {
  kind: "group";
  paneId: string;
  groupId: string;
  indicatorEdge: "before" | "after";
}

export interface TabTreeLeafDropPreview {
  kind: "tree-leaf";
  paneId: string;
  tabId: string;
  indicatorEdge: "before" | "after";
}

export type TabDropPreview =
  | TabTargetDropPreview
  | TabTreeGroupDropPreview
  | TabTreeLeafDropPreview;

interface ComputeTabDropPreviewCommonInput {
  activePaneId: string;
  activeTabId: string;
  overPaneId: string;
  overTabId: string;
  targetTabs: WorkspaceTabDescriptor[];
}

interface HorizontalTabDropRect {
  left: number;
  width: number;
}

interface VerticalTabDropRect {
  top: number;
  height: number;
}

type ComputeTabDropPreviewInput = ComputeTabDropPreviewCommonInput &
  (
    | {
        orientation?: Extract<DragOrientation, "horizontal">;
        activeRect: HorizontalTabDropRect;
        overRect: HorizontalTabDropRect;
      }
    | {
        orientation: Extract<DragOrientation, "vertical">;
        activeRect: VerticalTabDropRect;
        overRect: VerticalTabDropRect;
      }
  );

function isAfterDropTarget(input: ComputeTabDropPreviewInput): boolean | null {
  if (input.orientation === "vertical") {
    return isAfterVerticalDropTarget(input.activeRect, input.overRect);
  }

  if (input.overRect.width <= 0) {
    return null;
  }
  const activeCenterX = input.activeRect.left + input.activeRect.width / 2;
  const overCenterX = input.overRect.left + input.overRect.width / 2;
  return activeCenterX >= overCenterX;
}

function isAfterVerticalDropTarget(
  activeRect: VerticalTabDropRect,
  overRect: VerticalTabDropRect,
): boolean | null {
  if (overRect.height <= 0) return null;
  const activeCenterY = activeRect.top + activeRect.height / 2;
  const overCenterY = overRect.top + overRect.height / 2;
  return activeCenterY >= overCenterY;
}

export function computeTabDropPreview(
  input: ComputeTabDropPreviewInput,
): TabTargetDropPreview | null {
  const targetIndex = input.targetTabs.findIndex((tab) => tab.tabId === input.overTabId);
  const insertAfterTarget = isAfterDropTarget(input);
  if (targetIndex < 0 || insertAfterTarget === null) {
    return null;
  }

  const indicatorIndex = targetIndex + (insertAfterTarget ? 1 : 0);
  let insertionIndex = indicatorIndex;
  if (input.activePaneId === input.overPaneId) {
    const sourceIndex = input.targetTabs.findIndex((tab) => tab.tabId === input.activeTabId);
    if (sourceIndex < 0) {
      return null;
    }
    if (sourceIndex < insertionIndex) {
      insertionIndex -= 1;
    }
    insertionIndex = Math.max(0, Math.min(input.targetTabs.length - 1, insertionIndex));
  }

  return {
    kind: "tab",
    paneId: input.overPaneId,
    insertionIndex,
    indicatorIndex,
    indicatorTabId: input.overTabId,
    indicatorEdge: insertAfterTarget ? "after" : "before",
  };
}

export function computeTabTreeGroupDropPreview(input: {
  overPaneId: string;
  overGroupId: string;
  activeRect: VerticalTabDropRect;
  overRect: VerticalTabDropRect;
}): TabTreeGroupDropPreview | null {
  const insertAfterTarget = isAfterVerticalDropTarget(input.activeRect, input.overRect);
  if (insertAfterTarget === null) return null;
  return {
    kind: "group",
    paneId: input.overPaneId,
    groupId: input.overGroupId,
    indicatorEdge: insertAfterTarget ? "after" : "before",
  };
}

export function computeTabTreeLeafDropPreview(input: {
  overPaneId: string;
  overTabId: string;
  activeRect: VerticalTabDropRect;
  overRect: VerticalTabDropRect;
}): TabTreeLeafDropPreview | null {
  const insertAfterTarget = isAfterVerticalDropTarget(input.activeRect, input.overRect);
  if (insertAfterTarget === null) return null;
  return {
    kind: "tree-leaf",
    paneId: input.overPaneId,
    tabId: input.overTabId,
    indicatorEdge: insertAfterTarget ? "after" : "before",
  };
}
