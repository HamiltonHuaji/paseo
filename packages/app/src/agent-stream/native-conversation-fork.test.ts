import { describe, expect, it } from "vitest";
import {
  assertNativeConversationForkHost,
  buildNativeConversationForkCreateOptions,
} from "./native-conversation-fork";

describe("native conversation fork launch", () => {
  it("builds a prompt-free create request with the selected completed boundary", () => {
    const request = buildNativeConversationForkCreateOptions({
      workspaceId: "workspace-1",
      sourceTitle: "  Source conversation  ",
      setup: {
        provider: "codex",
        cwd: "/workspace/project",
        modeId: "full-access",
        model: "gpt-5.6-sol",
        thinkingOptionId: "high",
        featureValues: { fast_mode: true },
      },
      forkFrom: {
        serverId: "server-1",
        agentId: "source-agent",
        boundaryCursor: { epoch: "epoch-1", seq: 42 },
        boundaryMessageId: "assistant-42",
      },
    });

    expect(request).toEqual({
      config: {
        provider: "codex",
        cwd: "/workspace/project",
        modeId: "full-access",
        model: "gpt-5.6-sol",
        thinkingOptionId: "high",
        featureValues: { fast_mode: true },
        title: "Source conversation",
      },
      workspaceId: "workspace-1",
      forkFrom: {
        agentId: "source-agent",
        boundaryCursor: { epoch: "epoch-1", seq: 42 },
        boundaryMessageId: "assistant-42",
      },
    });
    expect(request).not.toHaveProperty("initialPrompt");
    expect(request).not.toHaveProperty("clientMessageId");
  });

  it("rejects moving a native provider conversation to another host", () => {
    expect(() =>
      assertNativeConversationForkHost({
        forkFrom: { serverId: "server-a", agentId: "agent-a" },
        serverId: "server-b",
        errorMessage: "same host",
      }),
    ).toThrow("same host");
  });
});
