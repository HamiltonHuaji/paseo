import type { AgentTimelineRow } from "./agent-timeline-store-types.js";

export function resolveConversationForkCursor(input: {
  cursor?: { epoch: string; seq: number };
  epoch: string;
  rows: readonly AgentTimelineRow[];
}): string {
  const { cursor, epoch, rows } = input;
  if (cursor && cursor.epoch !== epoch) {
    throw new Error("The selected message belongs to a stale conversation timeline");
  }
  const boundaryRow = cursor ? rows.find((row) => row.seq === cursor.seq) : undefined;
  if (boundaryRow?.item.type !== "assistant_message" || !boundaryRow.item.messageId) {
    throw new Error("The selected message does not map to a completed assistant response");
  }
  return boundaryRow.item.messageId;
}
