import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

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
const LocalStateSchema = z.object({
  plan: SkillRepositoryPlanSchema,
  executors: z.array(ExecutorSchema),
});
type LocalState = z.infer<typeof LocalStateSchema>;

const emptyState = (): LocalState => ({
  plan: { version: 1, repositories: [], members: [] },
  executors: [],
});

let cache: LocalState | null = null;
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

async function readState(): Promise<LocalState> {
  if (cache) return structuredClone(cache);
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  cache = raw ? LocalStateSchema.parse(JSON.parse(raw)) : emptyState();
  return structuredClone(cache);
}

async function writeState(state: LocalState): Promise<void> {
  const next = LocalStateSchema.parse(state);
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

export async function getSkillRepositoryLocalState(): Promise<LocalState> {
  await queue.catch(() => {});
  return readState();
}

export async function exportSkillRepositoryPlan(): Promise<string> {
  const state = await getSkillRepositoryLocalState();
  return JSON.stringify(state.plan, null, 2);
}

export async function importSkillRepositoryPlan(raw: string): Promise<{ conflicts: string[] }> {
  const incoming = SkillRepositoryPlanSchema.parse(JSON.parse(raw));
  for (const repository of incoming.repositories) assertRemoteUrl(repository.remoteUrl);
  if (
    new Set(incoming.repositories.map((item) => item.repositoryId)).size !==
    incoming.repositories.length
  ) {
    throw new Error("Duplicate repository IDs in imported plan");
  }
  if (
    new Set(incoming.members.map((item) => `${item.serverId}:${item.repositoryId}`)).size !==
    incoming.members.length
  ) {
    throw new Error("Duplicate daemon memberships in imported plan");
  }
  return mutate(async () => {
    const state = await readState();
    const conflicts: string[] = [];
    for (const repository of incoming.repositories) {
      const current = state.plan.repositories.find(
        (item) => item.repositoryId === repository.repositoryId,
      );
      if (!current) state.plan.repositories.push(repository);
      else if (JSON.stringify(current) !== JSON.stringify(repository)) {
        conflicts.push(`repository:${repository.repositoryId}`);
      }
    }
    for (const member of incoming.members) {
      const current = state.plan.members.find(
        (item) => item.serverId === member.serverId && item.repositoryId === member.repositoryId,
      );
      if (!current) state.plan.members.push(member);
      else if (JSON.stringify(current) !== JSON.stringify(member)) {
        conflicts.push(`member:${member.serverId}:${member.repositoryId}`);
      }
    }
    await writeState(state);
    return { conflicts };
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
    state.plan.repositories = state.plan.repositories.filter(
      (item) => item.repositoryId !== input.repositoryId,
    );
    state.plan.repositories.push({ ...input, revision: revision() });
    await writeState(state);
  });
}

export async function saveSkillRepositoryMember(input: {
  serverId: string;
  repositoryId: string;
  autoReceive: "overwrite" | "fastforward" | "none";
  agentPublishAllowed: boolean;
}): Promise<void> {
  await mutate(async () => {
    const state = await readState();
    state.plan.members = state.plan.members.filter(
      (item) => item.serverId !== input.serverId || item.repositoryId !== input.repositoryId,
    );
    state.plan.members.push({ ...input, revision: revision() });
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
): Promise<void> {
  await mutate(async () => {
    const state = await readState();
    const member = state.plan.members.find(
      (item) => item.serverId === serverId && item.repositoryId === repositoryId,
    );
    if (!member) return;
    Object.assign(member, { deleted: true, revision: revision() });
    await writeState(state);
  });
}

export async function removeSkillRepository(repositoryId: string): Promise<void> {
  await mutate(async () => {
    const state = await readState();
    const repository = state.plan.repositories.find((item) => item.repositoryId === repositoryId);
    if (!repository) return;
    Object.assign(repository, { deleted: true, revision: revision() });
    for (const member of state.plan.members) {
      if (member.repositoryId === repositoryId) {
        Object.assign(member, { deleted: true, revision: revision() });
      }
    }
    state.executors = state.executors.filter((item) => item.repositoryId !== repositoryId);
    await writeState(state);
  });
}
