import { useCallback } from "react";
import { create } from "zustand";

interface WorkNavigation {
  selected: string | null;
  expanded: Record<string, boolean>;
  search: string;
  includeArchived: boolean;
}

const EMPTY_NAVIGATION: WorkNavigation = {
  selected: null,
  expanded: {},
  search: "",
  includeArchived: false,
};

interface WorkNavigationStore {
  scopes: Record<string, WorkNavigation>;
  patch: (key: string, patch: Partial<WorkNavigation>) => void;
  expand: (key: string, id: string, expanded: boolean) => void;
}

// Workspace route retention can unmount these project screens. Keep their
// navigation separate from server records and independent between v1 and v2.
const useNavigationStore = create<WorkNavigationStore>()((set) => ({
  scopes: {},
  patch: (key, patch) =>
    set((state) => ({
      scopes: {
        ...state.scopes,
        [key]: { ...(state.scopes[key] ?? EMPTY_NAVIGATION), ...patch },
      },
    })),
  expand: (key, id, expanded) =>
    set((state) => {
      const current = state.scopes[key] ?? EMPTY_NAVIGATION;
      return {
        scopes: {
          ...state.scopes,
          [key]: { ...current, expanded: { ...current.expanded, [id]: expanded } },
        },
      };
    }),
}));

export function useWorkNavigation(
  serverId: string,
  projectId: string,
  domain: "works" | "experiments",
) {
  const key = JSON.stringify([serverId, projectId, domain]);
  const state = useNavigationStore((store) => store.scopes[key] ?? EMPTY_NAVIGATION);
  const select = useCallback(
    (selected: string | null) => useNavigationStore.getState().patch(key, { selected }),
    [key],
  );
  const expand = useCallback(
    (id: string, expanded: boolean) => useNavigationStore.getState().expand(key, id, expanded),
    [key],
  );
  const setSearch = useCallback(
    (search: string) => useNavigationStore.getState().patch(key, { search }),
    [key],
  );
  const setIncludeArchived = useCallback(
    (includeArchived: boolean) => useNavigationStore.getState().patch(key, { includeArchived }),
    [key],
  );
  return { ...state, select, expand, setSearch, setIncludeArchived };
}
