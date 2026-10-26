import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import type { AgentMode, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";

export function resolveAgentModeOptions(input: {
  status: AgentSnapshotPayload["status"] | undefined;
  availableModes: AgentMode[];
  provider: string | undefined;
  snapshotEntries: ProviderSnapshotEntry[] | undefined;
}): AgentMode[] {
  // Until the runtime is ready to supply modes, use the project's
  // provider catalog, including for records written before modes were persisted.
  if (input.status === "closed" || input.status === "initializing") {
    const entry = input.snapshotEntries?.find((candidate) => candidate.provider === input.provider);
    if (entry?.enabled && entry.status === "ready" && entry.modes) return entry.modes;
  }
  return input.availableModes;
}

export function resolveNextAgentModeId({
  modeOptions,
  selectedMode,
}: {
  modeOptions: readonly AgentMode[];
  selectedMode: string | null | undefined;
}): string | null {
  if (modeOptions.length < 2) return null;

  const selectedIndex = modeOptions.findIndex((mode) => mode.id === selectedMode);
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const nextIndex = (currentIndex + 1) % modeOptions.length;
  return modeOptions[nextIndex]?.id ?? null;
}

export function resolveAgentControlsMode(agentControls?: DraftAgentControlsProps) {
  return agentControls ? "draft" : "ready";
}
