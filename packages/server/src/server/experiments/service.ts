import { execFile } from "node:child_process";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CreateAttemptInput,
  CreateExperimentInput,
  ExperimentAttempt,
  ExperimentBoardPlacement,
  ExperimentDetail,
  ExperimentRecord,
  ProgressObservation,
  ProgressSource,
  UpdateAttemptInput,
  UpdateExperimentInput,
  ViewerConfig,
} from "@getpaseo/protocol/experiments";
import type { ProjectRegistry } from "../workspace-registry.js";
import { ExperimentStoreError, ProjectExperimentStore } from "./store.js";

const execFileAsync = promisify(execFile);
const INITIAL_LOG_TAIL_BYTES = 4 * 1024 * 1024;
const DEFAULT_REFRESH_MS = 15_000;

export interface ResolvedViewerEntry {
  name: string;
  path: string;
  url: string;
  available: boolean;
  unavailableReason: string | null;
}

export class ExperimentService {
  private readonly stores = new Map<string, Promise<ProjectExperimentStore>>();
  private readonly refreshes = new Map<string, Promise<ReturnTypeValue>>();

  constructor(private readonly projectRegistry: Pick<ProjectRegistry, "get">) {}

  async close(): Promise<void> {
    const stores = await Promise.all(this.stores.values());
    for (const store of stores) store.close();
    this.stores.clear();
  }

  async list(
    projectId: string,
    options: { goal?: string; includeClosed?: boolean; includeArchived?: boolean },
  ): Promise<ExperimentRecord[]> {
    return (await this.store(projectId)).listExperiments(options);
  }

  async get(projectId: string, experiment: string): Promise<ExperimentDetail> {
    return (await this.store(projectId)).getExperiment(experiment);
  }

  async createExperiment(
    projectId: string,
    input: CreateExperimentInput,
  ): Promise<ExperimentRecord> {
    return (await this.store(projectId)).createExperiment(input);
  }

  async updateExperiment(
    projectId: string,
    input: UpdateExperimentInput,
  ): Promise<ExperimentRecord> {
    return (await this.store(projectId)).updateExperiment(input);
  }

  async createAttempt(projectId: string, input: CreateAttemptInput): Promise<ExperimentAttempt> {
    return (await this.store(projectId)).createAttempt(input);
  }

  async updateAttempt(projectId: string, input: UpdateAttemptInput): Promise<ExperimentAttempt> {
    return (await this.store(projectId)).updateAttempt(input);
  }

  async getBoardLayout(projectId: string): Promise<ExperimentBoardPlacement[]> {
    return (await this.store(projectId)).getBoardLayout();
  }

  async updateBoardLayout(
    projectId: string,
    placements: ExperimentBoardPlacement[],
  ): Promise<ExperimentBoardPlacement[]> {
    return (await this.store(projectId)).updateBoardLayout(placements);
  }

  async resolveStorage(
    projectId: string,
    input:
      | { scope: "shared" }
      | { scope: "experiment"; experiment: string }
      | { scope: "attempt"; attempt: string },
  ): Promise<string> {
    return (await this.store(projectId)).resolveStorage(input);
  }

  async configureViewer(
    projectId: string,
    target: { experiment: string } | { attempt: string },
    viewer: ViewerConfig | null,
  ): Promise<ViewerConfig | null> {
    return (await this.store(projectId)).configureViewer(target, viewer);
  }

