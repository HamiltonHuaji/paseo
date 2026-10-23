import { AppRegistry } from "react-native";
import { runViewerProxyTask, syncViewerProxyHosts, updateViewerProxyRoute } from "./proxy.android";

async function runTask({ serviceId }: { serviceId: string }): Promise<void> {
  let stopped = false;
  const finished = runViewerProxyTask(serviceId).then(() => {
    stopped = true;
    return undefined;
  });
  // Load after entry initialization: HostRuntime imports modules requiring Unistyles setup.
  const { getHostRuntimeStore } = await import("@/runtime/host-runtime");
  const store = getHostRuntimeStore();
  const seen = new Map<string, string>();
  function syncRoutes(): void {
    if (stopped) return;
    for (const host of store.getHosts()) {
      const snapshot = store.getSnapshot(host.serverId);
      const id = snapshot?.activeConnectionId;
      const connection = host.connections.find((candidate) => candidate.id === id);
      if (connection?.type !== "directTcp" && connection?.type !== "relay") continue;
      const key = JSON.stringify([
        connection,
        snapshot?.clientGeneration,
        snapshot?.connectionStatus,
      ]);
      if (seen.get(host.serverId) === key) continue;
      seen.set(host.serverId, key);
      void updateViewerProxyRoute({
        serverId: host.serverId,
        connection,
        routeGeneration: snapshot?.clientGeneration,
      }).catch((error) => {
        console.warn("[viewer-http] Background route update failed", error);
      });
    }
  }
  const unsubscribeRoutes = store.subscribeAll(syncRoutes);
  const unsubscribeHosts = store.subscribeHostList(() => {
    if (stopped || store.getHostRegistryStatus() !== "ready") return;
    void syncViewerProxyHosts(store.getHosts().map((host) => host.serverId)).catch((error) => {
      console.warn("[viewer-http] Background Host update failed", error);
    });
    syncRoutes();
  });
  try {
    await store.boot();
    syncRoutes();
    await finished;
  } finally {
    unsubscribeRoutes();
    unsubscribeHosts();
  }
}

export function registerViewerProxyTask(): void {
  AppRegistry.registerHeadlessTask("PaseoViewerProxy", () => runTask);
}
