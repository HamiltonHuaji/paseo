import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { DragOrientation } from "@/components/drag-orientation";

export interface TabDropPreview {
  paneId: string;
  insertionIndex: number;
  indicatorIndex: number;
}

interface ComputeTabDropPreviewInput {
  activePaneId: string;
  activeTabId: string;
  overPaneId: string;
  overTabId: string;
  targetTabs: WorkspaceTabDescriptor[];
  orientation?: DragOrientation;
  activeRect: {
    left: number;
    top?: number;
    width: number;
    height?: number;
  };
  overRect: {
    left: number;
    top?: number;
    width: number;
    height?: number;
  };
}

export function computeTabDropPreview(input: ComputeTabDropPreviewInput): TabDropPreview | null {
  const targetIndex = input.targetTabs.findIndex((tab) => tab.tabId === input.overTabId);
  const vertical = input.orientation === "vertical";
  const overExtent = vertical ? (input.overRect.height ?? 0) : input.overRect.width;
  if (targetIndex < 0 || overExtent <= 0) {
    return null;
  }

  const activeCenter = vertical
    ? (input.activeRect.top ?? 0) + (input.activeRect.height ?? 0) / 2
    : input.activeRect.left + input.activeRect.width / 2;
  const overCenter = vertical
    ? (input.overRect.top ?? 0) + (input.overRect.height ?? 0) / 2
    : input.overRect.left + input.overRect.width / 2;
  const insertAfterTarget = activeCenter >= overCenter;

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
