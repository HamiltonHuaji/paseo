import { setImmediate } from "node:timers/promises";
import type {
  WorkDataQuery,
  WorkDataQueryResult,
  WorkDataSeries,
} from "@getpaseo/protocol/work-data";
import type { WandbRun } from "./records.js";
import { numeric } from "./records.js";
import { requireRun, type WandbSnapshot } from "./reader.js";

export async function queryWandb(
  snapshot: WandbSnapshot,
  query: WorkDataQuery,
  signal?: AbortSignal,
): Promise<WorkDataQueryResult> {
  const run = requireRun(snapshot);
  const series: WorkDataSeries[] = [];
  for (const key of query.series) series.push(await querySeries(run, key, query, signal));
  return {
    runId: run.id,
    generation: snapshot.generation,
    revision: snapshot.revision,
    activityAt: snapshot.activityAt,
    caughtUp: snapshot.caughtUp,
    ended: run.ended,
    lastStep: run.rows.at(-1)?.step ?? null,
    error: snapshot.error,
    series,
  };
}

async function querySeries(
  run: WandbRun,
  key: string[],
  query: WorkDataQuery,
  signal?: AbortSignal,
): Promise<WorkDataSeries> {
  const lookup = JSON.stringify(key);
  const mode = query.mode ?? "series";
  if (mode === "latest" && !query.range) return latestValue(run, key);
  const result: WorkDataSeries = {
    key,
    status: "missing",
    count: 0,
    last: null,
    min: null,
    max: null,
    mean: null,
    time: null,
  };
  const points: Array<[number, number]> = [];
  let sum = 0;
  let exists = false;
  let invalid = false;
  let customX: number | null = null;
  const xKey = query.x?.kind === "metric" ? JSON.stringify(query.x.key) : null;
  for (let i = 0; i < run.rows.length; i++) {
    if (i % 4096 === 0) {
      signal?.throwIfAborted();
      await setImmediate();
    }
    const row = run.rows[i]!;
    if (xKey && row.values.has(xKey)) customX = numeric(row.values.get(xKey));
    let x = row.step;
    if (query.x?.kind === "time") x = row.time;
    if (xKey) x = customX;
    if (!row.values.has(lookup)) continue;
    exists = true;
    if (!withinRange(x, query)) continue;
    const value = numeric(row.values.get(lookup));
    if (value === null) {
      invalid = true;
      continue;
    }
    accumulateNumber(result, value, row.time);
    sum += value;
    if (mode === "series" && x !== null) points.push([x, value]);
  }
  applySummaryFallback(run, lookup, query, result, { exists, invalid, sum });
  if (mode === "series") {
    result.points = samplePoints(points, query.maxPoints);
    result.sampled = result.points.length !== points.length;
  }
  return result;
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
function samplePoints(points: Array<[number, number]>, count?: number): Array<[number, number]> {
  if (count === undefined || points.length <= count) return points;
  if (count === 1) return [points.at(-1)!];
  return Array.from(
    { length: count },
    (_, index) => points[Math.round((index * (points.length - 1)) / (count - 1))]!,
  );
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
