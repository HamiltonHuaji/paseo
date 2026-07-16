import type { DragOrientation } from "@/components/drag-orientation";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

export interface TabDropPreview {
  paneId: string;
  insertionIndex: number;
  indicatorIndex: number;
}

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
    if (input.overRect.height <= 0) {
      return null;
    }
    const activeCenterY = input.activeRect.top + input.activeRect.height / 2;
    const overCenterY = input.overRect.top + input.overRect.height / 2;
    return activeCenterY >= overCenterY;
  }

  if (input.overRect.width <= 0) {
    return null;
  }
  const activeCenterX = input.activeRect.left + input.activeRect.width / 2;
  const overCenterX = input.overRect.left + input.overRect.width / 2;
  return activeCenterX >= overCenterX;
}

export function computeTabDropPreview(input: ComputeTabDropPreviewInput): TabDropPreview | null {
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
    paneId: input.overPaneId,
    insertionIndex,
    indicatorIndex,
  };
}
