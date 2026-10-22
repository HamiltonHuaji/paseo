import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  SkillRepositoryExecutorJobRequest,
  SkillRepositorySubscription,
} from "@getpaseo/protocol/skill-repositories";
import { getDesktopHost } from "@/desktop/host";
import {
  getSkillRepositoryLocalState,
  subscribeSkillRepositoryPlan,
  subscriptionFromPlan,
  rememberSkillRepositorySubscriptions,
  recordSkillRepositoryApply,
} from "./plan";
import { setSkillRepositoryPlanError } from "./status";

type Subscription = ReturnType<DaemonClient["registerSkillRepositoryExecutor"]>;

export function mountSkillRepositoryExecutor(client: DaemonClient, serverId: string): () => void {
  const desktop = getDesktopHost()?.skillRepositories;
  let disposed = false;
  const isLive = () => !disposed && client.getConnectionState().status === "connected";
  let active: Subscription | null = null;
  let sequence = 0;
  let queue: Promise<void> = Promise.resolve();
  let registrationKey = "";
  let subscriptions = new Map<string, SkillRepositorySubscription>();

  const respond = (
    payload: Parameters<DaemonClient["sendSkillRepositoryExecutorJobResponse"]>[0]["payload"],
  ): void => {
    if (!isLive()) return;
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
    const subscription = subscriptions.get(job.repositoryId);
    if (!subscription || !desktop) {
      respond({
        requestId: job.requestId,
        repositoryId: job.repositoryId,
        state: "unavailable",
      });
      return;
    }
    try {
      const result = await desktop.execute({ job, subscription });
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
        if (disposed) return;
        if (client.getConnectionState().status !== "connected") {
          await active?.release().catch(() => {});
          active = null;
          registrationKey = "";
          return;
        }
        if (client.getLastServerInfoMessage()?.features?.skillRepositoryManagement !== true) return;
        const state = await getSkillRepositoryLocalState();
        if (revision !== sequence || disposed) return;
        for (const pending of state.pending.filter((p) => p.serverId === serverId && !p.error)) {
          const desired = subscriptionFromPlan(state.plan, serverId, pending.repositoryId);
          try {
            const actual =
              (await client.listSkillRepositories()).subscriptions.find(
                (s) => s.repositoryId === pending.repositoryId,
              ) ?? null;
            // A lost acknowledgement can leave a persisted edit pending locally.
            if (JSON.stringify(actual) !== JSON.stringify(desired)) {
              await client.configureSkillRepository({
                repositoryId: pending.repositoryId,
                expected: pending.expected,
                subscription: desired,
              });
            }
            await recordSkillRepositoryApply(
              serverId,
              pending.repositoryId,
              pending.revision,
              undefined,
              desired,
            );
          } catch (error) {
            if (!isLive()) throw error;
            await recordSkillRepositoryApply(
              serverId,
              pending.repositoryId,
              pending.revision,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        const daemonSubscriptions = (await client.listSkillRepositories()).subscriptions;
        await rememberSkillRepositorySubscriptions(serverId, daemonSubscriptions);
        if (!isLive()) return;
        subscriptions = new Map(daemonSubscriptions.map((s) => [s.repositoryId, s]));
        const capabilities = daemonSubscriptions.flatMap((subscription) => {
          if (!desktop) return [];
          const repository = state.plan.repositories.find(
            (r) => r.repositoryId === subscription.repositoryId && !r.deleted,
          );
          const local = state.executors.find((e) => e.repositoryId === subscription.repositoryId);
          if (
            !repository ||
            !local ||
            (!local.read && !local.publish) ||
            repository.remoteUrl !== subscription.remoteUrl ||
            repository.branch !== subscription.branch
          )
            return [];
          return [
            {
              repositoryId: subscription.repositoryId,
              remoteUrl: subscription.remoteUrl,
              branch: subscription.branch,
              read: local.read || local.publish,
              publish: local.publish && subscription.agentPublishAllowed,
            },
          ];
        });
        const nextKey = JSON.stringify(capabilities);
        if (nextKey === registrationKey) return;
        await active?.release().catch(() => {});
        active = null;
        registrationKey = "";
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
        registrationKey = nextKey;
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
  const configurationTimer = setInterval(reconcile, 15_000);
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
    clearInterval(configurationTimer);
    unsubscribePlan();
    unsubscribeConnection();
    void active?.release().catch(() => {});
  };
}
