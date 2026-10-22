import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { BoardPlacement } from "@/components/board-canvas/layout";
import { arrangeSessions, type CanvasSession, type SessionOrder, type SessionTime } from "./model";

interface CanvasLayout {
  time: SessionTime;
  order: SessionOrder;
  placements: BoardPlacement[];
  revision: number;
}
export const DEFAULT_SESSION_LAYOUT: CanvasLayout = {
  time: "created",
  order: "oldest",
  placements: [],
  revision: 0,
};
interface LayoutStore {
  workspaces: Record<string, CanvasLayout>;
  arrange: (key: string, sessions: CanvasSession[], time: SessionTime, order: SessionOrder) => void;
  sync: (key: string, sessions: CanvasSession[]) => void;
  move: (key: string, placement: BoardPlacement) => void;
}
export const useSessionCanvasLayout = create<LayoutStore>()(
  persist(
    (set) => ({
      workspaces: {},
      arrange: (key, sessions, time, order) =>
        set((state) => ({
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
        set((state) => {
          const current = state.workspaces[key] ?? DEFAULT_SESSION_LAYOUT;
          const known = new Set(current.placements.map((placement) => placement.id));
          const added = sessions.filter((session) => !known.has(session.id));
          if (!added.length) return state;
          let placements: BoardPlacement[];
          if (!known.size) placements = arrangeSessions(sessions, current.time, current.order);
          else {
            const bottom =
              Math.max(...current.placements.map((p) => (p.row ?? 0) + (p.height ?? 9))) + 0.5;
            const arranged = arrangeSessions(sessions, current.time, current.order).filter(
              (p) => !known.has(p.id),
            );
            placements = [
              ...current.placements,
              ...arranged.map((p, i) => Object.assign({}, p, { row: bottom + i * 9.5 })),
            ];
          }
          return { workspaces: { ...state.workspaces, [key]: { ...current, placements } } };
        }),
      move: (key, placement) =>
        set((state) => {
          const current = state.workspaces[key] ?? DEFAULT_SESSION_LAYOUT;
          return {
            workspaces: {
              ...state.workspaces,
              [key]: {
                ...current,
                placements: [...current.placements.filter((p) => p.id !== placement.id), placement],
              },
            },
          };
        }),
    }),
    { name: "session-canvas-layouts", storage: createJSONStorage(() => AsyncStorage) },
  ),
);
