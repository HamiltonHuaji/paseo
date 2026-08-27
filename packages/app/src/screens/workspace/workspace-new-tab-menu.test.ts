import { describe, expect, it, vi } from "vitest";
import { getWorkspaceVerticalQuickLaunchItems } from "@/screens/workspace/workspace-vertical-tab-actions";
import type { WorkspaceTabLaunchGroup, WorkspaceTabLaunchItem } from "@/workspace-tabs/launcher";

function launchItem(id: string): WorkspaceTabLaunchItem {
  return {
    id,
    label: id,
    disabled: false,
    panelKind: id === "terminal" ? "terminal" : "draft",
    launch: vi.fn(),
  };
}

describe("vertical tab quick launch actions", () => {
  it("keeps common creation actions visible and leaves supporting panels in the menu", () => {
    const groups: WorkspaceTabLaunchGroup[] = [
      {
        id: "tabs",
        label: null,
        items: [
          launchItem("agent"),
          launchItem("terminal"),
          launchItem("changes"),
          launchItem("files"),
          launchItem("browser"),
        ],
      },
    ];

    expect(getWorkspaceVerticalQuickLaunchItems(groups).map((item) => item.id)).toEqual([
      "agent",
      "terminal",
      "browser",
    ]);
  });
});
