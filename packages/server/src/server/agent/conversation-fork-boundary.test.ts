import { describe, expect, test } from "vitest";
import { resolveConversationForkBoundary } from "./agent-manager.js";

const rows = [
  {
    seq: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
    item: { type: "assistant_message" as const, text: "first", messageId: "assistant-1" },
  },
  {
    seq: 2,
    timestamp: "2026-01-01T00:00:01.000Z",
    item: { type: "assistant_message" as const, text: "latest", messageId: "assistant-2" },
  },
];

describe("Paseo conversation fork boundary", () => {
  test("marks only the final authoritative row as the latest fast path", () => {
    expect(
      resolveConversationForkBoundary({
        source: {
          agentId: "agent-1",
          boundaryCursor: { epoch: "epoch-1", seq: 2 },
          boundaryMessageId: "assistant-2",
        },
        epoch: "epoch-1",
        rows,
      }),
    ).toEqual({ boundaryMessageId: "assistant-2", isLatestCompletedTurn: true });

    expect(
      resolveConversationForkBoundary({
        source: { agentId: "agent-1", boundaryMessageId: "assistant-1" },
        epoch: "epoch-1",
        rows,
      }),
    ).toEqual({ boundaryMessageId: "assistant-1", isLatestCompletedTurn: false });
  });

  test("rejects stale cursors and cursor/message mismatches", () => {
    expect(() =>
      resolveConversationForkBoundary({
        source: {
          agentId: "agent-1",
          boundaryCursor: { epoch: "old", seq: 2 },
          boundaryMessageId: "assistant-2",
        },
        epoch: "epoch-1",
        rows,
      }),
    ).toThrow(/stale/u);

    expect(() =>
      resolveConversationForkBoundary({
        source: {
          agentId: "agent-1",
          boundaryCursor: { epoch: "epoch-1", seq: 2 },
          boundaryMessageId: "assistant-1",
        },
        epoch: "epoch-1",
        rows,
      }),
    ).toThrow(/no longer matches/u);
  });
});
