const errors = new Map<string, string>();
const listeners = new Set<() => void>();

export function getSkillRepositoryPlanErrors(): Array<{ serverId: string; message: string }> {
  return [...errors].map(([serverId, message]) => ({ serverId, message }));
}

export function subscribeSkillRepositoryPlanErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSkillRepositoryPlanError(serverId: string, message: string | null): void {
  if (message) errors.set(serverId, message);
  else errors.delete(serverId);
  for (const listener of listeners) listener();
}
