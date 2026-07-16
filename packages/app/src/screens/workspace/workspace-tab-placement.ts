import type { WorkspaceTabPlacement } from "@/hooks/use-settings";

export const WORKSPACE_TAB_RAIL_WIDTH = 220;
export const MIN_WORKSPACE_TAB_CONTENT_WIDTH = 420;
export const MIN_LEFT_WORKSPACE_TAB_PANE_WIDTH =
  WORKSPACE_TAB_RAIL_WIDTH + MIN_WORKSPACE_TAB_CONTENT_WIDTH;

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
  if (!input.isWeb) {
    return "top";
  }
  if (input.preference === "top") {
    return "top";
  }
  return input.paneWidth >= MIN_LEFT_WORKSPACE_TAB_PANE_WIDTH ? "left" : "top";
}
