import type {
  SkillRepositoryState,
  SkillRepositorySubscription,
  SkillRepositoryStatus,
} from "@getpaseo/protocol/skill-repositories";
import { subscriptionFromPlan, type SkillRepositoryLocalState } from "./plan";

function gitStatusLabel(status: SkillRepositoryStatus): string {
  if (status.syncError || status.worktree === "conflicted" || status.publication === "blocked")
    return "needsResolution";
  if (status.publication === "pending") return "pendingPublish";
  if (status.worktree === "dirty") return "dirty";
  if (!status.localHead) return "uninitialized";
  if (!status.remoteHead) return "remoteUnknown";
  if (status.ahead || status.behind) return "different";
  return "upToDate";
}
export function repositoryStatusLabel(
  actual: SkillRepositoryState | null,
  connected: boolean,
  running: boolean,
  pending: SkillRepositoryLocalState["pending"][number] | undefined,
): string {
  if (!connected) return "offline";
  if (running || actual?.busy) return "syncing";
  if (pending) return pending.error ? "configConflict" : "pendingConfig";
  if (actual?.error) return "needsResolution";
  return actual?.status ? gitStatusLabel(actual.status) : "uninitialized";
}
export function visibleSubscriptions(
  serverId: string,
  actual: SkillRepositoryState[],
  local?: SkillRepositoryLocalState,
): Map<string, SkillRepositorySubscription> {
  const subscriptions = new Map(actual.map((r) => [r.subscription.repositoryId, r.subscription]));
  if (!local) return subscriptions;
  for (const member of local.plan.members.filter((m) => m.serverId === serverId && !m.deleted)) {
    const subscription = subscriptionFromPlan(local.plan, serverId, member.repositoryId);
    if (
      subscription &&
      (local.pending.some(
        (p) => p.serverId === serverId && p.repositoryId === member.repositoryId,
      ) ||
        !subscriptions.has(member.repositoryId))
    )
      subscriptions.set(member.repositoryId, subscription);
  }
  for (const pending of local.pending.filter((p) => p.serverId === serverId)) {
    if (!subscriptions.has(pending.repositoryId) && pending.expected)
      subscriptions.set(pending.repositoryId, pending.expected);
  }
  return subscriptions;
}

export function repositoryRowError(
  error: string,
  actual: SkillRepositoryState | null,
  pending: SkillRepositoryLocalState["pending"][number] | undefined,
): string | undefined {
  return error || pending?.error || actual?.error || actual?.status?.syncError || undefined;
}
