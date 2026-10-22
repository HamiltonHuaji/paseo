import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import {
  SkillRepositorySubscriptionSchema,
  type SkillRepositorySubscription,
} from "@getpaseo/protocol/skill-repositories";

const STORAGE_KEY = "@paseo:skill-repository-plan-v1";

const RepositorySchema = z.object({
  repositoryId: z.string().min(1),
  label: z.string().min(1),
  remoteUrl: z.string().min(1),
  branch: z.string().min(1),
  revision: z.string().min(1),
  deleted: z.boolean().optional(),
});
const MemberSchema = z.object({
  serverId: z.string().min(1),
  repositoryId: z.string().min(1),
  autoReceive: z.enum(["overwrite", "fastforward", "none"]),
  agentPublishAllowed: z.boolean(),
  revision: z.string().min(1),
  deleted: z.boolean().optional(),
});
export const SkillRepositoryPlanSchema = z.object({
  version: z.literal(1),
  repositories: z.array(RepositorySchema),
  members: z.array(MemberSchema),
});
export type SkillRepositoryPlan = z.infer<typeof SkillRepositoryPlanSchema>;

const ExecutorSchema = z.object({
  repositoryId: z.string().min(1),
  read: z.boolean(),
  publish: z.boolean(),
});
const SkillRepositoryLocalStateSchema = z.object({
  plan: SkillRepositoryPlanSchema,
  executors: z.array(ExecutorSchema),
  pending: z
    .array(
      z.object({
        serverId: z.string(),
        repositoryId: z.string(),
        revision: z.string(),
        expected: SkillRepositorySubscriptionSchema.nullable(),
        error: z.string().optional(),
      }),
    )
    .default([]),
  observedServers: z.array(z.string()).default([]),
});
export type SkillRepositoryLocalState = z.infer<typeof SkillRepositoryLocalStateSchema>;

const emptyState = (): SkillRepositoryLocalState => ({
  plan: { version: 1, repositories: [], members: [] },
  executors: [],
  pending: [],
  observedServers: [],
});

let cache: SkillRepositoryLocalState | null = null;
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
const revision = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function assertRemoteUrl(remoteUrl: string): void {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remoteUrl)) {
    const url = new URL(remoteUrl);
    if (url.username || url.password) {
      throw new Error("Repository URL must not contain credentials");
    }
  }
}

async function readState(): Promise<SkillRepositoryLocalState> {
  if (cache) return structuredClone(cache);
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  cache = raw ? SkillRepositoryLocalStateSchema.parse(JSON.parse(raw)) : emptyState();
  return structuredClone(cache);
}

async function writeState(state: SkillRepositoryLocalState): Promise<void> {
  const next = SkillRepositoryLocalStateSchema.parse(state);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  cache = next;
  for (const listener of listeners) listener();
}

function mutate<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.catch(() => {}).then(run);
  queue = next;
  return next;
}

