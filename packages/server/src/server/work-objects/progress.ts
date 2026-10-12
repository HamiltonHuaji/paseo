import { execFile } from "node:child_process";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type {
  WorkObject,
  WorkObservation,
  WorkProgressSource,
  WorkProgressState,
  WorkProgressRefreshResult,
  WorkSourceRef,
} from "@getpaseo/protocol/work-objects";
import { WorkStore, WorkError } from "./store.js";
import { workVariables, expandWorkVariables, errorMessage } from "./viewers.js";
import { queryWandb } from "./wandb/query.js";
import type { WandbSnapshot } from "./wandb/reader.js";

const exec = promisify(execFile);
const LogCursorSchema = z.object({
  identity: z.string(),
  offset: z.number(),
  partial: z.string(),
  head: z.string(),
  headBytes: z.number(),
});
const ParsedProgressSchema = z.object({
  current: z.number(),
  total: z.number().optional(),
  ended: z.boolean(),
  phase: z.string().optional(),
  message: z.string().optional(),
});
interface ReadProgress {
  observation: WorkObservation | null;
  activityAt?: string;
  catchingUp: boolean;
  cursor?: unknown;
  error?: string;
}
type ReadSource = (source: WorkSourceRef) => Promise<WandbSnapshot>;

export class WorkProgressReader {
  private readonly active = new Map<string, Promise<WorkProgressRefreshResult>>();
  refresh(
    store: WorkStore,
    objectId: string,
    readSource: ReadSource,
  ): Promise<WorkProgressRefreshResult> {
    const key = `${store.projectRoot}:${objectId}`;
    const pending = this.active.get(key);
    if (pending) return pending;
    const task = this.read(store, objectId, readSource).finally(() => this.active.delete(key));
    this.active.set(key, task);
    return task;
  }
  private async read(
    store: WorkStore,
    objectId: string,
    readSource: ReadSource,
  ): Promise<WorkProgressRefreshResult> {
    const object = store.get(objectId);
    const source = object.progress?.source;
    if (!source)
      return {
        objectId,
        ...object.progressState,
        error: "No progress source configured",
        nextRefreshAfterMs: null,
      };
    const checkedAt = new Date().toISOString();
    try {
      const values = await this.readValues(store, object, source, readSource);
      const latest = store.get(objectId);
      if (JSON.stringify(latest.progress?.source) !== JSON.stringify(source))
        return { objectId, ...latest.progressState, nextRefreshAfterMs: 15000 };
      if (values.cursor !== undefined) store.saveObservationState(objectId, values.cursor);
      const state = {
        observation: values.observation,
        checkedAt,
        error: values.error ?? null,
        catchingUp: values.catchingUp,
      };
      const sourceIsExecution = source.type !== "viewer-source";
      const observed = values.observation !== null;
      const started = sourceIsExecution && observed ? checkedAt : undefined;
      const ended =
        sourceIsExecution && values.observation?.ended
          ? (values.activityAt ?? checkedAt)
          : undefined;
      store.saveProgress({
        objectId,
        state,
        activityAt: values.activityAt,
        executionStartedAt: started,
        executionEndedAt: ended,
      });
      return { objectId, ...state, nextRefreshAfterMs: nextRefresh(source, state) };
    } catch (error) {
      const latest = store.get(objectId);
      if (JSON.stringify(latest.progress?.source) !== JSON.stringify(source))
        return { objectId, ...latest.progressState, nextRefreshAfterMs: 15000 };
      const state = { ...latest.progressState, checkedAt, error: errorMessage(error) };
      store.saveProgress({ objectId, state });
      return { objectId, ...state, nextRefreshAfterMs: 15000 };
    }
  }
  private async readValues(
    store: WorkStore,
    object: WorkObject,
    source: WorkProgressSource,
    readSource: ReadSource,
  ): Promise<ReadProgress> {
    if (source.type === "viewer-source")
      return readViewerProgress(store, object, source, readSource);
    const variables = await workVariables(store, object);
    if (source.type === "log") return readLog(store, object, source, variables);
    const argv = source.argv.map((value) => expandWorkVariables(value, variables));
    const cwd = source.cwd
      ? path.resolve(store.projectRoot, expandWorkVariables(source.cwd, variables))
      : store.projectRoot;
    const output = await exec(argv[0]!, argv.slice(1), {
      cwd,
      timeout: source.timeoutMs ?? 10000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
    const parsed =
      source.parse.type === "json"
        ? ParsedProgressSchema.parse(JSON.parse(output.stdout))
        : parseGroups(lastMatch(source.parse.regex, output.stdout), true);
    const observation = makeObservation(object, parsed);
    const previous = object.progressState.observation;
    const changed =
      !previous ||
      JSON.stringify({ ...previous, observedAt: "" }) !==
        JSON.stringify({ ...observation, observedAt: "" });
    return {
      observation,
      activityAt: changed ? observation.observedAt : undefined,
      catchingUp: false,
    };
  }
}

function nextRefresh(source: WorkProgressSource, state: WorkProgressState): number | null {
  return source.type !== "viewer-source" &&
    state.observation?.ended &&
    !state.catchingUp &&
    !state.error
    ? null
    : 15000;
}

async function readLog(
  store: WorkStore,
  object: WorkObject,
  source: Extract<WorkProgressSource, { type: "log" }>,
  variables: Record<string, string>,
): Promise<ReadProgress> {
  const file = path.resolve(store.projectRoot, expandWorkVariables(source.path, variables));
  const info = await stat(file);
  const identity = `${info.dev}:${info.ino}`;
  const saved = LogCursorSchema.safeParse(store.readObservationState(object.id));
  const handle = await open(file, "r");
  const head = Buffer.alloc(Math.min(128, info.size));
  try {
    await handle.read(head, 0, head.length, 0);
  } catch (error) {
    await handle.close();
    throw error;
  }
  const reusable =
    saved.success &&
    saved.data.identity === identity &&
    info.size >= saved.data.offset &&
    head.subarray(0, saved.data.headBytes).toString("base64") === saved.data.head;
  const offset = reusable ? saved.data.offset : Math.max(0, info.size - 4 * 1024 * 1024);
  const partial = reusable ? saved.data.partial : "";
  let bytes: Buffer;
  try {
    bytes = Buffer.alloc(info.size - offset);
    await handle.read(bytes, 0, bytes.length, offset);
  } finally {
    await handle.close();
  }
  const lines = (partial + bytes.toString("utf8")).split(/\r?\n/);
  const nextPartial = lines.pop() ?? "";
  let observation = reusable ? object.progressState.observation : null;
  for (const line of lines) {
    const match = lastMatch(source.progressRegex, line);
    if (match?.current !== undefined) {
      const parsed = parseGroups(match, false);
      observation = mergeLogObservation(object, parsed, observation);
    }
    if (source.endRegex && lastMatch(source.endRegex, line) && observation)
      observation = { ...observation, ended: true };
  }
  return {
    observation,
    activityAt: bytes.length > 0 ? info.mtime.toISOString() : undefined,
    catchingUp: false,
    cursor: {
      identity,
      offset: info.size,
      partial: nextPartial,
      head: head.toString("base64"),
      headBytes: head.length,
    },
  };
}
function mergeLogObservation(
  object: WorkObject,
  parsed: z.infer<typeof ParsedProgressSchema>,
  previous: WorkObservation | null,
): WorkObservation {
  return makeObservation(object, {
    ...parsed,
    total: parsed.total ?? previous?.total ?? undefined,
    ended: parsed.ended || previous?.ended === true,
  });
}

async function readViewerProgress(
  store: WorkStore,
  object: WorkObject,
  source: Extract<WorkProgressSource, { type: "viewer-source" }>,
  readSource: ReadSource,
): Promise<ReadProgress> {
  const snapshot = await readSource(source.source);
  const oldGeneration = store.readObservationState(object.id);
  const old = z.object({ generation: z.string() }).safeParse(oldGeneration);
  const changed = old.success && old.data.generation !== snapshot.generation;
  const fallback = {
    observation: changed ? null : object.progressState.observation,
    catchingUp: !snapshot.caughtUp,
    cursor: { generation: snapshot.generation },
  };
  const keys: string[][] = [];
  if (source.current.kind === "metric") keys.push(source.current.key);
  if (typeof source.total === "object") keys.push(source.total.key);
  let queried;
  try {
    queried = await queryWandb(snapshot, { series: keys, mode: "latest" });
  } catch (error) {
    return { ...fallback, error: errorMessage(error) };
  }
  const current = source.current.kind === "step" ? queried.lastStep : queried.series[0]?.last;
  if (current === null || current === undefined)
    return { ...fallback, error: "Progress current metric has no numeric value" };
  let total: number | undefined;
  if (typeof source.total === "number") total = source.total;
  if (typeof source.total === "object") {
    total = queried.series.at(-1)?.last ?? undefined;
    if (total === undefined)
      return { ...fallback, error: "Progress total metric has no numeric value" };
  }
  const observation = makeObservation(object, { current, total, ended: queried.ended === true });
  return {
    ...fallback,
    observation,
    activityAt: queried.activityAt ?? undefined,
    catchingUp: !queried.caughtUp,
    error: queried.error ?? undefined,
  };
}
function makeObservation(
  object: WorkObject,
  parsed: z.infer<typeof ParsedProgressSchema>,
): WorkObservation {
  const plan = object.progress?.plan;
  const plannedTotal = plan?.units.find((unit) => unit.unit === plan.sourceUnit)?.total;
  return {
    current: parsed.current,
    total: parsed.total ?? plannedTotal ?? null,
    ended: parsed.ended,
    phase: parsed.phase ?? null,
    message: parsed.message ?? null,
    observedAt: new Date().toISOString(),
  };
}
function lastMatch(pattern: string, value: string): Record<string, string> | null {
  const matches = value.matchAll(new RegExp(pattern, "g"));
  let last: RegExpMatchArray | null = null;
  for (const match of matches) last = match;
  return last ? (last.groups ?? {}) : null;
}
function parseGroups(
  groups: Record<string, string> | null,
  requireEnded: boolean,
): z.infer<typeof ParsedProgressSchema> {
  if (!groups) throw new WorkError("invalid_progress", "Progress pattern did not match");
  if (requireEnded && groups.ended === undefined)
    throw new WorkError("invalid_progress", "Command pattern must capture ended");
  const ended = groups.ended ?? "false";
  if (!["true", "false", "1", "0"].includes(ended))
    throw new WorkError("invalid_progress", "ended must be true, false, 1 or 0");
  return ParsedProgressSchema.parse({
    current: Number(groups.current),
    total: groups.total === undefined ? undefined : Number(groups.total),
    ended: ended === "true" || ended === "1",
    phase: groups.phase,
    message: groups.message,
  });
}
