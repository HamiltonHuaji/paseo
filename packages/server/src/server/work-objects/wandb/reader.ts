import { createHash, randomUUID } from "node:crypto";
import { open, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { z } from "zod";
import type { WorkDataMeta, WorkArtifact } from "@getpaseo/protocol/work-data";
import { WorkError } from "../store.js";
import { encodeViewerPath, errorMessage, type ResolvedWorkSource } from "../viewers.js";
import { scanWandb } from "./binary.js";
import {
  applyRecord,
  emptyRun,
  type WandbRun,
  type WandbArtifact,
  type WandbArtifactFile,
} from "./records.js";
import { restoreCache, persistCache } from "./cache.js";

interface LogState {
  identity: string;
  offset: number;
  anchor: string;
  size: number;
  mtime: number;
  run: WandbRun;
  caughtUp: boolean;
  error: string | null;
}
interface MountedPath {
  path: string;
  directory: boolean;
}
export interface WandbSnapshot {
  runs: WandbRun[];
  run: WandbRun | null;
  generation: string;
  revision: number;
  activityAt: string | null;
  caughtUp: boolean;
  error: string | null;
  mounts: MountedPath[];
}
interface SourceCache {
  generation: string;
  logs: Map<string, LogState>;
  revision: number;
  active: Promise<WandbSnapshot> | null;
  restored: boolean;
  directory: string | null;
}
const inflate = promisify(gunzip);
const ManifestEntrySchema = z.object({
  path: z.string(),
  digest: z.string().optional(),
  ref: z.string().optional(),
  size: z.number().optional(),
  local_path: z.string().optional(),
});

export class WandbReader {
  private readonly sources = new Map<string, SourceCache>();
  clear(): void {
    this.sources.clear();
  }

  async read(
    source: ResolvedWorkSource,
    signal?: AbortSignal,
    cacheRoot?: string,
  ): Promise<WandbSnapshot> {
    signal?.throwIfAborted();
    const key = JSON.stringify([cacheRoot ?? null, [...new Set(source.paths)].sort()]);
    let cache = this.sources.get(key);
    if (!cache) {
      const directory = cacheRoot
        ? path.join(cacheRoot, createHash("sha256").update(key).digest("hex"))
        : null;
      cache = {
        generation: randomUUID(),
        logs: new Map(),
        revision: 0,
        active: null,
        restored: false,
        directory,
      };
      this.sources.set(key, cache);
    }
    let pending = cache.active;
    if (!pending) {
      const current = cache;
      pending = this.refresh(source.paths, current).finally(() => {
        current.active = null;
      });
      current.active = pending;
    }
    const snapshot = await waitForSnapshot(pending, signal);
    let run: WandbRun | null = null;
    if (source.config.runId)
      run = snapshot.runs.find((value) => value.id === source.config.runId) ?? null;
    else if (snapshot.runs.length === 1) run = snapshot.runs[0]!;
    return { ...snapshot, generation: `${snapshot.generation}:${run?.id ?? ""}`, run };
  }

  meta(snapshot: WandbSnapshot): WorkDataMeta {
    const run = snapshot.run;
    const keys = new Set<string>(run?.summary.keys());
    for (const key of run?.latest.keys() ?? []) keys.add(key);
    return {
      runs: snapshot.runs.map(runMeta),
      run: run ? runMeta(run) : null,
      generation: snapshot.generation,
      revision: snapshot.revision,
      activityAt: snapshot.activityAt,
      caughtUp: snapshot.caughtUp,
      error: snapshot.error,
      keys: [...keys].map((key) => z.array(z.string()).parse(JSON.parse(key))),
      config: Object.fromEntries(run?.config ?? []),
      summary: Object.fromEntries(run?.summary ?? []),
    };
  }

  async artifacts(snapshot: WandbSnapshot, apiPath: string): Promise<WorkArtifact[]> {
    const run = requireRun(snapshot);
    const artifacts: WorkArtifact[] = [];
    for (const artifact of run.artifacts.values()) {
      let unavailableReason: string | null = null;
      let entries = artifact.files;
      try {
        entries = await artifactEntries(artifact, snapshot.mounts);
      } catch (error) {
        unavailableReason = errorMessage(error);
      }
      const files = await Promise.all(
        entries.map(async (entry) => {
          const file = await locateContent(entry, snapshot.mounts);
          return {
            path: entry.path,
            size: entry.size,
            available: file !== null,
            unavailableReason: file
              ? null
              : "Artifact content is not present in the mounted local inputs",
            href: file
              ? `${apiPath}/artifacts/${encodeURIComponent(artifact.id)}/files/${encodeViewerPath(entry.path)}`
              : null,
          };
        }),
      );
      artifacts.push({
        id: artifact.id,
        name: artifact.name,
        type: artifact.type,
        description: artifact.description,
        aliases: artifact.aliases,
        unavailableReason,
        files,
      });
    }
    return artifacts;
  }

  async artifactFile(
    snapshot: WandbSnapshot,
    artifactId: string,
    requested: string,
  ): Promise<string> {
    const artifact = requireRun(snapshot).artifacts.get(artifactId);
    if (!artifact) throw new WorkError("not_found", `Artifact ${artifactId} not found`);
    const entries = await artifactEntries(artifact, snapshot.mounts);
    const entry = entries.find((value) => value.path === requested);
    if (!entry) throw new WorkError("not_found", `Artifact entry ${requested} not found`);
    const file = await locateContent(entry, snapshot.mounts);
    if (!file) throw new WorkError("file_missing", "Artifact content is not mounted locally");
    return file;
  }

  private async refresh(paths: string[], cache: SourceCache): Promise<WandbSnapshot> {
    if (!cache.restored) {
      const saved = cache.directory ? await restoreCache(cache.directory) : null;
      if (saved) {
        cache.generation = saved.generation;
        cache.logs = saved.logs;
        cache.revision = saved.revision;
      }
      cache.restored = true;
    }
    const mounts = await mountedPaths(paths);
    const files = await discoverLogs(mounts);
    const found = new Set(files);
    let changed = false;
    for (const old of cache.logs.keys())
      if (!found.has(old)) {
        cache.logs.delete(old);
        cache.generation = randomUUID();
        changed = true;
      }
    for (const file of files) changed = (await refreshLog(cache, file)) || changed;
    if (changed) cache.revision += 1;
    const logs = [...cache.logs.values()];
    const generation = cache.generation;
    const runs = mergeRuns(logs);
    const errors = logs.flatMap((log) => (log.error ? [log.error] : []));
    if (changed && cache.directory) {
      try {
        await persistCache(cache.directory, {
          generation: cache.generation,
          revision: cache.revision,
          logs: cache.logs,
        });
      } catch (error) {
        errors.push(`Unable to save derived W&B cache: ${errorMessage(error)}`);
      }
    }
    if (!files.length)
      errors.push("No local W&B transaction log has been produced in these mounts");
    const activity = logs.flatMap((log) => [
      log.run.activityAt ?? "",
      new Date(log.mtime).toISOString(),
    ]);
    activity.sort();
    return {
      runs,
      run: null,
      mounts,
      generation,
      revision: cache.revision,
      activityAt: activity.at(-1) ?? null,
      caughtUp: logs.length > 0 && logs.every((log) => log.caughtUp),
      error: errors.length ? errors.join("; ") : null,
    };
  }
}

function runMeta(run: WandbRun) {
  return {
    id: run.id,
    name: run.name,
    project: run.project,
    entity: run.entity,
    startedAt: run.startedAt,
  };
}
export function requireRun(snapshot: WandbSnapshot): WandbRun {
  if (snapshot.run) return snapshot.run;
  if (snapshot.runs.length > 1)
    throw new WorkError("run_required", "Select a runId from this source's /meta response");
  throw new WorkError("source_missing", snapshot.error ?? "The selected W&B run is not present");
}

async function mountedPaths(paths: string[]): Promise<MountedPath[]> {
  const result: MountedPath[] = [];
  for (const file of new Set(paths)) {
    try {
      const info = await stat(file);
      result.push({ path: file, directory: info.isDirectory() });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return result;
}
function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
async function discoverLogs(mounts: MountedPath[]): Promise<string[]> {
  const found = new Set<string>();
  const visited = new Set<string>();
  const directories = mounts.filter((mount) => mount.directory).map((mount) => mount.path);
  for (const mount of mounts)
    if (!mount.directory && mount.path.endsWith(".wandb")) found.add(mount.path);
  while (directories.length) {
    const directory = directories.pop()!;
    const physical = await realpath(directory);
    if (visited.has(physical)) continue;
    visited.add(physical);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isFile() && entry.name.endsWith(".wandb")) found.add(file);
      if (
        entry.isDirectory() &&
        !["files", "media", "logs", "code", "obj", "tmp", ".git"].includes(entry.name)
      )
        directories.push(file);
    }
  }
  return [...found].sort();
}

async function refreshLog(cache: SourceCache, file: string): Promise<boolean> {
  const info = await stat(file);
  const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
  let log = cache.logs.get(file);
  if (log?.identity === identity && log.size === info.size && log.mtime === info.mtimeMs)
    return false;
  const rewritten =
    log &&
    (log.identity !== identity ||
      info.size < log.size ||
      (info.size === log.size && info.mtimeMs !== log.mtime) ||
      (await logAnchor(file, log.offset)) !== log.anchor);
  if (!log || rewritten) {
    if (rewritten) cache.generation = randomUUID();
    log = {
      identity,
      offset: 0,
      anchor: "",
      size: -1,
      mtime: 0,
      run: emptyRun(),
      caughtUp: false,
      error: null,
    };
    cache.logs.set(file, log);
  }
  const before = log.offset;
  log.size = info.size;
  log.mtime = info.mtimeMs;
  try {
    const target = log;
    const result = await scanWandb(file, log.offset, (bytes, offset) => {
      applyRecord(target.run, bytes);
      target.offset = offset;
    });
    log.offset = result.offset;
    log.caughtUp = result.caughtUp;
    log.error = null;
  } catch (error) {
    log.error = errorMessage(error);
    log.caughtUp = false;
  }
  log.anchor = await logAnchor(file, log.offset);
  return rewritten === true || log.offset !== before;
}

async function logAnchor(file: string, offset: number): Promise<string> {
  if (!offset) return "";
  const handle = await open(file, "r");
  try {
    const length = Math.min(128, offset);
    const bytes = Buffer.alloc(length * 2);
    await handle.read(bytes, 0, length, 0);
    await handle.read(bytes, length, length, offset - length);
    return createHash("sha256").update(bytes).digest("hex");
  } finally {
    await handle.close();
  }
}

function mergeRuns(logs: LogState[]): WandbRun[] {
  const groups = new Map<string, WandbRun>();
  const ordered = [...logs].sort((a, b) => segmentTime(a) - segmentTime(b));
  for (const { run } of ordered) {
    if (!run.id) continue;
    let combined = groups.get(run.id);
    if (!combined) {
      combined = {
        ...emptyRun(),
        ...run,
        rows: [],
        artifacts: new Map(),
        config: new Map(),
        summary: new Map(),
        latest: new Map(),
      };
      groups.set(run.id, combined);
    }
    combined.rows = combined.rows.concat(run.rows);
    combined.ended = run.ended;
    for (const [key, value] of run.config) combined.config.set(key, value);
    for (const [key, value] of run.summary) combined.summary.set(key, value);
    for (const [key, value] of run.latest) combined.latest.set(key, value);
    for (const [key, value] of run.artifacts) combined.artifacts.set(key, value);
  }
  return [...groups.values()];
}

function segmentTime(log: LogState): number {
  return log.run.rows[0]?.time ?? (Date.parse(log.run.startedAt ?? "") || log.mtime) / 1000;
}

// A closed HTTP request stops waiting without cancelling another consumer's shared scan.
function waitForSnapshot(
  pending: Promise<WandbSnapshot>,
  signal?: AbortSignal,
): Promise<WandbSnapshot> {
  if (!signal) return pending;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function artifactEntries(
  artifact: WandbArtifact,
  mounts: MountedPath[],
): Promise<WandbArtifactFile[]> {
  if (!artifact.manifestPath) return artifact.files;
  const file = await allowedFile(artifact.manifestPath, mounts);
  if (!file)
    throw new WorkError(
      "file_missing",
      "Artifact manifest is not present in the mounted local inputs",
    );
  const buffer = await readFile(file);
  const text = (file.endsWith(".gz") ? await inflate(buffer) : buffer).toString("utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const entry = ManifestEntrySchema.parse(JSON.parse(line));
      return {
        path: entry.path,
        digest: entry.digest ?? "",
        ref: entry.ref ?? "",
        size: entry.size ?? 0,
        localPath: entry.local_path ?? "",
      };
    });
}
async function allowedFile(candidate: string, mounts: MountedPath[]): Promise<string | null> {
  const resolved = path.resolve(candidate);
  const allowed = mounts.some(
    (mount) =>
      resolved === mount.path ||
      (mount.directory && resolved.startsWith(`${mount.path}${path.sep}`)),
  );
  if (!allowed) return null;
  try {
    return (await stat(resolved)).isFile() ? resolved : null;
  } catch (error) {
    if (!isMissing(error)) throw error;
    return null;
  }
}
async function locateContent(
  entry: WandbArtifactFile,
  mounts: MountedPath[],
): Promise<string | null> {
  const candidates = [];
  if (entry.localPath) candidates.push(entry.localPath);
  if (entry.ref.startsWith("file://")) candidates.push(decodeURIComponent(entry.ref.slice(7)));
  const digest = Buffer.from(entry.digest, "base64").toString("hex");
  for (const mount of mounts) {
    if (!mount.directory) continue;
    candidates.push(
      path.resolve(mount.path, entry.path),
      path.resolve(mount.path, "files", entry.path),
    );
    if (digest)
      for (const root of ["obj/md5", "artifacts/obj/md5", "md5", ""])
        candidates.push(path.join(mount.path, root, digest.slice(0, 2), digest.slice(2)));
  }
  for (const candidate of candidates) {
    const found = await allowedFile(candidate, mounts);
    if (found) return found;
  }
  return null;
}
