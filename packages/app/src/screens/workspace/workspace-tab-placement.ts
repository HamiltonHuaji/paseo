import type { WorkspaceTabPlacement } from "@/hooks/use-settings";

import {
  MIN_WORKSPACE_TAB_RAIL_WIDTH,
  MAX_WORKSPACE_TAB_RAIL_WIDTH,
} from "@/constants/workspace-tabs";

export function resolveWorkspaceTabRailWidth(requestedWidth: number, paneWidth: number): number {
  return Math.max(
    MIN_WORKSPACE_TAB_RAIL_WIDTH,
    Math.min(requestedWidth, MAX_WORKSPACE_TAB_RAIL_WIDTH, paneWidth / 2),
  );
}
export const MIN_LEFT_WORKSPACE_TAB_PANE_WIDTH = 640;

export type EffectiveWorkspaceTabPlacement = WorkspaceTabPlacement | "dropdown";

export interface WorkspaceTabPlacementInput {
  isCompact: boolean;
  isWeb: boolean;
  paneWidth: number;
  preference: WorkspaceTabPlacement;
}

export function resolveWorkspaceTabPlacement(
  input: WorkspaceTabPlacementInput,
): EffectiveWorkspaceTabPlacement {
  if (input.isCompact) {
    return "dropdown";
  }
  if (!input.isWeb || input.preference === "top") {
    return "top";
  }
  return input.paneWidth >= MIN_LEFT_WORKSPACE_TAB_PANE_WIDTH ? "left" : "top";
}
