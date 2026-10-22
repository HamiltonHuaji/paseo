import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { ExperimentDetail, ProgressObservation } from "@getpaseo/protocol/experiments";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

const INITIAL_STAGGER_MS = 150;
const RETRY_AFTER_TRANSPORT_ERROR_MS = 10_000;

export interface ExperimentProgressTarget {
  experiment: string;
  attempt: string;
}

interface ExperimentProgressResult {
  observation: ProgressObservation | null;
  error: string | null;
  nextRefreshAfterMs: number | null;
}

export function useExperimentProgressPolling({
  client,
  queryClient,
  serverId,
  projectId,
  targets,
  enabled,
}: {
  client: DaemonClient | null;
  queryClient: QueryClient;
  serverId: string;
  projectId: string;
  targets: ExperimentProgressTarget[];
  enabled: boolean;
}) {
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const targetKey = targets.map((target) => `${target.experiment}:${target.attempt}`).join("|");

  useEffect(() => {
    if (!enabled || !client) return;
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const schedule = (target: ExperimentProgressTarget, delayMs: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        void poll(target);
      }, delayMs);
      timers.add(timer);
    };
    const poll = async (target: ExperimentProgressTarget) => {
      try {
        const result = await client.refreshExperimentProgress({
          projectId,
          attempt: target.attempt,
        });
        if (cancelled) return;
        updateCachedAttemptProgress(queryClient, serverId, projectId, target, result);
        if (result.nextRefreshAfterMs !== null) schedule(target, result.nextRefreshAfterMs);
      } catch (error) {
        if (cancelled) return;
        updateCachedAttemptProgressError(
          queryClient,
          serverId,
          projectId,
          target,
          errorMessage(error),
        );
        schedule(target, RETRY_AFTER_TRANSPORT_ERROR_MS);
      }
    };

    targetsRef.current.forEach((target, index) => {
      schedule(target, index * INITIAL_STAGGER_MS);
    });
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, [client, enabled, projectId, queryClient, serverId, targetKey]);
}

export function updateCachedAttemptProgress(
  queryClient: QueryClient,
  serverId: string,
  projectId: string,
  target: ExperimentProgressTarget,
  result: ExperimentProgressResult,
) {
  queryClient.setQueryData<ExperimentDetail>(
    ["experiment", serverId, projectId, target.experiment],
    (current) => {
      if (!current) return current;
      let found = false;
      const attempts = current.attempts.map((attempt) => {
        if (attempt.id !== target.attempt) return attempt;
        found = true;
        if (attempt.progress === result.observation && attempt.progressError === result.error) {
          return attempt;
        }
        return { ...attempt, progress: result.observation, progressError: result.error };
      });
      return found ? { ...current, attempts } : current;
    },
  );
}

export function updateCachedAttemptProgressError(
  queryClient: QueryClient,
  serverId: string,
  projectId: string,
  target: ExperimentProgressTarget,
  error: string,
) {
  queryClient.setQueryData<ExperimentDetail>(
    ["experiment", serverId, projectId, target.experiment],
    (current) => {
      if (!current) return current;
      let found = false;
      const attempts = current.attempts.map((attempt) => {
        if (attempt.id !== target.attempt) return attempt;
        found = true;
        return attempt.progressError === error ? attempt : { ...attempt, progressError: error };
      });
      return found ? { ...current, attempts } : current;
    },
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
