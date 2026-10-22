import type { WorkspaceTabLaunchGroup, WorkspaceTabLaunchItem } from "@/workspace-tabs/launcher";

const VERTICAL_QUICK_LAUNCH_IDS = new Set(["agent", "terminal", "browser"]);

export function getWorkspaceVerticalQuickLaunchItems(
  groups: readonly WorkspaceTabLaunchGroup[],
): readonly WorkspaceTabLaunchItem[] {
  return (groups.find((group) => group.id === "tabs")?.items ?? []).filter((item) =>
    VERTICAL_QUICK_LAUNCH_IDS.has(item.id),
  );
}
