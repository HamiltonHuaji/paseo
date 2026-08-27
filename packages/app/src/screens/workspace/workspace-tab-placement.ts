import type { WorkspaceTabPlacement } from "@/hooks/use-settings";

export const WORKSPACE_TAB_RAIL_WIDTH = 220;
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
