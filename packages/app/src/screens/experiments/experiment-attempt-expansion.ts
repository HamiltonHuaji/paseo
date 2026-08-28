export function resolveAttemptExpanded(
  attemptId: string,
  latestAttemptId: string | null,
  remembered: Record<string, boolean>,
): boolean {
  return remembered[attemptId] ?? attemptId === latestAttemptId;
}
