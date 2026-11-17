import type {
  WorkDataQuery,
  WorkDataQueryResult,
  WorkDataSeries,
} from "@getpaseo/protocol/work-data";
import { numeric, type WandbRun, type WandbRow } from "./records.js";
import { requireRun, scanHistory, type WandbSnapshot } from "./reader.js";

interface SeriesState extends SeriesTotals {
  lookup: string;
  result: WorkDataSeries;
  points: Array<[number, number]>;
  pointCount: number;
  visited: number;
}

export async function queryWandb(
  snapshot: WandbSnapshot,
  query: WorkDataQuery,
  signal?: AbortSignal,
): Promise<WorkDataQueryResult> {
  signal?.throwIfAborted();
  const run = requireRun(snapshot);
  const mode = query.mode ?? "series";
  let series: WorkDataSeries[];
  if (mode === "latest" && !query.range) {
    series = query.series.map((key) => latestValue(run, key));
  } else {
    series = await queryHistory(snapshot, query, signal);
  }
  return queryResult(snapshot, series);
}

function queryResult(snapshot: WandbSnapshot, series: WorkDataSeries[]): WorkDataQueryResult {
  const run = requireRun(snapshot);
  return {
    runId: run.id,
    generation: snapshot.generation,
    revision: snapshot.revision,
    activityAt: snapshot.activityAt,
    caughtUp: snapshot.caughtUp,
    ended: run.ended,
    lastStep: run.lastStep,
    error: snapshot.error,
    series,
  };
}

async function queryHistory(
  snapshot: WandbSnapshot,
  query: WorkDataQuery,
  signal?: AbortSignal,
  collectPoints = true,
): Promise<WorkDataSeries[]> {
  const mode = query.mode ?? "series";
  const states: SeriesState[] = query.series.map((key) => ({
    lookup: JSON.stringify(key),
    result: {
      key,
      status: "missing",
      count: 0,
      last: null,
      min: null,
      max: null,
      mean: null,
      time: null,
    },
    exists: false,
    invalid: false,
    sum: 0,
    points: [],
    pointCount: 0,
    visited: 0,
  }));
  if (!states.length) return [];
  const xKey = query.x?.kind === "metric" ? JSON.stringify(query.x.key) : null;
  const keys = new Set(states.map((state) => state.lookup));
  if (xKey) keys.add(xKey);
  let customX: number | null = null;
  function rowX(row: WandbRow): number | null {
    if (xKey && row.values.has(xKey)) customX = numeric(row.values.get(xKey));
    if (xKey) return customX;
    return query.x?.kind === "time" ? row.time : row.step;
  }
  await scanHistory(
    snapshot,
    keys,
    (row) => {
      const x = rowX(row);
      for (const state of states) {
        if (!row.values.has(state.lookup)) continue;
        state.exists = true;
        if (!withinRange(x, query)) continue;
        const value = numeric(row.values.get(state.lookup));
        if (value === null) {
          state.invalid = true;
          continue;
        }
        accumulateNumber(state.result, value, row.time);
        state.sum += value;
        if (mode === "series" && x !== null) {
          state.pointCount++;
          // Keep the requested output, never a full intermediate curve.
          if (
            collectPoints &&
            (query.maxPoints === undefined || state.points.length < query.maxPoints)
          )
            state.points.push([x, value]);
        }
      }
    },
    signal,
  );
  const sampled = states.filter(
    (state) => query.maxPoints !== undefined && state.pointCount > query.maxPoints,
  );
  if (collectPoints && mode === "series" && sampled.length) {
    for (const state of sampled) state.points = [];
    customX = null;
    const limit = query.maxPoints!;
    await scanHistory(
      snapshot,
      keys,
      (row) => {
        const x = rowX(row);
        if (x === null || !withinRange(x, query)) return;
        for (const state of sampled) {
          const value = numeric(row.values.get(state.lookup));
          if (value === null) continue;
          const target =
            limit === 1
              ? state.pointCount - 1
              : Math.round((state.points.length * (state.pointCount - 1)) / (limit - 1));
          if (state.visited === target) state.points.push([x, value]);
          state.visited++;
        }
      },
      signal,
    );
  }
  for (const state of states) {
    applySummaryFallback(requireRun(snapshot), state.lookup, query, state.result, state);
    if (collectPoints && mode === "series") {
      state.result.points = state.points;
      state.result.sampled = state.points.length !== state.pointCount;
    }
  }
  return states.map((state) => state.result);
}
function latestValue(run: WandbRun, key: string[]): WorkDataSeries {
  const lookup = JSON.stringify(key);
  const entry = run.latest.get(lookup);
  const hasValue = entry !== undefined || run.summary.has(lookup);
  const value = numeric(entry ? entry.value : run.summary.get(lookup));
  let status: WorkDataSeries["status"] = "missing";
  if (hasValue) status = value === null ? "non_numeric" : "available";
  return {
    key,
    status,
    count: value === null ? 0 : 1,
    last: value,
    min: value,
    max: value,
    mean: value,
    time: entry?.time ?? null,
  };
}
function withinRange(x: number | null, query: WorkDataQuery): boolean {
  if (!query.range) return true;
  if (x === null) return false;
  if (query.range.from !== undefined && x < query.range.from) return false;
  if (query.range.to !== undefined && x >= query.range.to) return false;
  return true;
}
interface SeriesTotals {
  exists: boolean;
  invalid: boolean;
  sum: number;
}
function applySummaryFallback(
  run: WandbRun,
  lookup: string,
  query: WorkDataQuery,
  result: WorkDataSeries,
  totals: SeriesTotals,
): void {
  const useSummary =
    !totals.exists &&
    run.summary.has(lookup) &&
    (query.mode ?? "series") !== "series" &&
    !query.range;
  if (useSummary) {
    totals.exists = true;
    const value = numeric(run.summary.get(lookup));
    if (value !== null) {
      result.count = 1;
      result.last = value;
      result.min = value;
      result.max = value;
      totals.sum = value;
    } else totals.invalid = true;
  }
  if (result.count > 0) {
    result.status = "available";
    result.mean = totals.sum / result.count;
  } else if (totals.invalid) result.status = "non_numeric";
  else if (totals.exists) result.status = "empty";
}

