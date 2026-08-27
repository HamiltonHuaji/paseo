import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import type {
  AgentForkContextOptions,
  DaemonClient,
} from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import type { AssistantForkTarget } from "@/components/assistant-fork-menu";
import type { ToastApi } from "@/components/toast-host";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { useStableEvent } from "@/hooks/use-stable-event";
import { useHostFeature } from "@/runtime/host-features";
import { generateDraftId } from "@/stores/draft-keys";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { toErrorMessage } from "@/utils/error-messages";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import type { WorkspaceDraftTabSetup, WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  CLIENT_SUPPORTS_NATIVE_CONVERSATION_FORK,
  resolveForkPreparation,
} from "@/agent-stream/fork-preparation";
import {
  buildNativeConversationForkCreateOptions,
  type NativeConversationForkHandoff,
} from "@/agent-stream/native-conversation-fork";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { upsertAgentReplica } from "@/utils/agent-directory-sync";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { planTimelineTailFetch } from "@/timeline/timeline-sync-plan";

/**
 * The subset of an agent record that a fork needs in order to seed the new
 * draft. Kept structural so both `AgentScreenAgent` (the agent-stream view's
 * live context) and the session store's `Agent` record satisfy it without a
 * projection step.
 */
export type ForkAgentSource = Pick<
  AgentScreenAgent,
  | "provider"
  | "cwd"
  | "currentModeId"
  | "model"
  | "thinkingOptionId"
  | "runtimeInfo"
  | "capabilities"
  | "features"
  | "projectPlacement"
>;

/** Boundary marking the completed assistant turn where the fork should stop. */
export type ForkAgentBoundary = Pick<
  AgentForkContextOptions,
  "boundaryCursor" | "boundaryMessageId"
>;

export interface ForkAgentRequest {
  agentId: string;
  agent: ForkAgentSource;
  workspaceId?: string;
  target: AssistantForkTarget;
  boundary?: ForkAgentBoundary;
}

export interface UseForkAgentInput {
  serverId: string;
  toast?: ToastApi | null;
  /** Read-only surfaces (provider subagent panes) must never fork. */
  readOnly?: boolean;
}

function buildChatHistoryAttachment(input: {
  draftId: string;
  serverId: string;
  agentId: string;
  payload: Awaited<ReturnType<DaemonClient["buildAgentForkContext"]>>;
  missingAttachmentMessage: string;
}): WorkspaceComposerAttachment {
  if (!input.payload.attachment) {
    throw new Error(input.missingAttachmentMessage);
  }
  return {
    kind: "chat_history",
    id: `chat_history:${input.draftId}`,
    attachment: input.payload.attachment,
    source: {
      serverId: input.serverId,
      agentId: input.agentId,
      boundaryMessageId: input.payload.boundaryMessageId,
      boundaryCursor: input.payload.boundaryCursor,
      itemCount: input.payload.itemCount,
    },
  };
}

function buildForkDraftSetup(agent: ForkAgentSource): WorkspaceDraftTabSetup | undefined {
  if (!agent.provider) {
    return undefined;
  }

  const featureValues: Record<string, unknown> = {};
  for (const feature of agent.features ?? []) {
    featureValues[feature.id] = feature.value;
  }

  return {
    provider: agent.provider,
    cwd: agent.cwd,
    modeId: agent.currentModeId ?? agent.runtimeInfo?.modeId ?? null,
    model: agent.model ?? agent.runtimeInfo?.model ?? null,
    thinkingOptionId: agent.thinkingOptionId ?? agent.runtimeInfo?.thinkingOptionId ?? null,
    featureValues,
  };
}

function buildForkDraftTabTarget(
  setup: WorkspaceDraftTabSetup | undefined,
  draftId: string,
): WorkspaceTabTarget {
  return setup ? { kind: "draft", draftId, setup } : { kind: "draft", draftId };
}

async function prepareContextForkDraft(input: {
  client: DaemonClient;
  serverId: string;
  agentId: string;
  boundary?: ForkAgentBoundary;
  missingAttachmentMessage: string;
}): Promise<string> {
  const draftId = generateDraftId();
  const payload = await input.client.buildAgentForkContext(input.agentId, input.boundary);
  const attachment = buildChatHistoryAttachment({
    draftId,
    serverId: input.serverId,
    agentId: input.agentId,
    payload,
    missingAttachmentMessage: input.missingAttachmentMessage,
  });
  useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
    scopeKey: buildDraftWorkspaceAttachmentScopeKey(draftId),
    attachments: [attachment],
  });
  return draftId;
}

function sourceDirectoryForFork(agent: ForkAgentSource): string | undefined {
  return agent.projectPlacement?.checkout?.cwd?.trim() || agent.cwd.trim() || undefined;
}

