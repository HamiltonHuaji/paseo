import { describe, expect, test } from "vitest";

import type { CodexThreadForkParams, CodexThreadForkResponse } from "./app-server-transport.js";
import { type CodexRewindClient, revertCodexConversation } from "./rewind.js";

class FakeCodex implements CodexRewindClient {
  readonly recordedForks: CodexThreadForkParams[] = [];

  async forkThread(params: CodexThreadForkParams): Promise<CodexThreadForkResponse> {
    this.recordedForks.push(params);
    return {
      thread: {
        id: "forked-thread",
        sessionId: "forked-session",
        forkedFromId: params.threadId,
        turns: [],
      },
      model: "gpt-5.4-mini",
      modelProvider: "openai",
      serviceTier: null,
      cwd: "/workspace/project",
      runtimeWorkspaceRoots: [],
      instructionSources: [],
      approvalPolicy: "on-request",
      approvalsReviewer: null,
      sandbox: { type: "workspaceWrite", networkAccess: false },
      activePermissionProfile: null,
      reasoningEffort: null,
    };
  }

  request(): Promise<unknown> {
    throw new Error("FakeCodex uses typed thread methods");
  }
}

describe("Codex Rewind", () => {
  test("rewinds the conversation by forking before the native user message turn", async () => {
    const codex = new FakeCodex();
    let reboundThreadId: string | null = null;

    await revertCodexConversation({
      client: codex,
      threadId: "source-thread",
      beforeTurnId: "turn-first",
      cwd: "/workspace/project",
      model: "gpt-5.4-mini",
      serviceTier: null,
      setThreadId: (threadId) => {
        reboundThreadId = threadId;
      },
    });

    expect(codex.recordedForks).toEqual([
      {
        threadId: "source-thread",
        beforeTurnId: "turn-first",
        cwd: "/workspace/project",
        model: "gpt-5.4-mini",
        serviceTier: null,
        excludeTurns: true,
      },
    ]);
    expect(reboundThreadId).toBe("forked-thread");
  });

  test("rebinds the Paseo session to the returned fork thread", async () => {
    const codex = new FakeCodex();
    let reboundThreadId: string | null = null;

    await revertCodexConversation({
      client: codex,
      threadId: "source-thread",
      beforeTurnId: "turn-second",
      setThreadId: (threadId) => {
        reboundThreadId = threadId;
      },
    });

    expect(codex.recordedForks[0]?.beforeTurnId).toBe("turn-second");
    expect(reboundThreadId).toBe("forked-thread");
  });

  test("declines to rewind when the Codex thread is unavailable", async () => {
    const codex = new FakeCodex();

    await expect(
      revertCodexConversation({
        client: codex,
        threadId: null,
        beforeTurnId: "turn-first",
        setThreadId: () => undefined,
      }),
    ).rejects.toThrow("Codex thread is not ready for rewind");
    expect(codex.recordedForks).toEqual([]);
  });
});
