import { AppRegistry } from "react-native";
import type { HostConnection } from "@/types/host-connection";
import { runViewerProxyTask, syncViewerProxyHosts, updateViewerProxyRoute } from "./proxy.android";

async function runTask(): Promise<void> {
  let stopped = false;
  const finished = runViewerProxyTask().then(() => {
    stopped = true;
    return undefined;
  });
  // Load after entry initialization: HostRuntime imports modules requiring Unistyles setup.
  const { getHostRuntimeStore } = await import("@/runtime/host-runtime");
  const store = getHostRuntimeStore();
  const seen = new Map<string, HostConnection>();
  function syncRoutes(): void {
    if (stopped) return;
    for (const host of store.getHosts()) {
      const id = store.getSnapshot(host.serverId)?.activeConnectionId;
      const connection = host.connections.find((candidate) => candidate.id === id);
      if (connection?.type !== "directTcp" && connection?.type !== "relay") continue;
      if (seen.get(host.serverId) === connection) continue;
      seen.set(host.serverId, connection);
      void updateViewerProxyRoute({ serverId: host.serverId, connection }).catch((error) => {
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