function accumulateNumber(result: WorkDataSeries, value: number, time: number | null): void {
  result.count++;
  result.last = value;
  result.time = time;
  result.min = result.min === null ? value : Math.min(result.min, value);
  result.max = result.max === null ? value : Math.max(result.max, value);
}

// The JSON API still returns complete history when maxPoints is omitted. Write
// that response incrementally so its size never becomes a daemon heap allocation.
export async function writeWandbQuery(
  snapshot: WandbSnapshot,
  query: WorkDataQuery,
  write: (chunk: string) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  if ((query.mode ?? "series") !== "series" || query.maxPoints !== undefined) {
    await write(JSON.stringify(await queryWandb(snapshot, query, signal)));
    return;
  }
  signal.throwIfAborted();
  const series = await queryHistory(snapshot, query, signal, false);
  const { series: _series, ...metadata } = queryResult(snapshot, series);
  await write(JSON.stringify(metadata).slice(0, -1) + ',"series":[');
  const xKey = query.x?.kind === "metric" ? JSON.stringify(query.x.key) : null;
  for (let index = 0; index < series.length; index++) {
    const entry = series[index]!;
    await write(
      (index ? "," : "") + JSON.stringify(entry).slice(0, -1) + ',"sampled":false,"points":[',
    );
    const lookup = JSON.stringify(entry.key);
    const keys = new Set([lookup]);
    if (xKey) keys.add(xKey);
    let customX: number | null = null;
    let first = true;
    let chunk = "";
    await scanHistory(
      snapshot,
      keys,
      (row) => {
        if (xKey && row.values.has(xKey)) customX = numeric(row.values.get(xKey));
        let x = query.x?.kind === "time" ? row.time : row.step;
        if (xKey) x = customX;
        const value = numeric(row.values.get(lookup));
        if (x === null || value === null || !withinRange(x, query)) return;
        chunk += (first ? "" : ",") + JSON.stringify([x, value]);
        first = false;
        if (chunk.length >= 64 * 1024) {
          const pending = write(chunk);
          chunk = "";
          return pending;
        }
      },
      signal,
    );
    await write(chunk + "]}");
  }
  await write("]}");
}
