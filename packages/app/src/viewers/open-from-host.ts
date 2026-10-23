import { getDesktopDaemonStatus, shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { openExternalUrl } from "@/utils/open-external-url";
import { openViewer } from "./open";
import { canProxyViewers, ensureViewerProxy, isDirectViewerReachable } from "./proxy";

export async function openHostViewer(serverId: string, path: string): Promise<void> {
  const runtime = getHostRuntimeStore();
  const client = runtime.getClient(serverId);
  const activeConnectionId = runtime.getSnapshot(serverId)?.activeConnectionId;
  const host = runtime.getHosts().find((candidate) => candidate.serverId === serverId);
  const route = host?.connections.find((connection) => connection.id === activeConnectionId);
  const connection = route?.type === "directTcp" || route?.type === "relay" ? route : null;
  const localDaemon = shouldUseDesktopDaemon()
    ? await getDesktopDaemonStatus()
        .then((status) => status.serverId === serverId)
        .catch(() => false)
    : false;
  return openViewer(
    {
      serverId,
      localDaemon,
      routeGeneration: runtime.getSnapshot(serverId)?.clientGeneration,
      connection,
      serverInfo: client?.getLastServerInfoMessage() ?? null,
      directHttpUrl: client?.resolveDirectHttpUrl("/") ?? null,
    },
    path,
    {
      ensureProxy: canProxyViewers() ? ensureViewerProxy : null,
      isDirectReachable: isDirectViewerReachable,
      openExternalUrl,
    },
  );
}
