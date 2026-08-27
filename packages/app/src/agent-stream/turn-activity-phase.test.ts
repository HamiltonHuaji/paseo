import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { deriveActiveTurnActivityPhase } from "./turn-activity-phase";

const timestamp = new Date("2026-08-21T10:00:00.000Z");

function user(id: string): StreamItem {
  return { kind: "user_message", id, text: "Run the experiment", timestamp };
}

function assistant(id: string): StreamItem {
  return { kind: "assistant_message", id, text: "I will check it.", timestamp };
}

function thought(id: string): StreamItem {
  return { kind: "thought", id, text: "Checking the result", timestamp, status: "loading" };
}

function tool(callId: string, status: "running" | "completed" | "failed" | "canceled"): StreamItem {
  return {
    kind: "tool_call",
    id: `tool:${callId}:${status}`,
    timestamp,
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId,
        name: "shell",
        status,
        error: status === "failed" ? { message: "failed" } : null,
        detail: { type: "shell", command: "sleep 3600" },
      },
    },
  };
}

describe("deriveActiveTurnActivityPhase", () => {
  it("shows waiting for a running tool in the active turn", () => {
    expect(
      deriveActiveTurnActivityPhase({
        tail: [user("user-1"), thought("thought-1")],
        head: [tool("sleep", "running")],
        hasPendingPermission: false,
      }),
    ).toBe("waiting");
  });

  it("uses the latest terminal update instead of a stale running copy", () => {
    expect(
      deriveActiveTurnActivityPhase({
        tail: [user("user-1"), tool("sleep", "running")],
        head: [tool("sleep", "canceled")],
        hasPendingPermission: false,
      }),
    ).toBe("thinking");
  });

  it("shows thinking when model activity follows an older running tool", () => {
    expect(
      deriveActiveTurnActivityPhase({
        tail: [user("user-1"), tool("background", "running")],
        head: [thought("thought-2"), assistant("assistant-1")],
        hasPendingPermission: false,
      }),
    ).toBe("thinking");
  });

  it("does not inspect a running tool from an earlier turn", () => {
    expect(
      deriveActiveTurnActivityPhase({
        tail: [tool("old", "running"), user("user-2")],
        head: [],
        hasPendingPermission: false,
      }),
    ).toBe("thinking");
  });

  it("shows waiting while permission is pending", () => {
    expect(
      deriveActiveTurnActivityPhase({
        tail: [user("user-1"), thought("thought-1")],
        head: [],
        hasPendingPermission: true,
      }),
    ).toBe("waiting");
  });
});
