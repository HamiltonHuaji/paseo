import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

// The host may be an older daemon that hydrates history before answering its
// first bounded request. Keep the connection alive while it makes progress.
export const LIVE_HISTORY_FETCH_TIMEOUT_MS = 900_000;

interface FetchProjectedTimelineItemsInput {
  client: DaemonClient;
  agentId: string;
  timeoutMs?: number;
  sinceTimestampMs?: number;
  tail?: number;
  matches?: (item: AgentTimelineItem) => boolean;
}

export async function fetchProjectedTimelineItems(
  input: FetchProjectedTimelineItemsInput,
): Promise<AgentTimelineItem[]> {
  if (input.tail === 0) return [];
  let cursor: { epoch: string; seq: number } | undefined;
  const pages: AgentTimelineItem[][] = [];
  let count = 0;
  for (;;) {
    const timeline = await input.client.fetchAgentTimeline(input.agentId, {
      direction: cursor ? "before" : "tail",
      ...(cursor ? { cursor } : {}),
      limit: Math.min(input.tail ?? 200, 200),
      projection: "projected",
      timeout: input.timeoutMs ?? LIVE_HISTORY_FETCH_TIMEOUT_MS,
    });
    if (cursor && timeline.reset) {
      throw new Error("Timeline changed while reading history; run the command again");
    }
    const entries = timeline.entries.filter(
      (entry) =>
        (input.sinceTimestampMs === undefined ||
          Date.parse(entry.timestamp) >= input.sinceTimestampMs) &&
        (!input.matches || input.matches(entry.item)),
    );
    pages.unshift(entries.map((entry) => entry.item));
    count += entries.length;
    if (input.tail !== undefined && count >= input.tail) return pages.flat().slice(-input.tail);
    if (!timeline.hasOlder) return pages.flat();
    const next = timeline.startCursor;
    if (!next || (cursor && next.epoch === cursor.epoch && next.seq >= cursor.seq)) {
      throw new Error("Host returned a history page without an older continuation");
    }
    cursor = next;
  }
}