async function createAndOpenNativeConversationForkTab(input: {
  client: DaemonClient;
  setup: WorkspaceDraftTabSetup;
  forkFrom: NativeConversationForkHandoff;
  serverId: string;
  workspaceId: string;
  sourceAgentId: string;
}): Promise<void> {
  const sourceTitle =
    useSessionStore.getState().sessions[input.serverId]?.agents.get(input.sourceAgentId)?.title ??
    null;
  const snapshot = await input.client.createAgent(
    buildNativeConversationForkCreateOptions({
      setup: input.setup,
      forkFrom: input.forkFrom,
      workspaceId: input.workspaceId,
      sourceTitle,
    }),
  );
  upsertAgentReplica(input.serverId, normalizeAgentSnapshot(snapshot, input.serverId));

  // The daemon hydrates the provider history before create resolves. Prime the
  // authoritative timeline before revealing the real agent pane so it never
  // looks like a blank new-agent draft. A failed prefetch is non-fatal: the
  // pane's normal initialization path retries it.
  try {
    await getHostRuntimeStore().fetchAgentTimeline(
      input.serverId,
      snapshot.id,
      planTimelineTailFetch(),
    );
  } catch (error) {
    console.warn("[ForkAgent] Failed to prefetch native fork history", error);
  }

  navigateToWorkspace({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    target: { kind: "agent", agentId: snapshot.id },
  });
}

async function openForkInCurrentWorkspace(input: {
  client: DaemonClient;
  mode: "native" | "context_attachment";
  setup: WorkspaceDraftTabSetup | undefined;
  forkFrom: NativeConversationForkHandoff | undefined;
  serverId: string;
  workspaceId: string | undefined;
  agentId: string;
  agent: ForkAgentSource;
  boundary: ForkAgentBoundary | undefined;
  missingWorkspaceMessage: string;
  forkFailedMessage: string;
}): Promise<void> {
  if (!input.workspaceId) {
    throw new Error(input.missingWorkspaceMessage);
  }
  if (input.mode === "native") {
    if (!input.setup || !input.forkFrom) {
      throw new Error(input.forkFailedMessage);
    }
    await createAndOpenNativeConversationForkTab({
      client: input.client,
      setup: input.setup,
      forkFrom: input.forkFrom,
      serverId: input.serverId,
      workspaceId: input.workspaceId,
      sourceAgentId: input.agentId,
    });
    return;
  }
  const draftId = await prepareContextForkDraft({
    client: input.client,
    serverId: input.serverId,
    agentId: input.agentId,
    boundary: input.boundary,
    missingAttachmentMessage: input.forkFailedMessage,
  });
  navigateToWorkspace({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    target: buildForkDraftTabTarget(input.setup, draftId),
  });
}

/**
 * Shared fork driver behind completed and active turn affordances. Copied
 * context can project an active turn without a boundary. Native provider forks
 * require a completed boundary and tell the user to wait while the turn runs.
 */
export function useForkAgent(
  input: UseForkAgentInput,
): (request: ForkAgentRequest) => Promise<void> {
  const { serverId, toast, readOnly = false } = input;
  const { t } = useTranslation();
  const router = useRouter();
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const supportsAgentForkContext = useHostFeature(serverId, "agentForkContext") && !readOnly;
  const supportsNativeConversationFork =
    useHostFeature(serverId, "agentConversationFork") && !readOnly;

  return useStableEvent(async ({ agentId, agent, workspaceId, target, boundary }) => {
    try {
      const preparation = resolveForkPreparation({
        provider: agent.provider,
        clientSupportsNative: CLIENT_SUPPORTS_NATIVE_CONVERSATION_FORK,
        sourceSupportsNative: agent.capabilities?.supportsNativeConversationFork === true,
        daemonSupportsNative: supportsNativeConversationFork,
        daemonSupportsContext: supportsAgentForkContext,
      });
      if (preparation.errorKey) {
        toast?.error(t(preparation.errorKey));
        return;
      }
      if (preparation.mode === "native" && !boundary) {
        toast?.error(t("message.actions.forkWaitForTurn"));
        return;
      }
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const draftSetup = buildForkDraftSetup(agent);
      const forkFrom = boundary
        ? ({ serverId, agentId, ...boundary } satisfies NativeConversationForkHandoff)
        : undefined;
      if (target === "tab") {
        await openForkInCurrentWorkspace({
          client,
          mode: preparation.mode,
          setup: draftSetup,
          forkFrom,
          serverId,
          workspaceId,
          agentId,
          agent,
          boundary,
          missingWorkspaceMessage: t("message.actions.forkMissingWorkspace"),
          forkFailedMessage: t("message.actions.forkFailed"),
        });
        return;
      }

      const draftId =
        preparation.mode === "native"
          ? generateDraftId()
          : await prepareContextForkDraft({
              client,
              serverId,
              agentId,
              boundary,
              missingAttachmentMessage: t("message.actions.forkFailed"),
            });
      const sourceDirectory = sourceDirectoryForFork(agent);
      if (draftSetup) {
        useWorkspaceDraftSubmissionStore.getState().setDraftSetup({
          draftId,
          setup: draftSetup,
          sourceDirectory,
          ...(forkFrom ? { nativeForkFrom: forkFrom } : {}),
        });
      }
      router.push(
        buildNewWorkspaceRoute({
          serverId,
          sourceDirectory,
          displayName: agent.projectPlacement?.projectName,
          projectId: agent.projectPlacement?.projectKey,
          draftId,
        }),
      );
    } catch (error) {
      toast?.error(toErrorMessage(error) || t("message.actions.forkFailed"));
    }
  });
}
