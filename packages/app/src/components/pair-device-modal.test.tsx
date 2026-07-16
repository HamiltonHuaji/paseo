/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PairDeviceModal } from "./pair-device-modal";

const state = vi.hoisted(() => ({ renderedServerIds: [] as string[] }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    visible,
    children,
    testID,
  }: {
    visible: boolean;
    children?: React.ReactNode;
    testID?: string;
  }) =>
    visible
      ? React.createElement("div", { "data-testid": testID ?? "pair-device-modal" }, children)
      : null,
}));

vi.mock("./pair-device-section", () => ({
  PairDeviceSection: ({ serverId }: { serverId: string }) => {
    state.renderedServerIds.push(serverId);
    return React.createElement("div", { "data-testid": "pair-device-section" });
  },
}));

afterEach(() => {
  cleanup();
  state.renderedServerIds.length = 0;
});

describe("PairDeviceModal", () => {
  it("does not mount the pairing offer surface until the user opens it", () => {
    const { rerender } = render(
      <PairDeviceModal serverId="host-1" visible={false} onClose={vi.fn()} />,
    );

    expect(screen.queryByTestId("pair-device-section")).toBeNull();
    expect(state.renderedServerIds).toEqual([]);

    rerender(<PairDeviceModal serverId="host-1" visible onClose={vi.fn()} />);

    expect(screen.getByTestId("pair-device-section")).not.toBeNull();
    expect(state.renderedServerIds).toEqual(["host-1"]);
  });
});
