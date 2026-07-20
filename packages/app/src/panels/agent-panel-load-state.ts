import type { AgentScreenMissingState } from "@/hooks/use-agent-screen-state-machine";

export function reconcileMissingAgentStateWithPresentAgent(
  state: AgentScreenMissingState,
): AgentScreenMissingState {
  if (state.kind === "resolving" || state.kind === "not_found") {
    return { kind: "idle" };
  }
  return state;
}

export function clearHistorySyncErrorAfterSuccessfulSync(
  state: AgentScreenMissingState,
): AgentScreenMissingState {
  if (state.kind === "error") {
    return { kind: "idle" };
  }
  return state;
}

export type AgentHistoryLoadStatus =
  | "connecting"
  | "reconnecting"
  | "waiting_for_data"
  | "receiving_data";

export function resolveAgentHistoryLoadStatus(input: {
  connectionStatus: "idle" | "connecting" | "online" | "offline" | "error";
  pagesReceived: number;
}): AgentHistoryLoadStatus {
  if (input.connectionStatus === "online") {
    return input.pagesReceived > 0 ? "receiving_data" : "waiting_for_data";
  }
  if (input.connectionStatus === "idle" || input.connectionStatus === "connecting") {
    return "connecting";
  }
  return "reconnecting";
}
