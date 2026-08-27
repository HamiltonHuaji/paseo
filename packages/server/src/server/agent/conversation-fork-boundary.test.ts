import { describe, expect, test } from "vitest";
import { resolveConversationForkBoundary } from "./conversation-fork-boundary.js";

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
  test("marks the final completed assistant turn as the latest fast path", () => {
    expect(
      resolveConversationForkBoundary({
        source: {
          agentId: "agent-1",
          boundaryCursor: { epoch: "epoch-1", seq: 2 },
          boundaryMessageId: "assistant-2",
        },
        epoch: "epoch-1",
        rows,
        sourceHasActiveTurn: false,
      }),
    ).toEqual({ boundaryMessageId: "assistant-2", isLatestCompletedTurn: true });
  });

  test("uses native turn mapping while a newer turn is active", () => {
    expect(
      resolveConversationForkBoundary({
        source: { agentId: "agent-1", boundaryMessageId: "assistant-2" },
        epoch: "epoch-1",
        rows,
        sourceHasActiveTurn: true,
      }),
    ).toEqual({ boundaryMessageId: "assistant-2", isLatestCompletedTurn: false });
  });

  test("ignores non-message rows after the final completed assistant", () => {
    expect(
      resolveConversationForkBoundary({
        source: { agentId: "agent-1", boundaryMessageId: "assistant-2" },
        epoch: "epoch-1",
        rows: [
          ...rows,
          {
            seq: 3,
            timestamp: "2026-01-01T00:00:02.000Z",
            item: { type: "reasoning" as const, text: "turn tail" },
          },
        ],
        sourceHasActiveTurn: false,
      }),
    ).toEqual({ boundaryMessageId: "assistant-2", isLatestCompletedTurn: true });
  });

  test("does not use the fast path before a newer user turn", () => {
    expect(
      resolveConversationForkBoundary({
        source: { agentId: "agent-1", boundaryMessageId: "assistant-2" },
        epoch: "epoch-1",
        rows: [
          ...rows,
          {
            seq: 3,
            timestamp: "2026-01-01T00:00:02.000Z",
            item: { type: "user_message" as const, text: "new turn" },
          },
        ],
        sourceHasActiveTurn: false,
      }),
    ).toEqual({ boundaryMessageId: "assistant-2", isLatestCompletedTurn: false });
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
        sourceHasActiveTurn: false,
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
        sourceHasActiveTurn: false,
      }),
    ).toThrow(/no longer matches/u);
  });
});
