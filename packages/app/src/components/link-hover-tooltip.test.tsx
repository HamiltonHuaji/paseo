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

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: (theme: unknown) => unknown) =>
      factory({
        spacing: [0, 4],
        colors: { foreground: "#000", foregroundMuted: "#666" },
        fontSize: { sm: 12 },
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
  });
});