export function subscribeSkillRepositoryPlan(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getSkillRepositoryLocalState(): Promise<SkillRepositoryLocalState> {
  await queue.catch(() => {});
  return readState();
}

export async function exportSkillRepositoryPlan(): Promise<string> {
  const state = await getSkillRepositoryLocalState();
  return JSON.stringify(state.plan, null, 2);
}

function parsePlan(raw: string): SkillRepositoryPlan {
  const incoming = SkillRepositoryPlanSchema.parse(JSON.parse(raw));
  for (const repository of incoming.repositories) assertRemoteUrl(repository.remoteUrl);
  if (
    new Set(incoming.repositories.map((item) => item.repositoryId)).size !==
    incoming.repositories.length
  )
    throw new Error("Duplicate repository IDs in imported plan");
  if (
    new Set(incoming.members.map((item) => `${item.serverId}:${item.repositoryId}`)).size !==
    incoming.members.length
  )
    throw new Error("Duplicate daemon memberships in imported plan");
  return incoming;
}

function sameRecord(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter((key) => key !== "revision")
    .every((key) => a[key] === b[key] || (key === "deleted" && !a[key] && !b[key]));
}

export interface PlanConflict {
  key: string;
  label: string;
  local: SkillRepositoryPlan["repositories"][number] | SkillRepositoryPlan["members"][number];
  incoming: SkillRepositoryPlan["repositories"][number] | SkillRepositoryPlan["members"][number];
}
function conflictsFor(current: SkillRepositoryPlan, incoming: SkillRepositoryPlan): PlanConflict[] {
  const conflicts: PlanConflict[] = [];
  for (const item of incoming.repositories) {
    const local = current.repositories.find((r) => r.repositoryId === item.repositoryId);
    if (local && !sameRecord(local, item))
      conflicts.push({
        key: `repository:${item.repositoryId}`,
        label: item.label,
        local,
        incoming: item,
      });
  }
  for (const item of incoming.members) {
    const local = current.members.find(
      (m) => m.serverId === item.serverId && m.repositoryId === item.repositoryId,
    );
    if (local && !sameRecord(local, item))
      conflicts.push({
        key: `member:${item.serverId}:${item.repositoryId}`,
        label: `${incoming.repositories.find((r) => r.repositoryId === item.repositoryId)?.label ?? item.repositoryId} · ${item.serverId}`,
        local,
        incoming: item,
      });
  }
  return conflicts;
}

export async function previewSkillRepositoryPlan(raw: string) {
  const plan = parsePlan(raw);
  const state = await getSkillRepositoryLocalState();
  return { plan, conflicts: conflictsFor(state.plan, plan) };
}

export async function importSkillRepositoryPlan(
  raw: string,
  choices: Record<string, "local" | "incoming"> = {},
): Promise<void> {
  const incoming = parsePlan(raw);
  await mutate(async () => {
    const state = await readState();
    const conflicts = conflictsFor(state.plan, incoming);
    if (conflicts.some((conflict) => !choices[conflict.key]))
      throw new Error("Resolve configuration conflicts before importing");
    const previous = structuredClone(state.plan);
    for (const repository of incoming.repositories) {
      const current = state.plan.repositories.find(
        (r) => r.repositoryId === repository.repositoryId,
      );
      if (
        current &&
        (sameRecord(current, repository) ||
          choices[`repository:${repository.repositoryId}`] === "local")
      )
        continue;
      state.plan.repositories = state.plan.repositories.filter(
        (r) => r.repositoryId !== repository.repositoryId,
      );
      state.plan.repositories.push(repository);
    }
    for (const member of incoming.members) {
      const current = state.plan.members.find(
        (m) => m.serverId === member.serverId && m.repositoryId === member.repositoryId,
      );
      if (
        current &&
        (sameRecord(current, member) ||
          choices[`member:${member.serverId}:${member.repositoryId}`] === "local")
      )
        continue;
      state.plan.members = state.plan.members.filter(
        (m) => m.serverId !== member.serverId || m.repositoryId !== member.repositoryId,
      );
      state.plan.members.push(member);
    }
    for (const member of state.plan.members) {
      const before = subscriptionFromPlan(previous, member.serverId, member.repositoryId);
      const after = subscriptionFromPlan(state.plan, member.serverId, member.repositoryId);
      const previousMember = previous.members.find(
        (m) => m.serverId === member.serverId && m.repositoryId === member.repositoryId,
      );
      const explicitRemoval =
        !previousMember &&
        (member.deleted ||
          state.plan.repositories.some((r) => r.repositoryId === member.repositoryId && r.deleted));
      if (JSON.stringify(before) === JSON.stringify(after) && !explicitRemoval) continue;
      const pending = state.pending.find(
        (p) => p.serverId === member.serverId && p.repositoryId === member.repositoryId,
      );
      member.revision = revision();
      queueMember(
        state,
        member,
        pending
          ? pending.expected
          : (before ?? (explicitRemoval ? savedSubscription(state.plan, member) : null)),
      );
    }
    await writeState(state);
  });
}

export function subscriptionFromPlan(
  plan: SkillRepositoryPlan,
  serverId: string,
  repositoryId: string,
): SkillRepositorySubscription | null {
  const repository = plan.repositories.find((r) => r.repositoryId === repositoryId && !r.deleted);
  const member = plan.members.find(
    (m) => m.serverId === serverId && m.repositoryId === repositoryId && !m.deleted,
  );
  if (!repository || !member) return null;
  return savedSubscription(plan, member);
}

function savedSubscription(
  plan: SkillRepositoryPlan,
  member: SkillRepositoryPlan["members"][number],
): SkillRepositorySubscription | null {
  const repository = plan.repositories.find((r) => r.repositoryId === member.repositoryId);
  if (!repository) return null;
  return {
    repositoryId: member.repositoryId,
    label: repository.label,
    remoteUrl: repository.remoteUrl,
    branch: repository.branch,
    autoReceive: member.autoReceive,
    agentPublishAllowed: member.agentPublishAllowed,
  };
}

function queueMember(
  state: SkillRepositoryLocalState,
  member: SkillRepositoryPlan["members"][number],
  expected: SkillRepositorySubscription | null,
) {
  state.pending = state.pending.filter(
    (p) => p.serverId !== member.serverId || p.repositoryId !== member.repositoryId,
  );
  state.pending.push({
    serverId: member.serverId,
    repositoryId: member.repositoryId,
    revision: member.revision,
    expected,
  });
}

export async function saveSkillRepository(input: {
  repositoryId: string;
  label: string;
  remoteUrl: string;
  branch: string;
}): Promise<void> {
  assertRemoteUrl(input.remoteUrl);
  await mutate(async () => {
    const state = await readState();
    const previous = structuredClone(state.plan);
    state.plan.repositories = state.plan.repositories.filter(
      (item) => item.repositoryId !== input.repositoryId,
    );
    state.plan.repositories.push({ ...input, revision: revision() });
    for (const member of state.plan.members.filter(
      (m) => m.repositoryId === input.repositoryId && !m.deleted,
    )) {
      const before = subscriptionFromPlan(previous, member.serverId, member.repositoryId);
      const after = subscriptionFromPlan(state.plan, member.serverId, member.repositoryId);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      const pending = state.pending.find(
        (p) => p.serverId === member.serverId && p.repositoryId === member.repositoryId,
      );
      member.revision = revision();
      queueMember(state, member, pending ? pending.expected : before);
    }
    await writeState(state);
  });
}

export async function saveSkillRepositoryMember(
  input: {
    serverId: string;
    repositoryId: string;
    autoReceive: "overwrite" | "fastforward" | "none";
    agentPublishAllowed: boolean;
  },
  expected: SkillRepositorySubscription | null,
): Promise<void> {
  await mutate(async () => {
    const state = await readState();
    state.plan.members = state.plan.members.filter(
      (item) => item.serverId !== input.serverId || item.repositoryId !== input.repositoryId,
    );
    const member = { ...input, revision: revision() };
    state.plan.members.push(member);
    queueMember(state, member, expected);
    await writeState(state);
  });
}

export async function saveSkillRepositoryExecutor(input: {
  repositoryId: string;
  read: boolean;
  publish: boolean;
}): Promise<void> {
  await mutate(async () => {
    const state = await readState();
    state.executors = state.executors.filter((item) => item.repositoryId !== input.repositoryId);
    state.executors.push(input);
    await writeState(state);
  });
}

export async function removeSkillRepositoryMember(
  serverId: string,
  repositoryId: string,
  expected: SkillRepositorySubscription | null,
): Promise<void> {
  await mutate(async () => {
    const state = await readState();
    const member = state.plan.members.find(
      (item) => item.serverId === serverId && item.repositoryId === repositoryId,
    );
    if (!member) return;
    Object.assign(member, { deleted: true, revision: revision() });
    queueMember(state, member, expected);
    await writeState(state);
  });
}

export async function removeSkillRepository(repositoryId: string): Promise<void> {
  await mutate(async () => {
    const state = await readState();
    for (const member of state.plan.members.filter((m) => m.repositoryId === repositoryId)) {
      const pending = state.pending.find(
        (p) => p.serverId === member.serverId && p.repositoryId === repositoryId,
      );
      if (member.deleted && !pending) continue;
      const expected = pending
        ? pending.expected
        : subscriptionFromPlan(state.plan, member.serverId, repositoryId);
      Object.assign(member, { deleted: true, revision: revision() });
      queueMember(state, member, expected);
    }
    const repository = state.plan.repositories.find((r) => r.repositoryId === repositoryId);
    if (repository) Object.assign(repository, { deleted: true, revision: revision() });
    state.executors = state.executors.filter((e) => e.repositoryId !== repositoryId);
    await writeState(state);
  });
}

export async function retrySkillRepositoryChange(
  serverId: string,
  repositoryId: string,
): Promise<void> {
  await mutate(async () => {
    const state = await readState();
    const pending = state.pending.find(
      (p) => p.serverId === serverId && p.repositoryId === repositoryId,
    );
    if (!pending) return;
    delete pending.error;
    await writeState(state);
  });
}

export async function recordSkillRepositoryApply(
  serverId: string,
  repositoryId: string,
  appliedRevision: string,
  error?: string,
  applied?: SkillRepositorySubscription | null,
): Promise<void> {
  await mutate(async () => {
    const state = await readState();
    const pending = state.pending.find(
      (p) => p.serverId === serverId && p.repositoryId === repositoryId,
    );
    if (!pending) return;
    // An edit can be replaced while its RPC is in flight. The next edit must
    // compare against the configuration our completed RPC actually installed.
    if (pending.revision !== appliedRevision) {
      if (!error && applied !== undefined) {
        pending.expected = applied;
        await writeState(state);
      }
      return;
    }
    if (error) {
      if (pending.error === error) return;
      pending.error = error;
    } else state.pending = state.pending.filter((p) => p !== pending);
    await writeState(state);
  });
}

export async function discardSkillRepositoryChange(
  serverId: string,
  repositoryId: string,
  actual: SkillRepositorySubscription | null,
): Promise<void> {
  await mutate(async () => {
    const state = await readState();
    state.pending = state.pending.filter(
      (p) => p.serverId !== serverId || p.repositoryId !== repositoryId,
    );
    const member = state.plan.members.find(
      (m) => m.serverId === serverId && m.repositoryId === repositoryId,
    );
    if (member) Object.assign(member, { deleted: !actual, revision: revision() });
    if (actual) {
      const repository = state.plan.repositories.find((r) => r.repositoryId === repositoryId);
      if (repository)
        Object.assign(repository, {
          label: actual.label,
          remoteUrl: actual.remoteUrl,
          branch: actual.branch,
          deleted: false,
          revision: revision(),
        });
      if (member)
        Object.assign(member, {
          autoReceive: actual.autoReceive,
          agentPublishAllowed: actual.agentPublishAllowed,
        });
    }
    await writeState(state);
  });
}

// Reading a host's persisted subscriptions also restores the catalog on a new
// client. It never grants this device Git access. Pending user edits retain their
// own expected snapshot until the host accepts them or the user resolves them.
export async function rememberSkillRepositorySubscriptions(
  serverId: string,
  subscriptions: SkillRepositorySubscription[],
): Promise<void> {
  await mutate(async () => {
    const state = await readState();
    const before = JSON.stringify(state);
    if (!state.observedServers.includes(serverId)) {
      for (const member of state.plan.members.filter((m) => m.serverId === serverId && m.deleted)) {
        if (
          !state.pending.some(
            (p) => p.serverId === serverId && p.repositoryId === member.repositoryId,
          )
        )
          queueMember(state, member, savedSubscription(state.plan, member));
      }
    }
    for (const subscription of subscriptions) {
      const repository = state.plan.repositories.find(
        (r) => r.repositoryId === subscription.repositoryId,
      );
      if (!repository)
        state.plan.repositories.push({
          repositoryId: subscription.repositoryId,
          label: subscription.label,
          remoteUrl: subscription.remoteUrl,
          branch: subscription.branch,
          revision: revision(),
        });
      if (
        state.pending.some(
          (p) => p.serverId === serverId && p.repositoryId === subscription.repositoryId,
        )
      )
        continue;
      if (repository?.deleted) {
        queueRemovedRepositorySubscription(state, serverId, subscription);
        continue;
      }
      const member = state.plan.members.find(
        (m) => m.serverId === serverId && m.repositoryId === subscription.repositoryId,
      );
      if (
        member &&
        !member.deleted &&
        member.autoReceive === subscription.autoReceive &&
        member.agentPublishAllowed === subscription.agentPublishAllowed
      )
        continue;
      state.plan.members = state.plan.members.filter((m) => m !== member);
      state.plan.members.push({
        serverId,
        repositoryId: subscription.repositoryId,
        autoReceive: subscription.autoReceive,
        agentPublishAllowed: subscription.agentPublishAllowed,
        revision: revision(),
      });
    }
    for (const member of state.plan.members.filter((m) => m.serverId === serverId && !m.deleted)) {
      if (
        subscriptions.some((s) => s.repositoryId === member.repositoryId) ||
        state.pending.some((p) => p.serverId === serverId && p.repositoryId === member.repositoryId)
      )
        continue;
      if (!state.observedServers.includes(serverId)) queueMember(state, member, null);
      else Object.assign(member, { deleted: true, revision: revision() });
    }
    if (!state.observedServers.includes(serverId)) state.observedServers.push(serverId);
    if (before !== JSON.stringify(state)) await writeState(state);
  });
}

function queueRemovedRepositorySubscription(
  state: SkillRepositoryLocalState,
  serverId: string,
  subscription: SkillRepositorySubscription,
) {
  const member = state.plan.members.find(
    (m) => m.serverId === serverId && m.repositoryId === subscription.repositoryId,
  ) ?? {
    serverId,
    repositoryId: subscription.repositoryId,
    autoReceive: subscription.autoReceive,
    agentPublishAllowed: subscription.agentPublishAllowed,
    revision: revision(),
  };
  if (!state.plan.members.includes(member)) state.plan.members.push(member);
  Object.assign(member, { deleted: true, revision: revision() });
  queueMember(state, member, subscription);
}
