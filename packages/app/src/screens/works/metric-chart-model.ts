import type { WorkDataSeries } from "@getpaseo/protocol/work-data";

export function formatMetric(value: number | null): string {
  if (value === null) return "—";
  if (value !== 0 && (Math.abs(value) < 0.0001 || Math.abs(value) >= 1e7)) {
    return value.toExponential(3);
  }
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 6 }).format(value);
}

export function plotGeometry(input: WorkDataSeries[], log: boolean) {
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity,
    excluded = 0;
  const paths = input.map((series) => {
    const runs: [number, number][][] = [[]];
    for (const [x, raw] of series.points ?? []) {
      if (!Number.isFinite(x) || !Number.isFinite(raw) || (log && raw <= 0)) {
        excluded++;
        if (runs.at(-1)?.length) runs.push([]);
        continue;
      }
      const y = log ? Math.log10(raw) : raw;
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
      runs.at(-1)!.push([x, y]);
    }
    return runs.filter((run) => run.length > 0);
  });
  return { paths, xMin, xMax, yMin, yMax, excluded };
}

export function numericTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const rough = (max - min) / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const factor = [1, 2, 5, 10].reduce((best, value) =>
    Math.abs(Math.log(normalized / value)) < Math.abs(Math.log(normalized / best)) ? value : best,
  );
  const step = factor * magnitude;
  const start = Math.ceil(min / step);
  const end = Math.floor(max / step);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) =>
    Number(((start + index) * step).toPrecision(12)),
  );
}

export function paddedDomain(min: number, max: number): [number, number] {
  const padding = min === max ? Math.max(Math.abs(min) * 0.05, 0.001) : (max - min) * 0.06;
  return [min - padding, max + padding];
}

export function logTicks(min: number, max: number): number[] {
  const values: number[] = [];
  const stride = Math.max(1, Math.ceil((max - min) / 5));
  for (let power = Math.floor(min); power <= Math.ceil(max); power += stride) {
    for (const factor of max - min < 2 ? [1, 2, 5] : [1]) {
      const value = power + Math.log10(factor);
      if (value >= min && value <= max) values.push(value);
    }
  }
  return values.length >= 2 ? values : numericTicks(min, max, 4);
}

// The inspection index is sorted separately from the chronological curve. Return recorded samples.
export function nearestPoint(
  points: [number, number][] | undefined,
  x: number,
): [number, number] | null {
  if (!points?.length) return null;
  let low = 0,
    high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid]![0] < x) low = mid + 1;
    else high = mid;
  }
  const right = points[low]!;
  const left = points[Math.max(0, low - 1)]!;
  return Math.abs(right[0] - x) < Math.abs(left[0] - x) ? right : left;
}
