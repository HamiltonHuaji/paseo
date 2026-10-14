import { describe, expect, it } from "vitest";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import {
  getWorkspaceNamingAttachments,
  remapDraftCwdToWorkspace,
} from "./new-workspace-fork-context";

describe("remapDraftCwdToWorkspace", () => {
  it("preserves a Windows subdirectory when source path casing differs", () => {
    expect(
      remapDraftCwdToWorkspace({
        cwd: "c:\\Repo\\packages\\app",
        sourceDirectory: "C:\\Repo",
        workspaceDirectory: "D:\\Worktrees\\fork",
      }),
    ).toBe("D:\\Worktrees\\fork\\packages\\app");
  });

  it("falls back to the workspace root when the cwd is outside the source directory", () => {
    expect(
      remapDraftCwdToWorkspace({
        cwd: "/other/repo/packages/app",
        sourceDirectory: "/repo",
        workspaceDirectory: "/worktrees/fork",
      }),
    ).toBe("/worktrees/fork");
  });
});

describe("getWorkspaceNamingAttachments", () => {
  it("removes full chat history from workspace naming context", () => {
    const chatHistory = {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Chat history",
      text: "Long prior conversation",
    } satisfies AgentAttachment;
    const prContext = {
      type: "github_pr",
      mimeType: "application/github-pr",
      number: 1788,
      title: "Fork assistant turns into new drafts",
      url: "https://github.com/getpaseo/paseo/pull/1788",
    } satisfies AgentAttachment;

    expect(getWorkspaceNamingAttachments([chatHistory, prContext])).toEqual([prContext]);
  });
});

import { resolveForkPreparation } from "@/agent-stream/fork-preparation";

describe("native fork capability gating", () => {
  it("allows Codex on a capable host even when a stored source projection lacks the optional flag", () => {
    expect(
      resolveForkPreparation({
        provider: "codex",
        sourceSupportsNative: false,
        daemonSupportsNative: true,
        daemonSupportsContext: true,
      }),
    ).toEqual({ mode: "native" });
  });
  it("keeps a host without the native fork RPC unavailable", () => {
    expect(
      resolveForkPreparation({
        provider: "codex",
        sourceSupportsNative: true,
        daemonSupportsNative: false,
        daemonSupportsContext: true,
      }),
    ).toEqual({ errorKey: "message.actions.forkNativeUnavailable" });
  });
  it("retains context forks for providers without native support", () => {
    expect(
      resolveForkPreparation({
        provider: "claude",
        sourceSupportsNative: false,
        daemonSupportsNative: true,
        daemonSupportsContext: true,
      }),
    ).toEqual({ mode: "context_attachment" });
  });
});
