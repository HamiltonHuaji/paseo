import type { ProgressUnitPlan } from "@getpaseo/protocol/experiments";

export function projectProgressCurrent(
  sourceCurrent: number,
  sourceUnit: string,
  targetPlan: ProgressUnitPlan,
): number | null {
  if (targetPlan.unit === sourceUnit) return sourceCurrent;
  const ranges = targetPlan.projection;
  if (!ranges) return null;
  const range = ranges.find(
    (candidate, index) =>
      sourceCurrent >= candidate.sourceStart &&
      (sourceCurrent < candidate.sourceEnd ||
        (index === ranges.length - 1 && sourceCurrent === candidate.sourceEnd)),
  );
  if (!range) return null;
  const ratio = (sourceCurrent - range.sourceStart) / (range.sourceEnd - range.sourceStart);
  return range.targetStart + ratio * (range.targetEnd - range.targetStart);
}