  async resolveViewers(
    projectId: string,
    target: { experiment: string } | { attempt: string },
  ): Promise<ResolvedViewerEntry[]> {
    const store = await this.store(projectId);
    const context =
      "attempt" in target
        ? store.getAttempt(target.attempt)
        : store.getExperiment(target.experiment).experiment;
    const experiment =
      "experiment" in context ? store.getExperiment(context.experiment).experiment : context;
    const attempt = "experiment" in context ? context : null;
    const viewer = this.resolveViewerConfig(store, experiment, attempt, new Set());
    if (!viewer) return [];
    const variables = await this.variables(store, experiment, attempt);
    const mounts = new Map<string, string>();
    for (const [mount, source] of Object.entries(viewer.mounts)) {
      assertRelativeViewerPath(mount, "mount");
      mounts.set(
        trimSlashes(mount),
        resolveConfiguredPath(expandVariables(source, variables), store.projectRoot),
      );
    }
    const prefix = attempt
      ? `/view/${encodeURIComponent(projectId)}/${experiment.id}/${attempt.id}`
      : `/view/${encodeURIComponent(projectId)}/${experiment.id}`;
    return Promise.all(
      Object.entries(viewer.entries).map(async ([name, entryPath]) => {
        assertRelativeViewerPath(entryPath, "entry");
        const normalized = trimSlashes(entryPath);
        const mount = Array.from(mounts.keys())
          .filter((candidate) => normalized === candidate || normalized.startsWith(`${candidate}/`))
          .sort((a, b) => b.length - a.length)[0];
        if (!mount) {
          return {
            name,
            path: normalized,
            url: `${prefix}/${normalized}`,
            available: false,
            unavailableReason: "Entry does not match a configured mount",
          };
        }
        const relative = normalized === mount ? "" : normalized.slice(mount.length + 1);
        const filePath = path.resolve(mounts.get(mount)!, relative);
        const available = await stat(filePath).then(
          () => true,
          () => false,
        );
        return {
          name,
          path: normalized,
          url: `${prefix}/${normalized}`,
          available,
          unavailableReason: available ? null : `File not found: ${filePath}`,
        };
      }),
    );
  }

