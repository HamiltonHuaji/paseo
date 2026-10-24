import { z } from "zod";
import equal from "fast-deep-equal/es6";
import type { PersistStorage, StateStorage, StorageValue } from "zustand/middleware";
import { mergeStoredEdits, overlayStoredValue, parseStoredValue } from "./persisted-value";

const EnvelopeSchema = z.object({
  state: z.unknown(),
  version: z.number().int().nonnegative().optional(),
});

export function createValidatedPersistStorage<State>(
  backingStorage: StateStorage,
  stateSchema: z.ZodType<State>,
  options: {
    skipUnchanged?: boolean;
    version?: number;
    migrate?: (state: unknown, version: number) => unknown | Promise<unknown>;
    /** Reconcile moved/deleted known fields while preserving data outside the migration's view. */
    reconcileMigration?: (state: unknown, migrated: unknown) => unknown | Promise<unknown>;
  } = {},
): PersistStorage<State> {
  const accepted = new Map<string, StorageValue<State>>();
  const snapshots = new Map<string, { raw: unknown; view: StorageValue<State> } | null>();
  const reading = new Set<string>();
  const blocked = new Set<string>();
  const writes = new Map<string, Promise<void>>();

  async function read(name: string): Promise<StorageValue<State> | null> {
    blocked.add(name);
    const text = await backingStorage.getItem(name);
    if (text === null) {
      snapshots.set(name, null);
      blocked.delete(name);
      return null;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error(`Cannot read saved ${name}: invalid JSON; original data was retained`);
    }
    const envelope = parseStoredValue(EnvelopeSchema, raw, name);
    const storedVersion = envelope.version ?? 0;
    if (options.version !== undefined && storedVersion > options.version) {
      throw new Error(`Saved ${name} needs a newer client; original data was retained`);
    }
    const needsMigration = options.version !== undefined && storedVersion !== options.version;
    if (needsMigration && !options.migrate) {
      throw new Error(`Saved ${name} cannot be migrated; original data was retained`);
    }
    const migrated = needsMigration
      ? await options.migrate!(envelope.state, storedVersion)
      : envelope.state;
    const view = {
      state: parseStoredValue(stateSchema, migrated, name),
      ...(envelope.version !== undefined || needsMigration
        ? { version: needsMigration ? options.version : envelope.version }
        : {}),
    };
    let migratedRaw = needsMigration ? overlayStoredValue(raw, view) : raw;
    if (needsMigration && options.reconcileMigration) {
      const reconciled = await options.reconcileMigration(envelope.state, migrated);
      const reconciledView = parseStoredValue(stateSchema, reconciled, name);
      if (!equal(reconciledView, view.state)) {
        throw new Error(`Cannot reconcile migrated ${name}; original data was retained`);
      }
      migratedRaw = mergeStoredEdits(raw, envelope, { ...view, state: reconciled });
    }
    // Keep the original document until an explicit edit writes the reconciled migration.
    snapshots.set(name, { raw: migratedRaw, view });
    blocked.delete(name);
    return view;
  }

  async function write(name: string, value: StorageValue<State>): Promise<void> {
    if (!snapshots.has(name) && !blocked.has(name)) await read(name);
    if (blocked.has(name)) throw new Error(`Cannot overwrite unreadable saved ${name}`);
    const previous = accepted.get(name);
    if (
      options.skipUnchanged &&
      previous &&
      previous.state === value.state &&
      previous.version === value.version
    )
      return;
    // A rejected new value never removes the previously saved value.
    const state = stateSchema.parse(value.state);
    const envelope = EnvelopeSchema.parse(value);
    const view: StorageValue<State> = { ...envelope, state };
    const snapshot = snapshots.get(name);
    const raw = snapshot ? mergeStoredEdits(snapshot.raw, snapshot.view, view) : view;
    await backingStorage.setItem(name, JSON.stringify(raw));
    snapshots.set(name, { raw, view });
    if (options.skipUnchanged) accepted.set(name, value);
  }

  function enqueue(name: string, operation: () => Promise<void>): Promise<void> {
    const next = (writes.get(name) ?? Promise.resolve()).then(operation);
    writes.set(
      name,
      next.catch((error) => {
        console.warn(`Could not persist ${name}; saved data was retained`, error);
      }),
    );
    return next;
  }

  return {
    getItem: async (name) => {
      accepted.delete(name);
      reading.add(name);
      try {
        await writes.get(name);
        return await read(name);
      } finally {
        reading.delete(name);
      }
    },
    setItem: (name, value) => {
      // Pre-hydration writes are defaults, not edits to the saved document.
      if (reading.has(name)) return Promise.resolve();
      return enqueue(name, () => write(name, value));
    },
    removeItem: (name) =>
      enqueue(name, async () => {
        // Only an explicit reset/delete may remove saved data.
        await backingStorage.removeItem(name);
        accepted.delete(name);
        snapshots.set(name, null);
        blocked.delete(name);
      }),
  };
}
