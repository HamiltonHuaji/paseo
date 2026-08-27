import type { StreamItem } from "@/types/stream";

export type ActiveTurnActivityPhase = "thinking" | "waiting";

function toolCallIdentity(item: Extract<StreamItem, { kind: "tool_call" }>): string {
  return item.payload.source === "agent"
    ? `agent:${item.payload.data.callId}`
    : `orchestrator:${item.payload.data.toolCallId}`;
}

function isRunningToolCall(item: Extract<StreamItem, { kind: "tool_call" }>): boolean {
  return item.payload.source === "agent"
    ? item.payload.data.status === "running"
    : item.payload.data.status === "executing";
}

/**
 * Derives the foreground turn's presentation from its latest timeline facts.
 * The reverse scan lets a terminal update supersede an earlier running copy of
 * the same tool without requiring the renderer to mutate timeline history.
 */
export function deriveActiveTurnActivityPhase(input: {
  tail: readonly StreamItem[];
  head: readonly StreamItem[];
  hasPendingPermission: boolean;
}): ActiveTurnActivityPhase {
  if (input.hasPendingPermission) {
    return "waiting";
  }

  const items = [...input.tail, ...input.head];
  const terminalToolCallIds = new Set<string>();
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind === "user_message") {
      break;
    }
    if (item.kind === "assistant_message" || item.kind === "thought") {
      return "thinking";
    }
    if (item.kind !== "tool_call") {
      continue;
    }

    const identity = toolCallIdentity(item);
    if (!isRunningToolCall(item)) {
      terminalToolCallIds.add(identity);
      continue;
    }
    if (!terminalToolCallIds.has(identity)) {
      return "waiting";
    }
  }
  return "thinking";
}
