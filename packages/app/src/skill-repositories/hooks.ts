import { useEffect, useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { getSkillRepositoryLocalState, subscribeSkillRepositoryPlan } from "./plan";

import { getSkillRepositoryPlanErrors, subscribeSkillRepositoryPlanErrors } from "./status";

const localKey = ["skill-repository-plan"] as const;
export function useSkillRepositoryPlan() {
  const client = useQueryClient();
  useEffect(
    () =>
      subscribeSkillRepositoryPlan(() => {
        void client.invalidateQueries({ queryKey: localKey });
        void client.invalidateQueries({ queryKey: ["skill-repository-state"] });
      }),
    [client],
  );
  return useFetchQuery({
    queryKey: localKey,
    queryFn: getSkillRepositoryLocalState,
    dataShape: "value",
    staleTimeMs: 0,
  });
}

export function useSkillRepositoryPlanError(serverId: string): string | null {
  const getSnapshot = useCallback(
    () =>
      getSkillRepositoryPlanErrors().find((entry) => entry.serverId === serverId)?.message ?? null,
    [serverId],
  );
  return useSyncExternalStore(subscribeSkillRepositoryPlanErrors, getSnapshot);
}
