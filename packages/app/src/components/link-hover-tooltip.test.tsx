/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LinkHoverTooltip } from "./link-hover-tooltip";

vi.mock("@/constants/platform", () => ({
  isWeb: true,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/ui/shortcut", () => ({
  Shortcut: () => "shortcut",
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: (theme: unknown) => unknown) =>
      factory({
        spacing: [0, 4],
        colors: { foreground: "#000", foregroundMuted: "#666" },
        fontSize: { xs: 12 },
        fontWeight: { normal: "400" },
      }),
  },
}));

describe("LinkHoverTooltip", () => {
  it("renders the external target so it can be inspected and selected", () => {
    render(
      <LinkHoverTooltip target="https://example.com/private/path?mode=review">
        <span>review</span>
      </LinkHoverTooltip>,
    );

    expect(screen.getByText("https://example.com/private/path?mode=review")).toBeTruthy();
    expect(screen.queryByText("click for side pane")).toBeNull();
  });

  it("keeps the file-only shortcut hint opt-in", () => {
    render(
      <LinkHoverTooltip target="packages/app/src/app.tsx" showFileShortcutHint>
        <span>app.tsx</span>
      </LinkHoverTooltip>,
    );

    expect(screen.getByText("packages/app/src/app.tsx")).toBeTruthy();
    expect(screen.getByText("click for side pane")).toBeTruthy();
  });
});
