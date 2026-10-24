import { z } from "zod";
import { mergeStoredEdits, parseStoredValue } from "@/storage/persisted-value";

export interface ActiveWorkspaceSelection {
  serverId: string;
  workspaceId: string;
}

export const LAST_WORKSPACE_SELECTION_STORAGE_KEY = "paseo:last-workspace-route-selection";

export interface LastWorkspaceSelectionStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}

const ActiveWorkspaceSelectionSchema: z.ZodType<ActiveWorkspaceSelection> = z.strictObject({
  serverId: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1),
});

function normalizeWorkspaceSelection(input: unknown): ActiveWorkspaceSelection | null {
  const result = ActiveWorkspaceSelectionSchema.safeParse(input);
  return result.success ? result.data : null;
}

export function createLastWorkspaceSelectionStore(storage: LastWorkspaceSelectionStorage) {
  let selection: ActiveWorkspaceSelection | null = null;
  let hydrated = false;
  let hydrationPromise: Promise<void> | null = null;
  let revision = 0;
  let writable = false;
  let snapshot: { raw: unknown; view: ActiveWorkspaceSelection } | null = null;
  const listeners = new Set<() => void>();

  function notifyListeners() {
    for (const listener of listeners) {
      listener();
    }
  }

  function remember(next: ActiveWorkspaceSelection) {
    const normalized = normalizeWorkspaceSelection(next);
    if (!normalized) {
      return;
    }
    if (
      selection?.serverId === normalized.serverId &&
      selection.workspaceId === normalized.workspaceId
    ) {
      persistSelection();
      return;
    }
    selection = normalized;
    revision += 1;
    notifyListeners();
    persistSelection();
  }

  function persistSelection(): void {
    if (!selection) return;
    if (!writable) {
      if (hydrated) void hydrate();
      return;
    }
    // workspaceId is opaque; do not parse this persisted selection back into a path.
    const raw = snapshot ? mergeStoredEdits(snapshot.raw, snapshot.view, selection) : selection;
    const view = selection;
    void storage.write(JSON.stringify(raw)).then(
      () => {
        snapshot = { raw, view };
        return undefined;
      },
      () => {
        console.warn(`Cannot save ${LAST_WORKSPACE_SELECTION_STORAGE_KEY}; previous data retained`);
      },
    );
  }

  function hydrate(): Promise<void> {
    if (hydrationPromise) {
      return hydrationPromise;
    }
    const hydrationRevision = revision;
    const hasLocalSelection = revision > 0;
    hydrationPromise = storage
      .read()
      .then((stored) => {
        const raw: unknown = stored === null ? null : JSON.parse(stored);
        const restored =
          stored === null
            ? null
            : parseStoredValue(
                ActiveWorkspaceSelectionSchema,
                raw,
                LAST_WORKSPACE_SELECTION_STORAGE_KEY,
              );
        snapshot = restored ? { raw, view: restored } : null;
        writable = true;
        if (revision === hydrationRevision && !hasLocalSelection) {
          selection = restored;
        } else persistSelection();
        return undefined;
      })
      .catch(() => {
        if (revision === hydrationRevision && !hasLocalSelection) {
          selection = null;
        }
        console.warn(`Cannot read ${LAST_WORKSPACE_SELECTION_STORAGE_KEY}; previous data retained`);
      })
      .finally(() => {
        if (!writable) hydrationPromise = null;
        hydrated = true;
        notifyListeners();
      });
    return hydrationPromise;
  }

  return {
    getSelection: () => selection,
    hydrate,
    isHydrated: () => hydrated,
    remember,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
