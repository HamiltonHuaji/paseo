import { describe, expect, test, vi } from "vitest";
import {
  CodexAppServerAgentSession,
  findCodexTurnIdContainingItem,
  resolveCodexForkLastTurnId,
} from "../codex-app-server-agent.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentSession, AgentSessionConfig } from "../../agent-sdk-types.js";

type ForkTestSession = AgentSession & {
  connected: boolean;
  currentThreadId: string | null;
  activeForegroundTurnId: string | null;
  client: {
    request(method: string, params?: unknown): Promise<unknown>;
    notify(): void;
    dispose(): Promise<void>;
  } | null;
};

function createForkTestSession(request: NonNullable<ForkTestSession["client"]>) {
  const session = new CodexAppServerAgentSession(
    { provider: "codex", cwd: "/source", modeId: "auto", model: "gpt-5.4" },
    null,
    createTestLogger(),
    () => {
      throw new Error("test must not spawn Codex");
    },
  ) as ForkTestSession;
  session.connected = true;
  session.currentThreadId = "thread-source";
  session.activeForegroundTurnId = null;
  session.client = request;
  return session;
}

function forkResponse() {
  return {
    thread: { id: "thread-fork" },
    model: "gpt-5.4",
    modelProvider: "openai",
    serviceTier: null,
    cwd: "/target",
    runtimeWorkspaceRoots: [],
    instructionSources: [],
    approvalPolicy: {},
    approvalsReviewer: null,
    sandbox: {},
  };
}

const targetConfig: AgentSessionConfig = {
  provider: "codex",
  cwd: "/target",
  modeId: "auto",
  model: "gpt-5.4",
};

describe("Codex conversation fork boundaries", () => {
  test("maps a historical assistant item to its containing Codex turn", () => {
    expect(
      findCodexTurnIdContainingItem(
        [
          { id: "turn-1", items: [{ id: "user-1" }, { id: "assistant-1" }] },
          { id: "turn-2", items: [{ id: "assistant-2" }] },
        ],
        "assistant-1",
      ),
    ).toBe("turn-1");
  });

  test("omits lastTurnId without reading history for the latest completed turn", async () => {
    const requestThread = vi.fn();

    await expect(
      resolveCodexForkLastTurnId({
        threadId: "thread-1",
        boundaryMessageId: "assistant-latest",
        isLatestCompletedTurn: true,
        requestThread,
      }),
    ).resolves.toBeUndefined();
    expect(requestThread).not.toHaveBeenCalled();
  });

  test("reads history once for a historical boundary", async () => {
    const requestThread = vi.fn().mockResolvedValue({
      thread: {
        turns: [{ id: "turn-1", items: [{ id: "assistant-1" }] }],
      },
    });

    await expect(
      resolveCodexForkLastTurnId({
        threadId: "thread-1",
        boundaryMessageId: "assistant-1",
        isLatestCompletedTurn: false,
        requestThread,
      }),
    ).resolves.toBe("turn-1");
    expect(requestThread).toHaveBeenCalledOnce();
  });

  test("sends latest forks directly without thread/read or lastTurnId", async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const session = createForkTestSession({
      request: async (method, params) => {
        requests.push({ method, params });
        return forkResponse();
      },
      notify: () => {},
      dispose: async () => {},
    });

    await session.forkConversation?.({
      boundaryMessageId: "assistant-latest",
      isLatestCompletedTurn: true,
      targetConfig,
    });

    expect(requests).toEqual([
      {
        method: "thread/fork",
        params: {
          threadId: "thread-source",
          cwd: "/target",
          model: "gpt-5.4",
          serviceTier: null,
          excludeTurns: false,
        },
      },
    ]);
  });

  test("maps historical items before sending lastTurnId", async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const session = createForkTestSession({
      request: async (method, params) => {
        requests.push({ method, params });
        if (method === "thread/read") {
          return {
            thread: {
              turns: [{ id: "turn-1", items: [{ id: "assistant-1" }] }],
            },
          };
        }
        return forkResponse();
      },
      notify: () => {},
      dispose: async () => {},
    });

    await session.forkConversation?.({
      boundaryMessageId: "assistant-1",
      isLatestCompletedTurn: false,
      targetConfig,
    });

    expect(requests).toEqual([
      {
        method: "thread/read",
        params: { threadId: "thread-source", includeTurns: true },
      },
      {
        method: "thread/fork",
        params: expect.objectContaining({ lastTurnId: "turn-1" }),
      },
    ]);
  });

  test("requires the current turn to finish before forking", async () => {
    const request = vi.fn();
    const session = createForkTestSession({
      request,
      notify: () => {},
      dispose: async () => {},
    });
    session.activeForegroundTurnId = "turn-running";

    await expect(
      session.forkConversation?.({
        boundaryMessageId: "assistant-running",
        isLatestCompletedTurn: true,
        targetConfig,
      }),
    ).rejects.toThrow(/Wait for the current turn to finish/u);
    expect(request).not.toHaveBeenCalled();
  });

  test("detects a selected message inside the running turn after mapping it", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "thread/read") {
        return {
          thread: {
            turns: [{ id: "turn-running", items: [{ id: "assistant-running" }] }],
          },
        };
      }
      return forkResponse();
    });
    const session = createForkTestSession({
      request,
      notify: () => {},
      dispose: async () => {},
    });
    session.activeForegroundTurnId = "turn-running";

    await expect(
      session.forkConversation?.({
        boundaryMessageId: "assistant-running",
        isLatestCompletedTurn: false,
        targetConfig,
      }),
    ).rejects.toThrow(/Wait for the current turn to finish/u);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("thread/read", {
      threadId: "thread-source",
      includeTurns: true,
    });
  });

  test("allows an earlier completed turn while a newer turn is running", async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const session = createForkTestSession({
      request: async (method, params) => {
        requests.push({ method, params });
        if (method === "thread/read") {
          return {
            thread: {
              turns: [
                { id: "turn-complete", items: [{ id: "assistant-complete" }] },
                { id: "turn-running", items: [{ id: "assistant-running" }] },
              ],
            },
          };
        }
        return forkResponse();
      },
      notify: () => {},
      dispose: async () => {},
    });
    session.activeForegroundTurnId = "turn-running";

    await session.forkConversation?.({
      boundaryMessageId: "assistant-complete",
      isLatestCompletedTurn: false,
      targetConfig,
    });

    expect(requests.at(-1)).toEqual({
      method: "thread/fork",
      params: expect.objectContaining({ lastTurnId: "turn-complete" }),
    });
  });
});
