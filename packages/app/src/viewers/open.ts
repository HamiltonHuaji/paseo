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
}

export interface ViewerOpenPorts {
  ensureProxy: ((input: ViewerProxyInput) => Promise<{ origin: string }>) | null;
  openExternalUrl: (url: string) => Promise<void>;
}

export function resolveDirectViewerUrl(target: ViewerOpenTarget, path: string): string | null {
  const viewer = target.serverInfo?.experimentViewer;
  // A daemon's loopback (including a desktop-managed daemon on another Host)
  // is not the browser's loopback. Only the client's proxy may supply that URL.
  if (!viewer || viewer.scope === "loopback") return null;
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
  if (!target.connection) throw new Error("Connect to this host before opening the viewer");
  if (ports.ensureProxy) {
    if (target.serverInfo?.features?.viewerHttpProxy !== true) {
      throw new Error("Update the host to open viewers");
    }
    // Always forward when this client supports it, even over direct TCP: the
    // viewer listener may be loopback-only or inside a remote container.
    const { origin } = await ports.ensureProxy({
      serverId: target.serverId,
      connection: target.connection,
    });
    await ports.openExternalUrl(`${origin}${path}`);
    return;
  }
  const url = resolveDirectViewerUrl(target, path);
  if (!url) {
    throw new Error(
      "Open this viewer from desktop or Android with viewer forwarding, or connect directly to a network-accessible viewer host",
    );
  }
  await ports.openExternalUrl(url);
}
