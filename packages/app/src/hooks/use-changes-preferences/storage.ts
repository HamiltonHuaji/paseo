import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  readValidatedJson,
  readValidatedString,
  writeValidatedJson,
} from "@/storage/validated-storage";

export const CHANGES_PREFERENCES_STORAGE_KEY = "@paseo:changes-preferences";
export const LEGACY_WRAP_LINES_STORAGE_KEY = "diff-wrap-lines";
export const CHANGES_PREFERENCES_QUERY_KEY = ["changes-preferences"];

const changesPreferencesSchema = z.strictObject({
  layout: z.enum(["unified", "split"]).optional(),
  desktopTreeVisible: z.boolean().optional(),
  // Read the former overloaded preference once so existing installations keep their desktop tree.
  viewMode: z.enum(["flat", "tree"]).optional(),
  wrapLines: z.boolean().optional(),
  hideWhitespace: z.boolean().optional(),
  inlineDiff: z.boolean().optional(),
  commitsCollapsed: z.boolean().optional(),
});

export interface ChangesPreferences {
  layout: "unified" | "split";
  desktopTreeVisible: boolean;
  wrapLines: boolean;
  hideWhitespace: boolean;
  inlineDiff: boolean;
  commitsCollapsed: boolean;
}

export const DEFAULT_CHANGES_PREFERENCES: ChangesPreferences = {
  layout: "unified",
  desktopTreeVisible: false,
  wrapLines: false,
  hideWhitespace: false,
  inlineDiff: false,
  commitsCollapsed: true,
};

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

async function loadLegacyWrapLinesPreference(storage: KeyValueStorage): Promise<boolean | null> {
  const legacyValue = await readValidatedString(
    storage,
    LEGACY_WRAP_LINES_STORAGE_KEY,
    z.enum(["true", "false"]),
  );
  return legacyValue === null ? null : legacyValue === "true";
}

export async function loadChangesPreferencesFromStorage(
  storage: KeyValueStorage,
): Promise<ChangesPreferences> {
  const stored = await readValidatedJson(
    storage,
    CHANGES_PREFERENCES_STORAGE_KEY,
    changesPreferencesSchema,
  );
  if (stored) {
    const { viewMode, ...currentPreferences } = stored;
    return {
      ...DEFAULT_CHANGES_PREFERENCES,
      ...currentPreferences,
      desktopTreeVisible: stored.desktopTreeVisible ?? viewMode === "tree",
    };
  }

  const legacyWrapLines = await loadLegacyWrapLinesPreference(storage);
  const next = {
    ...DEFAULT_CHANGES_PREFERENCES,
    ...(legacyWrapLines !== null ? { wrapLines: legacyWrapLines } : {}),
  } satisfies ChangesPreferences;
  await writeValidatedJson(
    storage,
    CHANGES_PREFERENCES_STORAGE_KEY,
    changesPreferencesSchema,
    next,
  );
  return next;
}

const preferenceWrites = new WeakMap<KeyValueStorage, Promise<void>>();

export async function saveChangesPreferences(input: {
  queryClient: QueryClient;
  updates: Partial<ChangesPreferences>;
  storage: KeyValueStorage;
}): Promise<void> {
  const write = (preferenceWrites.get(input.storage) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => saveChangesPreferencesNow(input));
  preferenceWrites.set(input.storage, write);
  await write;
}

async function saveChangesPreferencesNow(input: {
  queryClient: QueryClient;
  updates: Partial<ChangesPreferences>;
  storage: KeyValueStorage;
}): Promise<void> {
  const prev = await loadChangesPreferencesFromStorage(input.storage);
  const next = { ...prev, ...input.updates };
  await writeValidatedJson(
    input.storage,
    CHANGES_PREFERENCES_STORAGE_KEY,
    changesPreferencesSchema,
    next,
  );
  input.queryClient.setQueryData<ChangesPreferences>(CHANGES_PREFERENCES_QUERY_KEY, next);
}
