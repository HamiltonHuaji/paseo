import { describe, expect, it } from "vitest";
import type { AgentMode, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { resolveAgentControlsMode, resolveAgentModeOptions, resolveNextAgentModeId } from "./mode";

const PLAN_MODE = { id: "plan", label: "Plan" } satisfies AgentMode;

const MODES = [
  PLAN_MODE,
  { id: "build", label: "Build" },
  { id: "full-access", label: "Full Access" },
] satisfies AgentMode[];

describe("dormant agent modes", () => {
  const entry: ProviderSnapshotEntry = {
    provider: "codex",
    status: "ready",
    enabled: true,
    modes: MODES,
  };
  const input = { provider: "codex", availableModes: [], snapshotEntries: [entry] };

  it("shows modes for an old stored conversation without waiting for a new turn", () => {
    expect(resolveAgentModeOptions({ ...input, status: "closed" })).toEqual(MODES);
    expect(resolveAgentModeOptions({ ...input, status: "initializing" })).toEqual(MODES);
    expect(
      resolveAgentModeOptions({ ...input, status: "closed", provider: "custom-codex" }),
    ).toEqual([]);
  });

  it("keeps known modes while discovery loads and respects a ready catalog removing them", () => {
    expect(
      resolveAgentModeOptions({
        ...input,
        status: "closed",
        availableModes: MODES,
        snapshotEntries: undefined,
      }),
    ).toEqual(MODES);
    expect(
      resolveAgentModeOptions({
        ...input,
        status: "closed",
        availableModes: MODES,
        snapshotEntries: [{ ...entry, status: "loading", modes: undefined }],
      }),
    ).toEqual(MODES);
    expect(
      resolveAgentModeOptions({
        ...input,
        status: "closed",
        availableModes: MODES,
        snapshotEntries: [{ ...entry, modes: [] }],
      }),
    ).toEqual([]);
  });

  it("leaves live runtime modes authoritative, including an empty list", () => {
    expect(resolveAgentModeOptions({ ...input, status: "idle" })).toEqual([]);
    expect(
      resolveAgentModeOptions({ ...input, status: "running", availableModes: [PLAN_MODE] }),
    ).toEqual([PLAN_MODE]);
  });
});

describe("resolveAgentControlsMode", () => {
  it("uses ready mode when no controlled agent controls are provided", () => {
    expect(resolveAgentControlsMode(undefined)).toBe("ready");
  });

  it("uses draft mode when controlled agent controls are provided", () => {
    expect(
      resolveAgentControlsMode({
        providerDefinitions: [],
        selectedProvider: "codex",
        modeOptions: [],
        selectedMode: "",
        onSelectMode: () => undefined,
        models: [],
        selectedModel: "",
        onSelectModel: () => undefined,
        isModelLoading: false,
        modelSelectorProviders: [],
        isAllModelsLoading: false,
        onSelectProviderAndModel: () => undefined,
        thinkingOptions: [],
        selectedThinkingOptionId: "",
        onSelectThinkingOption: () => undefined,
        onApplyAgentProfile: () => undefined,
      }),
    ).toBe("draft");
  });
});

describe("resolveNextAgentModeId", () => {
  it("cycles from the selected mode to the next mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "build" })).toBe(
      "full-access",
    );
  });

  it("wraps from the last mode to the first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "full-access" })).toBe(
      "plan",
    );
  });

  it("treats an empty selection as the visible first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "" })).toBe("build");
  });

  it("treats a stale selection as the visible first mode", () => {
    expect(resolveNextAgentModeId({ modeOptions: MODES, selectedMode: "deleted-mode" })).toBe(
      "build",
    );
  });

  it("returns null when there are fewer than two modes", () => {
    expect(resolveNextAgentModeId({ modeOptions: [], selectedMode: "" })).toBeNull();
    expect(resolveNextAgentModeId({ modeOptions: [PLAN_MODE], selectedMode: "plan" })).toBeNull();
  });
});
