import { describe, expect, it } from "vitest";
import {
  MIN_LEFT_WORKSPACE_TAB_PANE_WIDTH,
  resolveWorkspaceTabPlacement,
} from "./workspace-tab-placement";

describe("resolveWorkspaceTabPlacement", () => {
  it("keeps compact layouts on the dropdown", () => {
    expect(
      resolveWorkspaceTabPlacement({
        isCompact: true,
        isWeb: true,
        paneWidth: 1200,
        preference: "left",
      }),
    ).toBe("dropdown");
  });

  it("keeps native non-compact layouts on top tabs", () => {
    expect(
      resolveWorkspaceTabPlacement({
        isCompact: false,
        isWeb: false,
        paneWidth: 1200,
        preference: "left",
      }),
    ).toBe("top");
  });

  it("honours the top preference at every desktop width", () => {
    expect(
      resolveWorkspaceTabPlacement({
        isCompact: false,
        isWeb: true,
        paneWidth: 1400,
        preference: "top",
      }),
    ).toBe("top");
  });

  it("uses the left rail only when the individual pane is wide enough", () => {
    const common = { isCompact: false, isWeb: true, preference: "left" as const };
    expect(
      resolveWorkspaceTabPlacement({
        ...common,
        paneWidth: MIN_LEFT_WORKSPACE_TAB_PANE_WIDTH - 1,
      }),
    ).toBe("top");
    expect(
      resolveWorkspaceTabPlacement({
        ...common,
        paneWidth: MIN_LEFT_WORKSPACE_TAB_PANE_WIDTH,
      }),
    ).toBe("left");
  });
});
