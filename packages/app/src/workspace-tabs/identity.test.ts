import { describe, expect, test } from "vitest";
import {
  buildDeterministicWorkspaceTabId,
  normalizeWorkspaceTabTarget,
  workspaceTabTargetsEqual,
} from "./identity";

describe("provider subagent tab identity", () => {
  test("normalizes and compares the parent and provider child as one tab identity", () => {
    const target = normalizeWorkspaceTabTarget({
      kind: "provider_subagent",
      parentAgentId: " parent-a ",
      subagentId: " child-a ",
    });

    expect(target).toEqual({
      kind: "provider_subagent",
      parentAgentId: "parent-a",
      subagentId: "child-a",
    });
    expect(
      target &&
        workspaceTabTargetsEqual(target, {
          kind: "provider_subagent",
          parentAgentId: "parent-a",
          subagentId: "child-a",
        }),
    ).toBe(true);
  });

  test("does not collide when parent and child ids contain separators", () => {
    const first = buildDeterministicWorkspaceTabId({
      kind: "provider_subagent",
      parentAgentId: "a_b",
      subagentId: "c",
    });
    const second = buildDeterministicWorkspaceTabId({
      kind: "provider_subagent",
      parentAgentId: "a",
      subagentId: "b_c",
    });

    expect(first).not.toBe(second);
  });
});

describe("native conversation fork draft identity", () => {
  test("normalizes and compares the source host, agent, and timeline boundary", () => {
    const target = normalizeWorkspaceTabTarget({
      kind: "draft",
      draftId: "draft-1",
      setup: {
        provider: "codex",
        cwd: "/repo",
        modeId: null,
        model: null,
        thinkingOptionId: null,
        featureValues: {},
        forkFrom: {
          serverId: " server-1 ",
          agentId: " agent-1 ",
          boundaryCursor: { epoch: " epoch-1 ", seq: 7 },
          boundaryMessageId: " assistant-1 ",
        },
      },
    });

    expect(target).toEqual({
      kind: "draft",
      draftId: "draft-1",
      setup: {
        provider: "codex",
        cwd: "/repo",
        modeId: null,
        model: null,
        thinkingOptionId: null,
        featureValues: {},
        forkFrom: {
          serverId: "server-1",
          agentId: "agent-1",
          boundaryCursor: { epoch: "epoch-1", seq: 7 },
          boundaryMessageId: "assistant-1",
        },
      },
    });
  });
});
