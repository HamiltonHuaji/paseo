import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { SkillRepositoryExecutorJobRequest } from "@getpaseo/protocol/skill-repositories";
import { getDesktopHost } from "@/desktop/host";
import {
  getSkillRepositoryLocalState,
  subscribeSkillRepositoryPlan,
  type SkillRepositoryPlan,
} from "./plan";
import { setSkillRepositoryPlanError } from "./status";

type Subscription = ReturnType<DaemonClient["registerSkillRepositoryExecutor"]>;

export function mountSkillRepositoryExecutor(client: DaemonClient, serverId: string): () => void {
  const desktop = getDesktopHost()?.skillRepositories;
  let disposed = false;
  let active: Subscription | null = null;
  let sequence = 0;
  let queue: Promise<void> = Promise.resolve();
  let repositories = new Map<string, SkillRepositoryPlan["repositories"][number]>();

  const respond = (
    payload: Parameters<DaemonClient["sendSkillRepositoryExecutorJobResponse"]>[0]["payload"],
  ): void => {
    if (disposed || client.getConnectionState().status !== "connected") return;
    try {
      client.sendSkillRepositoryExecutorJobResponse({
        type: "skills.repository.executor.job.response",
        payload,
      });
    } catch {
      // The connection may have closed while Git was running.
    }
  };

  const handleJob = async (job: SkillRepositoryExecutorJobRequest): Promise<void> => {
    const subscription = repositories.get(job.repositoryId);
    if (!subscription || !desktop) {
      respond({
        requestId: job.requestId,
        repositoryId: job.repositoryId,
        state: "unavailable",
      });
      return;
    }
    try {
      const result = (await desktop.execute({ job, subscription })) as {
        requestId: string;
        repositoryId: string;
        state: "ok" | "unavailable" | "conflict" | "failed";
        bundleBase64?: string;
        remoteHead?: string;
        publishedHead?: string;
        error?: string;
      };
      respond(result);
    } catch (error) {
      respond({
        requestId: job.requestId,
        repositoryId: job.repositoryId,
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const reconcile = (): void => {
    const revision = ++sequence;
    queue = queue
      .catch(() => {})
      .then(async () => {
        if (active) {
          await active.release().catch(() => {});
          active = null;
        }
        if (disposed || client.getConnectionState().status !== "connected") return;
        if (client.getLastServerInfoMessage()?.features?.skillRepositories !== true) return;
        const state = await getSkillRepositoryLocalState();
        if (revision !== sequence || disposed) return;
        repositories = new Map(
          state.plan.repositories
            .filter((item) => !item.deleted)
            .map((item) => [item.repositoryId, item]),
        );
        const memberEntries = state.plan.members.filter(
          (item) => item.serverId === serverId && !item.deleted,
        );
        const daemonSubscriptions = await client.listSkillRepositories();
        for (const current of daemonSubscriptions.subscriptions) {
          const member = state.plan.members.find(
            (item) => item.serverId === serverId && item.repositoryId === current.repositoryId,
          );
          const repository = state.plan.repositories.find(
            (item) => item.repositoryId === current.repositoryId,
          );
          if (member?.deleted || repository?.deleted) {
            await client.removeSkillRepository(current.repositoryId);
          }
        }
        for (const member of memberEntries) {
          const repository = repositories.get(member.repositoryId);
          if (!repository) continue;
          await client.upsertSkillRepository({
            repositoryId: repository.repositoryId,
            label: repository.label,
            remoteUrl: repository.remoteUrl,
            branch: repository.branch,
            autoReceive: member.autoReceive,
            agentPublishAllowed: member.agentPublishAllowed,
          });
        }
        if (revision !== sequence || disposed) return;
        const capabilities = memberEntries.flatMap((member) => {
          if (!desktop) return [];
          const local = state.executors.find((item) => item.repositoryId === member.repositoryId);
          const repository = repositories.get(member.repositoryId);
          if (!local || !repository) return [];
          return [
            {
              repositoryId: member.repositoryId,
              remoteUrl: repository.remoteUrl,
              branch: repository.branch,
              read: local.read || local.publish,
              publish: local.publish && member.agentPublishAllowed,
            },
          ];
        });
        if (capabilities.length === 0) return;
        const registration = client.registerSkillRepositoryExecutor(capabilities);
        active = registration;
        registration.subscribe({
          snapshot: () => {},
          update: (message) => {
            if (message.type === "skills.repository.executor.job.request") {
              void handleJob(message);
            }
          },
        });
        await registration.ready;
        return undefined;
      })
      .then(() => {
        if (revision === sequence && !disposed) setSkillRepositoryPlanError(serverId, null);
        return undefined;
      })
      .catch((error) => {
        if (revision === sequence && !disposed) {
          setSkillRepositoryPlanError(
            serverId,
            error instanceof Error ? error.message : String(error),
          );
        }
      });
  };

  const unsubscribePlan = subscribeSkillRepositoryPlan(reconcile);
  const unsubscribeConnection = client.subscribeConnectionStatus(() => reconcile());
  const refreshTimer = setInterval(() => {
    if (active && client.getConnectionState().status === "connected") {
      void client.refreshSkillRepositoryExecutor().catch(() => {});
    }
  }, 5 * 60_000);
  reconcile();
  return () => {
    disposed = true;
    setSkillRepositoryPlanError(serverId, null);
    clearInterval(refreshTimer);
    unsubscribePlan();
    unsubscribeConnection();
    void active?.release().catch(() => {});
  };
}
