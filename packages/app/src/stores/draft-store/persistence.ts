import type { PersistStorage } from "zustand/middleware";

export const DRAFT_PERSIST_INTERVAL_MS = 200;
export interface PersistenceScheduler {
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
}

export interface DraftPersistStorage<T> extends PersistStorage<T> {
  flush: () => Promise<void>;
}

let nextSystemTimerId = 0;
const systemTimers = new Map<number, ReturnType<typeof setTimeout>>();
const systemScheduler: PersistenceScheduler = {
  now: Date.now,
  schedule: (callback, delayMs) => {
    const id = nextSystemTimerId++;
    systemTimers.set(
      id,
      setTimeout(() => {
        systemTimers.delete(id);
        callback();
      }, delayMs),
    );
    return id;
  },
  cancel: (handle) => {
    if (typeof handle !== "number") return;
    const timer = systemTimers.get(handle);
    if (timer === undefined) return;
    clearTimeout(timer);
    systemTimers.delete(handle);
  },
};

export function createDraftPersistStorage<T>(
  storage: PersistStorage<T>,
  scheduler?: PersistenceScheduler,
): DraftPersistStorage<T>;
export function createDraftPersistStorage<T>(
  storage: PersistStorage<T> | undefined,
  scheduler?: PersistenceScheduler,
): DraftPersistStorage<T> | undefined;
export function createDraftPersistStorage<T>(
  storage: PersistStorage<T> | undefined,
  scheduler: PersistenceScheduler = systemScheduler,
): DraftPersistStorage<T> | undefined {
  if (!storage) {
    return undefined;
  }

  let pending: { name: string; value: Parameters<typeof storage.setItem>[1] } | null = null;
  let timer: unknown = null;
  let lastWriteAt = -Infinity;
  let inFlight: Promise<void> | null = null;
  let removalEpoch = 0;

  const cancelTimer = () => {
    if (timer !== null) {
      scheduler.cancel(timer);
      timer = null;
    }
  };
  const flush = async (): Promise<void> => {
    cancelTimer();
    if (inFlight) {
      await inFlight;
      return flush();
    }
    const write = pending;
    pending = null;
    if (!write) {
      return;
    }
    lastWriteAt = scheduler.now();
    const writeEpoch = removalEpoch;
    inFlight = (async () => {
      try {
        await storage.setItem(write.name, write.value);
      } catch (error) {
        // A newer checkpoint supersedes this one; otherwise retain it for retry.
        if (writeEpoch === removalEpoch) pending ??= write;
        throw error;
      }
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  };
  const checkpoint = () => {
    const result = flush();
    void result.catch((error) => {
      console.warn("[DraftStore] Failed to persist draft checkpoint", error);
    });
    return result;
  };

  return {
    getItem: (name) => storage.getItem(name),
    setItem: (name, value) => {
      pending = { name, value };
      const delay = DRAFT_PERSIST_INTERVAL_MS - (scheduler.now() - lastWriteAt);
      if (delay <= 0) {
        return checkpoint();
      }
      timer ??= scheduler.schedule(() => {
        void checkpoint();
      }, delay);
    },
    removeItem: (name) => {
      removalEpoch += 1;
      cancelTimer();
      pending = null;
      lastWriteAt = scheduler.now();
      return storage.removeItem(name);
    },
    flush,
  };
}
