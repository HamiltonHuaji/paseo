import type { SkillRepositorySubscription } from "@getpaseo/protocol/skill-repositories";

function formStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      listeners.clear();
    },
    set(patch: Partial<T>) {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
  };
}

export type RepositoryAccess = "none" | "read" | "publish";
export function openRepositoryForm(initial?: {
  repositoryId: string;
  label: string;
  remoteUrl: string;
  branch: string;
  access: RepositoryAccess;
}) {
  return formStore({
    repositoryId:
      initial?.repositoryId ??
      `skr_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`,
    label: initial?.label ?? "",
    remoteUrl: initial?.remoteUrl ?? "",
    branch: initial?.branch ?? "main",
    access: initial?.access ?? ("none" as RepositoryAccess),
  });
}

export function openSubscriptionForm(initial?: SkillRepositorySubscription) {
  return formStore({
    repositoryId: initial?.repositoryId ?? "",
    display: initial?.label ?? "",
    autoReceive:
      initial?.autoReceive ?? ("fastforward" as SkillRepositorySubscription["autoReceive"]),
    agentPublishAllowed: initial?.agentPublishAllowed ?? false,
  });
}

export function openPlanImportForm() {
  return formStore({ raw: "", choices: {} as Record<string, "local" | "incoming"> });
}
