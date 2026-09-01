import type {
  ExperimentAttempt,
  ExperimentDetail,
  ProgressObservation,
} from "@getpaseo/protocol/experiments";

export type AttemptProgressState =
  | { kind: "unknown"; ratio: null; total: number | null }
  | { kind: "indeterminate"; ratio: null; total: null }
  | { kind: "running"; ratio: number; total: number }
  | { kind: "ended"; ratio: 1; total: number | null };

export function hasAttemptProgress(attempt: ExperimentAttempt): boolean {
  return Boolean(attempt.progress || attempt.progressSource || attempt.progressPlans);
}

export function resolveAttemptProgressState(
  attempt: ExperimentAttempt,
  observation: ProgressObservation | null = attempt.progress,
): AttemptProgressState {
  const total = progressTotal(attempt, observation);
  if (!observation) return { kind: "unknown", ratio: null, total };
  if (observation.ended) return { kind: "ended", ratio: 1, total };
  if (!total || total <= 0) return { kind: "indeterminate", ratio: null, total: null };
  return {
    kind: "running",
    ratio: Math.max(0, Math.min(1, observation.current / total)),
    total,
  };
}

export function selectCardProgressAttempts(detail: ExperimentDetail): ExperimentAttempt[] {
  const candidates = detail.attempts.filter(hasAttemptProgress).sort(compareAttempts);
  const unfinished = candidates.filter(
    (attempt) => resolveAttemptProgressState(attempt).kind !== "ended",
  );
  return unfinished.length > 0 ? unfinished : candidates.slice(-1);
}

function compareAttempts(left: ExperimentAttempt, right: ExperimentAttempt): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function progressUnit(attempt: ExperimentAttempt): string | null {
  return attempt.progressPlans?.sourceUnit ?? null;
}

function progressTotal(
  attempt: ExperimentAttempt,
  observation: ProgressObservation | null,
): number | null {
  const sourcePlan = attempt.progressPlans?.units.find(
    (plan) => plan.unit === attempt.progressPlans?.sourceUnit,
  );
  return observation?.total ?? sourcePlan?.total ?? null;
}
