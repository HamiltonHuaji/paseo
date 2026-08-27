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
  currentTurnId: string | null;
  client: {
    request(method: string, params?: unknown): Promise<unknown>;
    notify(): void;
    dispose(): Promise<void>;
  } | null;
  forkFromConversation(
    source: AgentSession,
    input: {
      boundaryMessageId: string;
      isLatestCompletedTurn: boolean;
      targetConfig: AgentSessionConfig;
    },
  ): Promise<void>;
};

const targetConfig: AgentSessionConfig = {
  provider: "codex",
  cwd: "/target",
  modeId: "auto",
  model: "gpt-5.4",
};

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

function createSessions(
  targetRequest: ForkTestSession["client"],
  sourceRequest: NonNullable<ForkTestSession["client"]>["request"] = async () => {
    throw new Error("unexpected source request");
  },
) {
  const spawn = () => {
    throw new Error("test must not spawn Codex");
  };
  const source = new CodexAppServerAgentSession(
    { provider: "codex", cwd: "/source", modeId: "auto", model: "gpt-5.4" },
    null,
    createTestLogger(),
    spawn,
  ) as unknown as ForkTestSession;
  source.connected = true;
  source.currentThreadId = "thread-source";
  source.client = { request: sourceRequest, notify: () => {}, dispose: async () => {} };

  const target = new CodexAppServerAgentSession(
    targetConfig,
    null,
    createTestLogger(),
    spawn,
  ) as unknown as ForkTestSession;
  target.connected = true;
  target.client = targetRequest;
  return { source, target };
}

describe("Codex conversation fork", () => {
  test("maps a provider item to its containing turn", () => {
    expect(
      findCodexTurnIdContainingItem(
        [
          { id: "turn-1", items: [{ id: "assistant-1" }] },
          { id: "turn-2", items: [{ id: "assistant-2" }] },
        ],
        "assistant-1",
      ),
    ).toBe("turn-1");
  });

  test("latest completed forks skip thread/read and lastTurnId", async () => {
    const requestThread = vi.fn();
    await expect(
      resolveCodexForkLastTurnId({
        threadId: "thread-source",
        boundaryMessageId: "assistant-latest",
        isLatestCompletedTurn: true,
        requestThread,
      }),
    ).resolves.toBeUndefined();
    expect(requestThread).not.toHaveBeenCalled();

    const requests: Array<{ method: string; params?: unknown }> = [];
    const { source, target } = createSessions({
      request: async (method, params) => {
        requests.push({ method, params });
        return forkResponse();
      },
      notify: () => {},
      dispose: async () => {},
    });
    await target.forkFromConversation(source, {
      boundaryMessageId: "assistant-latest",
      isLatestCompletedTurn: true,
      targetConfig,
    });
    expect(requests[0]).toEqual({
      method: "thread/fork",
      params: expect.not.objectContaining({ lastTurnId: expect.anything() }),
    });
  });

  test("historical forks read on the source and fork on the target", async () => {
    const sourceRequest = vi.fn(async () => ({
      thread: { turns: [{ id: "turn-1", items: [{ id: "assistant-1" }] }] },
    }));
    const targetRequest = vi.fn(async () => forkResponse());
    const { source, target } = createSessions(
      { request: targetRequest, notify: () => {}, dispose: async () => {} },
      sourceRequest,
    );
    await target.forkFromConversation(source, {
      boundaryMessageId: "assistant-1",
      isLatestCompletedTurn: false,
      targetConfig,
    });
    expect(sourceRequest).toHaveBeenCalledWith("thread/read", {
      threadId: "thread-source",
      includeTurns: true,
    });
    expect(targetRequest).toHaveBeenCalledWith(
      "thread/fork",
      expect.objectContaining({ threadId: "thread-source", lastTurnId: "turn-1" }),
    );
  });

  test("rejects the selected active turn but allows an older completed turn", async () => {
    const sourceRequest = vi.fn(async () => ({
      thread: {
        turns: [
          { id: "turn-complete", items: [{ id: "assistant-complete" }] },
          { id: "turn-running", items: [{ id: "assistant-running" }] },
        ],
      },
    }));
    const targetRequest = vi.fn(async () => forkResponse());
    const { source, target } = createSessions(
      { request: targetRequest, notify: () => {}, dispose: async () => {} },
      sourceRequest,
    );
    source.activeForegroundTurnId = "turn-running";
    source.currentTurnId = "turn-running";

    await expect(
      target.forkFromConversation(source, {
        boundaryMessageId: "assistant-running",
        isLatestCompletedTurn: false,
        targetConfig,
      }),
    ).rejects.toThrow(/Wait for the current turn to finish/u);

    await target.forkFromConversation(source, {
      boundaryMessageId: "assistant-complete",
      isLatestCompletedTurn: false,
      targetConfig,
    });
    expect(targetRequest).toHaveBeenCalledWith(
      "thread/fork",
      expect.objectContaining({ lastTurnId: "turn-complete" }),
    );
  });
});
