import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  WorkObject,
  WorkResolvedViewers,
  WorkViewerEntries,
  WorkLocalSource,
  WorkSourceRef,
} from "@getpaseo/protocol/work-objects";
import { WorkError, WorkStore } from "./store.js";

export interface ResolvedWorkSource {
  config: WorkLocalSource;
  paths: string[];
  objectId: string;
  source: string;
}

export function resolveViewerConfig(store: WorkStore, object: WorkObject): WorkResolvedViewers {
  const visited = new Set<string>();
  let current: WorkObject | null = object;
  while (current) {
    if (visited.has(current.id))
      throw new WorkError(
        "invalid_reference",
        `Viewer inheritance cycle: ${[...visited, current.id].join(" → ")}`,
      );
    visited.add(current.id);
    if (current.viewers !== null)
      return {
        configured: object.viewers,
        resolved: current.viewers,
        inheritedFrom: current.id === object.id ? null : current.id,
      };
    if (current.kind === "item") current = store.getCard(current.parentCardId);
    else {
      const next: string | null = current.viewerSource ?? current.basedOn;
      current = next ? store.getCard(next) : null;
    }
  }
  return { configured: object.viewers, resolved: null, inheritedFrom: null };
}

export async function workVariables(
  store: WorkStore,
  object: WorkObject,
): Promise<Record<string, string>> {
  const storage = await store.storage(object.id);
  const card = object.kind === "card" ? object : store.getCard(object.parentCardId);
  const cardStorage = object.kind === "card" ? storage : await store.storage(card.id);
  const variables: Record<string, string> = {
    "project.root": store.projectRoot,
    "project.blobDir": path.dirname(storage.sharedPath),
    "storage.path": storage.path,
    "storage.sharedPath": storage.sharedPath,
    "card.id": card.id,
    "card.blobDir": cardStorage.path,
  };
  if (object.kind === "item") {
    variables["item.id"] = object.id;
    variables["item.blobDir"] = storage.path;
  }
  for (const [key, value] of Object.entries(object.config ?? {})) {
    if (["string", "number", "boolean"].includes(typeof value))
      variables[`config.${key}`] = String(value);
  }
  return variables;
}

export function expandWorkVariables(value: string, variables: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, key: string) => {
    const expanded = variables[key];
    if (expanded === undefined)
      throw new WorkError("invalid_input", `No value for variable ${key}`);
    return expanded;
  });
}

export function viewerBasePath(projectId: string, objectId: string): string {
  return `/view/v2/${encodeURIComponent(projectId)}/${objectId}`;
}
export function viewerDataPath(projectId: string, ref: WorkSourceRef): string {
  return `${viewerBasePath(projectId, ref.objectId)}/data/${encodeURIComponent(ref.source)}`;
}

export async function resolveWorkSource(
  store: WorkStore,
  ref: WorkSourceRef,
): Promise<ResolvedWorkSource> {
  const object = store.get(ref.objectId);
  const viewers = resolveViewerConfig(store, object).resolved;
  const config = viewers?.sources?.[ref.source];
  if (!config)
    throw new WorkError(
      "source_missing",
      `Viewer source ${ref.objectId}/${ref.source} is not configured`,
    );
  const variables = await workVariables(store, object);
  const paths = config.paths.map((value) =>
    path.resolve(store.projectRoot, expandWorkVariables(value, variables)),
  );
  return { config, paths, objectId: ref.objectId, source: ref.source };
}

export async function resolveViewerPath(
  store: WorkStore,
  objectId: string,
  requested: string,
): Promise<string | null> {
  const object = store.get(objectId);
  const viewer = resolveViewerConfig(store, object).resolved;
  if (!viewer) return null;
  const relative = normalizeViewerPath(requested);
  const matches = Object.entries(viewer.mounts ?? {}).map(([prefix, source]) => ({
    prefix: normalizeViewerPath(prefix),
    source,
  }));
  const matching = matches.filter(
    ({ prefix }) => prefix === "" || relative === prefix || relative.startsWith(`${prefix}/`),
  );
  matching.sort((a, b) => b.prefix.length - a.prefix.length);
  const mount = matching[0];
  if (!mount) return null;
  const variables = await workVariables(store, object);
  const root = path.resolve(store.projectRoot, expandWorkVariables(mount.source, variables));
  const suffix = relative.slice(mount.prefix.length).replace(/^\//, "");
  const candidate = path.resolve(root, suffix);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`))
    throw new WorkError("invalid_path", "Viewer path leaves its mount");
  return candidate;
}

export async function resolveViewerEntries(
  store: WorkStore,
  projectId: string,
  object: WorkObject,
): Promise<WorkViewerEntries> {
  const config = resolveViewerConfig(store, object);
  const entries = await Promise.all(
    Object.entries(config.resolved?.entries ?? {}).map(async ([name, value]) => {
      const entryPath = `${viewerBasePath(projectId, object.id)}/files/${encodeViewerPath(value)}`;
      try {
        const file = await resolveViewerPath(store, object.id, value);
        if (!file) throw new WorkError("mount_missing", "Entry does not match a configured mount");
        await stat(file);
        return { name, path: entryPath, available: true, unavailableReason: null };
      } catch (error) {
        return { name, path: entryPath, available: false, unavailableReason: errorMessage(error) };
      }
    }),
  );
  const sources = await Promise.all(
    Object.keys(config.resolved?.sources ?? {}).map(async (name) => {
      const source = { objectId: object.id, source: name };
      const apiPath = viewerDataPath(projectId, source);
      try {
        const resolved = await resolveWorkSource(store, source);
        const existing = await Promise.allSettled(resolved.paths.map((file) => stat(file)));
        if (!existing.some((value) => value.status === "fulfilled"))
          throw new WorkError("source_missing", "No mounted W&B input has been produced yet");
        return { source, apiPath, available: true, unavailableReason: null };
      } catch (error) {
        return { source, apiPath, available: false, unavailableReason: errorMessage(error) };
      }
    }),
  );
  return { entries, sources, inheritedFrom: config.inheritedFrom };
}

export function normalizeViewerPath(value: string): string {
  if (value.includes("\\") || value.includes("\0") || value.split("/").includes(".."))
    throw new WorkError("invalid_path", "Invalid viewer path");
  return value.replace(/^\/+|\/+$/g, "");
}
export function encodeViewerPath(value: string): string {
  return normalizeViewerPath(value).split("/").map(encodeURIComponent).join("/");
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