  async resolveViewerFile(
    projectId: string,
    experimentId: string,
    attemptId: string | null,
    requestPath: string,
  ): Promise<string | null> {
    const store = await this.store(projectId);
    const experiment = store.getExperiment(experimentId).experiment;
    const attempt = attemptId ? store.getAttempt(attemptId) : null;
    if (attempt && attempt.experiment !== experiment.id) return null;
    const viewer = this.resolveViewerConfig(store, experiment, attempt, new Set());
    if (!viewer) return null;
    assertRelativeViewerPath(requestPath, "request");
    const normalized = trimSlashes(requestPath);
    const mount = Object.keys(viewer.mounts)
      .map(trimSlashes)
      .filter((candidate) => normalized === candidate || normalized.startsWith(`${candidate}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (!mount) return null;
    const variables = await this.variables(store, experiment, attempt);
    const configuredSource = Object.entries(viewer.mounts).find(
      ([candidate]) => trimSlashes(candidate) === mount,
    )?.[1];
    if (!configuredSource) return null;
    const root = resolveConfiguredPath(
      expandVariables(configuredSource, variables),
      store.projectRoot,
    );
    const relative = normalized === mount ? "" : normalized.slice(mount.length + 1);
    let candidate = path.resolve(root, relative);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
    const info = await stat(candidate).catch(() => null);
    if (info?.isDirectory()) candidate = path.join(candidate, "index.html");
    return (await stat(candidate).catch(() => null))?.isFile() ? candidate : null;
  }

  async refreshProgress(projectId: string, attemptId: string): Promise<ReturnTypeValue> {
    const key = `${projectId}:${attemptId}`;
    const active = this.refreshes.get(key);
    if (active) return active;
    const refresh = this.doRefreshProgress(projectId, attemptId).finally(() => {
      if (this.refreshes.get(key) === refresh) this.refreshes.delete(key);
    });
    this.refreshes.set(key, refresh);
    return refresh;
  }

  private async doRefreshProgress(projectId: string, attemptId: string): Promise<ReturnTypeValue> {
    const store = await this.store(projectId);
    const attempt = store.getAttempt(attemptId);
    if (!attempt.progressSource) {
      return {
        observation: attempt.progress,
        error: "Attempt has no progress source",
        nextRefreshAfterMs: null,
      };
    }
    try {
      const observation =
        attempt.progressSource.type === "log"
          ? await this.refreshLog(store, attempt, attempt.progressSource)
          : await this.refreshCommand(store, attempt, attempt.progressSource);
      return {
        observation,
        error: null,
        nextRefreshAfterMs: observation?.ended ? null : DEFAULT_REFRESH_MS,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.saveProgress({ attempt: attempt.id, observation: null, error: message });
      const latest = store.getProgressCursor(attempt.id).observation;
      return {
        observation: latest,
        error: message,
        nextRefreshAfterMs: latest?.ended ? null : DEFAULT_REFRESH_MS,
      };
    }
  }

  private async refreshLog(
    store: ProjectExperimentStore,
    attempt: ExperimentAttempt,
    source: Extract<ProgressSource, { type: "log" }>,
  ): Promise<ProgressObservation | null> {
    const experiment = store.getExperiment(attempt.experiment).experiment;
    const variables = await this.variables(store, experiment, attempt);
    const filePath = resolveConfiguredPath(
      expandVariables(source.path, variables),
      store.projectRoot,
    );
    const info = await stat(filePath);
    const identity = `${String(info.dev)}:${String(info.ino)}`;
    const cursor = store.getProgressCursor(attempt.id);
    let offset = cursor.logOffset;
    let partial = cursor.logPartial;
    if (cursor.logIdentity !== identity || info.size < offset) {
      offset = Math.max(0, info.size - INITIAL_LOG_TAIL_BYTES);
      partial = "";
    }
    const length = info.size - offset;
    const handle = await open(filePath, "r");
    let text = "";
    try {
      if (length > 0) {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, offset);
        text = buffer.toString("utf8");
      }
    } finally {
      await handle.close();
    }
    const combined = partial + text;
    const lines = combined.split(/\r?\n/);
    const nextPartial = lines.pop() ?? "";
    let values = cursor.observation;
    const progressRegex = compileRegex(source.progressRegex, "progressRegex");
    const endRegex = source.endRegex ? compileRegex(source.endRegex, "endRegex") : null;
    for (const line of lines) {
      const match = execLast(progressRegex, line);
      if (match?.groups?.current !== undefined) {
        values = observationFromGroups(match.groups, values, false);
      }
      if (endRegex && execLast(endRegex, line)) {
        values = values ? { ...values, ended: true } : values;
      }
    }
    const refreshedAt = new Date().toISOString();
    const observation = values
      ? {
          ...values,
          total: values.total ?? sourceProgressTotal(attempt),
          refreshedAt,
        }
      : null;
    store.saveProgress({
      attempt: attempt.id,
      observation,
      error: null,
      logOffset: info.size,
      logPartial: nextPartial,
      logIdentity: identity,
    });
    return observation;
  }

  private async refreshCommand(
    store: ProjectExperimentStore,
    attempt: ExperimentAttempt,
    source: Extract<ProgressSource, { type: "command" }>,
  ): Promise<ProgressObservation> {
    const experiment = store.getExperiment(attempt.experiment).experiment;
    const variables = await this.variables(store, experiment, attempt);
    const command = source.command.map((part) => expandVariables(part, variables));
    const cwd = source.cwd
      ? resolveConfiguredPath(expandVariables(source.cwd, variables), store.projectRoot)
      : store.projectRoot;
    const result = await execFileAsync(command[0]!, command.slice(1), {
      cwd,
      timeout: source.timeoutMs ?? 10_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
    const stdout = result.stdout.trim();
    let parsed: ParsedProgress;
    if (source.parse.type === "json") {
      parsed = parseJsonProgress(stdout);
    } else {
      const match = execLast(compileRegex(source.parse.regex, "command regex"), stdout);
      if (!match?.groups) throw new Error("Command output did not match the progress regex");
      parsed = parseProgressGroups(match.groups, true);
    }
    const observation: ProgressObservation = {
      current: parsed.current,
      total: parsed.total ?? sourceProgressTotal(attempt),
      ended: parsed.ended,
      phase: parsed.phase ?? null,
      message: parsed.message ?? null,
      refreshedAt: new Date().toISOString(),
    };
    store.saveProgress({ attempt: attempt.id, observation, error: null });
    return observation;
  }

  private resolveViewerConfig(
    store: ProjectExperimentStore,
    experiment: ExperimentRecord,
    attempt: ExperimentAttempt | null,
    visited: Set<string>,
  ): ViewerConfig | null {
    if (attempt?.viewer !== null && attempt?.viewer !== undefined) return attempt.viewer;
    if (experiment.viewer !== null) return experiment.viewer;
    if (visited.has(experiment.id)) {
      throw new ExperimentStoreError("invalid_reference", "Viewer inheritance cycle detected");
    }
    visited.add(experiment.id);
    const source = experiment.viewerSource ?? experiment.basedOn;
    if (!source) return null;
    return this.resolveViewerConfig(store, store.getExperiment(source).experiment, null, visited);
  }

  private async variables(
    store: ProjectExperimentStore,
    experiment: ExperimentRecord,
    attempt: ExperimentAttempt | null,
  ): Promise<Record<string, string | null>> {
    return {
      "project.root": store.projectRoot,
      "project.blobDir": await store
        .resolveStorage({ scope: "shared" })
        .then((value) => path.dirname(value)),
      "experiment.id": experiment.id,
      "experiment.blobDir": await store.resolveStorage({
        scope: "experiment",
        experiment: experiment.id,
      }),
      "attempt.id": attempt?.id ?? null,
      "attempt.blobDir": attempt
        ? await store.resolveStorage({ scope: "attempt", attempt: attempt.id })
        : null,
      "attempt.outputDir": attempt?.outputDir ?? null,
      "attempt.wandbId": attempt?.wandbId ?? null,
      "attempt.jobId": attempt?.jobId ?? null,
    };
  }

  private async store(projectId: string): Promise<ProjectExperimentStore> {
    let promise = this.stores.get(projectId);
    if (!promise) {
      promise = this.projectRegistry.get(projectId).then((project) => {
        if (!project) throw new ExperimentStoreError("not_found", `Project ${projectId} not found`);
        return ProjectExperimentStore.open(project.rootPath);
      });
      this.stores.set(projectId, promise);
    }
    return promise;
  }
}

interface ReturnTypeValue {
  observation: ProgressObservation | null;
  error: string | null;
  nextRefreshAfterMs: number | null;
}

interface ParsedProgress {
  current: number;
  total?: number;
  ended: boolean;
  phase?: string;
  message?: string;
}

function parseJsonProgress(stdout: string): ParsedProgress {
  const value = JSON.parse(stdout) as Record<string, unknown>;
  if (typeof value.current !== "number" || typeof value.ended !== "boolean") {
    throw new Error("Command JSON must contain numeric current and boolean ended");
  }
  return {
    current: value.current,
    ...(typeof value.total === "number" ? { total: value.total } : {}),
    ended: value.ended,
    ...(typeof value.phase === "string" ? { phase: value.phase } : {}),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
}

function parseProgressGroups(
  groups: Record<string, string | undefined>,
  requireEnded: boolean,
): ParsedProgress {
  const current = Number(groups.current);
  if (!Number.isFinite(current)) throw new Error("Progress regex must capture numeric current");
  if (requireEnded && groups.ended === undefined) {
    throw new Error("Command regex must capture ended");
  }
  return {
    current,
    ...(groups.total !== undefined ? { total: Number(groups.total) } : {}),
    ended: parseEnded(groups.ended),
    ...(groups.phase !== undefined ? { phase: groups.phase } : {}),
    ...(groups.message !== undefined ? { message: groups.message } : {}),
  };
}

function observationFromGroups(
  groups: Record<string, string | undefined>,
  previous: ProgressObservation | null,
  requireEnded: boolean,
): ProgressObservation {
  const parsed = parseProgressGroups(groups, requireEnded);
  return {
    current: parsed.current,
    total: parsed.total ?? previous?.total ?? null,
    ended: parsed.ended || previous?.ended === true,
    phase: parsed.phase ?? previous?.phase ?? null,
    message: parsed.message ?? previous?.message ?? null,
    refreshedAt: previous?.refreshedAt ?? new Date(0).toISOString(),
  };
}

function parseEnded(value: string | undefined): boolean {
  if (value === undefined) return false;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error("ended must be true, false, 1, or 0");
}

function sourceProgressTotal(attempt: ExperimentAttempt): number | null {
  const plans = attempt.progressPlans;
  return plans?.units.find((plan) => plan.unit === plans.sourceUnit)?.total ?? null;
}

function compileRegex(source: string, label: string): RegExp {
  try {
    return new RegExp(source, "g");
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

function execLast(regex: RegExp, value: string): RegExpExecArray | null {
  regex.lastIndex = 0;
  let last: RegExpExecArray | null = null;
  for (;;) {
    const match = regex.exec(value);
    if (!match) break;
    last = match;
    if (match[0] === "") regex.lastIndex += 1;
  }
  return last;
}

function expandVariables(template: string, variables: Record<string, string | null>): string {
  return template.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
    if (!(name in variables)) throw new Error(`Unknown progress variable: \${${name}}`);
    const value = variables[name];
    if (value === null) throw new Error(`Progress variable has no value: \${${name}}`);
    return value;
  });
}

function resolveConfiguredPath(value: string, projectRoot: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(projectRoot, value);
}

function assertRelativeViewerPath(value: string, label: string): void {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new ExperimentStoreError(
      "invalid_input",
      `Viewer ${label} must be a scoped relative path`,
    );
  }
}

function trimSlashes(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}
