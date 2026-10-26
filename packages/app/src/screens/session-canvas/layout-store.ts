import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { z } from "zod";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { BoardPlacement } from "@/components/board-canvas/layout";
import {
  addSessionPlacements,
  arrangeSessions,
  type CanvasSession,
  type SessionOrder,
  type SessionArrangement,
} from "./model";

interface CanvasLayout {
  time: SessionArrangement;
  order: SessionOrder;
  placements: BoardPlacement[];
  revision: number;
}
export const DEFAULT_SESSION_LAYOUT: CanvasLayout = {
  time: "relationships",
  order: "oldest",
  placements: [],
  revision: 0,
};
interface LayoutStore {
  workspaces: Record<string, CanvasLayout | null>;
  error: Error | null;
  arrange: (
    key: string,
    sessions: CanvasSession[],
    time: SessionArrangement,
    order: SessionOrder,
  ) => Promise<boolean>;
  sync: (key: string, sessions: CanvasSession[]) => Promise<boolean>;
  move: (key: string, placement: BoardPlacement) => Promise<boolean>;
}
const STORAGE_KEY = "session-canvas-layouts";
const LayoutSchema = z.object({
  time: z.enum(["relationships", "created", "forked", "reply", "input"]),
  order: z.enum(["oldest", "newest"]),
  placements: z.array(
    z.object({
      id: z.string(),
      column: z.number().finite().nullable(),
      row: z.number().finite().nullable(),
      width: z.number().finite().nullable(),
      height: z.number().finite().nullable(),
    }),
  ),
  revision: z.number().int().nonnegative(),
});
type PersistedLayout = Pick<LayoutStore, "workspaces">;
const StoredLayoutSchema = z.object({
  workspaces: z.record(z.string(), z.unknown()).transform((workspaces) =>
    Object.fromEntries(
      Object.entries(workspaces).map(([key, raw]) => {
        const layout = LayoutSchema.safeParse(raw);
        // Keep an opaque workspace in the original document, including bad placements.
        return [key, layout.success ? layout.data : null];
      }),
    ),
  ),
});
const layoutStorage = createValidatedPersistStorage<PersistedLayout>(
  AsyncStorage,
  StoredLayoutSchema,
  { version: 0 },
);

export const useSessionCanvasLayout = create<LayoutStore>()(
  persist(
    (set, get) => {
      let writes = Promise.resolve();
      function edit(
        key: string,
        update: (state: LayoutStore) => PersistedLayout | null,
      ): Promise<boolean> {
        const operation = writes
          .then(async () => {
            if (!useSessionCanvasLayout.persist.hasHydrated()) {
              throw new Error(`Cannot edit unreadable or loading saved ${STORAGE_KEY}`);
            }
            const current = get();
            if (current.workspaces[key] === null) {
              throw new Error(`Cannot edit unreadable saved ${STORAGE_KEY} workspace ${key}`);
            }
            const next = update(current);
            if (next) {
              // The read projection may hide opaque records; new edits must still be valid.
              LayoutSchema.parse(next.workspaces[key]);
              await layoutStorage.setItem(STORAGE_KEY, { state: next, version: 0 });
              set({ ...next, error: null });
            }
            return true;
          })
          .catch((cause: unknown) => {
            const error = cause instanceof Error ? cause : new Error(`Cannot save ${STORAGE_KEY}`);
            set({ error });
            console.warn(error.message);
            return false;
          });
        writes = operation.then(() => undefined);
        return operation;
      }
      return {
        workspaces: {},
        error: null,
        arrange: (key, sessions, time, order) =>
          edit(key, (state) => ({
            workspaces: {
              ...state.workspaces,
              [key]: {
                time,
                order,
                placements: arrangeSessions(sessions, time, order),
                revision: (state.workspaces[key]?.revision ?? 0) + 1,
              },
            },
          })),
        sync: (key, sessions) =>
          edit(key, (state) => {
            const current = state.workspaces[key] ?? DEFAULT_SESSION_LAYOUT;
            const known = new Set(current.placements.map((placement) => placement.id));
            const added = sessions.filter((session) => !known.has(session.id));
            if (!added.length) return null;
            const placements = addSessionPlacements({
              sessions,
              placements: current.placements,
              time: current.time,
              order: current.order,
            });
            return { workspaces: { ...state.workspaces, [key]: { ...current, placements } } };
          }),
        move: (key, placement) =>
          edit(key, (state) => {
            const current = state.workspaces[key] ?? DEFAULT_SESSION_LAYOUT;
            return {
              workspaces: {
                ...state.workspaces,
                [key]: {
                  ...current,
                  placements: [
                    ...current.placements.filter((p) => p.id !== placement.id),
                    placement,
                  ],
                },
              },
            };
          }),
      };
    },
    {
      name: STORAGE_KEY,
      version: 0,
      partialize: ({ workspaces }) => ({ workspaces }),
      // Actions serialize and save before publishing memory. Persist owns hydration/reset only.
      storage: { ...layoutStorage, setItem: () => undefined },
      onRehydrateStorage: () => (_state, error) => {
        if (error) console.warn(`Cannot load saved ${STORAGE_KEY}; original data was retained`);
      },
    },
  ),
);
