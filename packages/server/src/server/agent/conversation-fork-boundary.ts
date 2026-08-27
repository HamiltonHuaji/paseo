import type { AgentTimelineRow } from "./agent-timeline-store-types.js";

export interface ConversationForkSource {
  agentId: string;
  boundaryCursor?: { epoch: string; seq: number };
  boundaryMessageId?: string;
}

export interface ConversationForkBoundary {
  boundaryMessageId: string;
  isLatestCompletedTurn: boolean;
}

export function resolveConversationForkBoundary(input: {
  source: ConversationForkSource;
  epoch: string;
  rows: readonly AgentTimelineRow[];
  sourceHasActiveTurn: boolean;
}): ConversationForkBoundary {
  const { source, epoch, rows } = input;
  if (source.boundaryCursor && source.boundaryCursor.epoch !== epoch) {
    throw new Error("The selected message belongs to a stale conversation timeline");
  }

  const boundaryRow = source.boundaryCursor
    ? rows.find((row) => row.seq === source.boundaryCursor?.seq)
    : rows.findLast(
        (row) =>
          row.item.type === "assistant_message" && row.item.messageId === source.boundaryMessageId,
      );
  if (boundaryRow?.item.type !== "assistant_message" || !boundaryRow.item.messageId) {
    throw new Error("The selected message does not map to a completed assistant response");
  }
  if (source.boundaryMessageId && source.boundaryMessageId !== boundaryRow.item.messageId) {
    throw new Error("The selected message no longer matches its conversation timeline position");
  }

  const hasLaterConversationMessage = rows.some(
    (row) =>
      row.seq > boundaryRow.seq &&
      (row.item.type === "user_message" ||
        (row.item.type === "assistant_message" && Boolean(row.item.messageId))),
  );
  return {
    boundaryMessageId: boundaryRow.item.messageId,
    isLatestCompletedTurn: !input.sourceHasActiveTurn && !hasLaterConversationMessage,
  };
}
