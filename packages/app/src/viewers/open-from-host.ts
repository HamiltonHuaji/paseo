import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { openExternalUrl } from "@/utils/open-external-url";
import { openViewer } from "./open";
import { canProxyViewers, ensureViewerProxy } from "./proxy";

export function openHostViewer(serverId: string, path: string): Promise<void> {
  const runtime = getHostRuntimeStore();
  const client = runtime.getClient(serverId);
  const activeConnectionId = runtime.getSnapshot(serverId)?.activeConnectionId;
  const host = runtime.getHosts().find((candidate) => candidate.serverId === serverId);
  const route = host?.connections.find((connection) => connection.id === activeConnectionId);
  const connection = route?.type === "directTcp" || route?.type === "relay" ? route : null;
  return openViewer(
    {
      serverId,
      connection,
      serverInfo: client?.getLastServerInfoMessage() ?? null,
      directHttpUrl: client?.resolveDirectHttpUrl("/") ?? null,
    },
    path,
    { ensureProxy: canProxyViewers() ? ensureViewerProxy : null, openExternalUrl },
  );
}
