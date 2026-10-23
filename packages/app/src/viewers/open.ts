import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  ViewerConnection,
  ViewerProxyInput,
} from "@getpaseo/client/internal/viewer-http-proxy";

type ViewerServerInfo = Pick<
  NonNullable<ReturnType<DaemonClient["getLastServerInfoMessage"]>>,
  "experimentViewer" | "features"
>;

export interface ViewerOpenTarget {
  serverId: string;
  connection: ViewerConnection | null;
  serverInfo: ViewerServerInfo | null;
  directHttpUrl: string | null;
  localDaemon?: boolean;
  routeGeneration?: number;
}

export interface ViewerOpenPorts {
  ensureProxy: ((input: ViewerProxyInput) => Promise<{ origin: string }>) | null;
  isDirectReachable?: (origin: string) => Promise<boolean>;
  openExternalUrl: (url: string) => Promise<void>;
}

export function resolveDirectViewerUrl(target: ViewerOpenTarget, path: string): string | null {
  const viewer = target.serverInfo?.experimentViewer;
  // A daemon's loopback (including a desktop-managed daemon on another Host)
  // is not the browser's loopback. Local identity comes from the desktop daemon manager.
  if (!viewer) return null;
  if (target.localDaemon) {
    const host = viewer.host === "0.0.0.0" || viewer.host === "::" ? "127.0.0.1" : viewer.host;
    return `http://${host.includes(":") ? `[${host}]` : host}:${viewer.port}${path}`;
  }
  if (viewer.scope === "loopback") return null;
  if (target.connection?.type !== "directTcp" || !target.directHttpUrl) return null;
  const origin = new URL(target.directHttpUrl);
  origin.protocol = "http:";
  origin.port = String(viewer.port);
  return `${origin.origin}${path}`;
}

export async function openViewer(
  target: ViewerOpenTarget,
  path: string,
  ports: ViewerOpenPorts,
): Promise<void> {
  const direct = resolveDirectViewerUrl(target, path);
  if (
    direct &&
    ports.isDirectReachable &&
    (await ports.isDirectReachable(new URL(direct).origin))
  ) {
    await ports.openExternalUrl(direct);
    return;
  }
  if (!target.connection) throw new Error("Connect to this host before opening the viewer");
  if (ports.ensureProxy) {
    if (target.serverInfo?.features?.tunnelStreamV3 !== true) {
      throw new Error("Update the host to open viewers");
    }
    // The stable TCP listener reaches the same published service as direct access.
    const { origin } = await ports.ensureProxy({
      serverId: target.serverId,
      connection: target.connection,
      ...(target.routeGeneration !== undefined ? { routeGeneration: target.routeGeneration } : {}),
    });
    await ports.openExternalUrl(`${origin}${path}`);
    return;
  }
  throw new Error(
    "Viewer transport is unavailable. Use desktop or Android viewer forwarding, or a reachable viewer host",
  );
}
