import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentConversationForkSource } from "@getpaseo/protocol/messages";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";

export interface NativeConversationForkHandoff extends AgentConversationForkSource {
  serverId: string;
}

export function toNativeConversationForkSource(
  source: NativeConversationForkHandoff | undefined,
): AgentConversationForkSource | undefined {
  if (!source) return undefined;
  return {
    agentId: source.agentId,
    ...(source.boundaryCursor ? { boundaryCursor: source.boundaryCursor } : {}),
    ...(source.boundaryMessageId ? { boundaryMessageId: source.boundaryMessageId } : {}),
  };
}

export function assertNativeConversationForkHost(input: {
  forkFrom: NativeConversationForkHandoff | undefined;
  serverId: string;
  errorMessage: string;
}): void {
  if (input.forkFrom && input.forkFrom.serverId !== input.serverId) {
    throw new Error(input.errorMessage);
  }
}

export function buildNativeConversationForkCreateOptions(input: {
  setup: WorkspaceDraftTabSetup;
  workspaceId: string;
  forkFrom: NativeConversationForkHandoff;
  sourceTitle?: string | null;
}): Parameters<DaemonClient["createAgent"]>[0] {
  const forkFrom = toNativeConversationForkSource(input.forkFrom);
  return {
    config: {
      ...buildWorkspaceDraftAgentConfig({
        provider: input.setup.provider,
        cwd: input.setup.cwd,
        ...(input.setup.modeId ? { modeId: input.setup.modeId } : {}),
        ...(input.setup.model ? { model: input.setup.model } : {}),
        ...(input.setup.thinkingOptionId ? { thinkingOptionId: input.setup.thinkingOptionId } : {}),
        featureValues: input.setup.featureValues,
      }),
      ...(input.sourceTitle?.trim() ? { title: input.sourceTitle.trim() } : {}),
    },
    workspaceId: input.workspaceId,
    ...(forkFrom ? { forkFrom } : {}),
  };
}
