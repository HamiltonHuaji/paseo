import { describe, expect, it } from "vitest";
import {
  MIN_LEFT_WORKSPACE_TAB_PANE_WIDTH,
  MIN_WORKSPACE_TAB_CONTENT_WIDTH,
  resolveWorkspaceTabPlacement,
  WORKSPACE_TAB_RAIL_WIDTH,
} from "@/screens/workspace/workspace-tab-placement";

describe("resolveWorkspaceTabPlacement", () => {
  it("uses the dropdown in compact layouts", () => {
    expect(
      resolveWorkspaceTabPlacement({
        isCompact: true,
        isWeb: true,
        paneWidth: 1200,
        preference: "left",
      }),
    ).toBe("dropdown");
  });

  it("uses top tabs on non-web platforms", () => {
    expect(
      resolveWorkspaceTabPlacement({
        isCompact: false,
        isWeb: false,
        paneWidth: 1200,
        preference: "left",
      }),
    ).toBe("top");
  });

  it("honors the top preference on wide web panes", () => {
    expect(
      resolveWorkspaceTabPlacement({
        isCompact: false,
        isWeb: true,
        paneWidth: 1200,
        preference: "top",
      }),
    ).toBe("top");
  });

  it("uses left tabs at the minimum supported web pane width", () => {
    expect(MIN_LEFT_WORKSPACE_TAB_PANE_WIDTH).toBe(
      WORKSPACE_TAB_RAIL_WIDTH + MIN_WORKSPACE_TAB_CONTENT_WIDTH,
    );
    expect(
      resolveWorkspaceTabPlacement({
        isCompact: false,
        isWeb: true,
        paneWidth: MIN_LEFT_WORKSPACE_TAB_PANE_WIDTH,
        preference: "left",
      }),
    ).toBe("left");
  });

  it("falls back to top one pixel below the minimum web pane width", () => {
    expect(
      resolveWorkspaceTabPlacement({
        isCompact: false,
        isWeb: true,
        paneWidth: MIN_LEFT_WORKSPACE_TAB_PANE_WIDTH - 1,
        preference: "left",
      }),
    ).toBe("top");
  });
});
