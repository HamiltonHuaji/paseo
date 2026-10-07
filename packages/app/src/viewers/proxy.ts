import { getDesktopHost } from "@/desktop/host";
import type { ViewerProxyInput } from "@getpaseo/client/internal/viewer-http-proxy";

export function canProxyViewers(): boolean {
  return Boolean(getDesktopHost()?.viewerHttp?.ensure);
}

export async function ensureViewerProxy(input: ViewerProxyInput): Promise<{ origin: string }> {
  const ensure = getDesktopHost()?.viewerHttp?.ensure;
  if (!ensure) throw new Error("Viewer proxy is unavailable on this client");
  return ensure(input);
}

export async function updateViewerProxyRoute(input: ViewerProxyInput): Promise<void> {
  await getDesktopHost()?.viewerHttp?.updateRoute?.(input);
}

export async function syncViewerProxyHosts(serverIds: string[]): Promise<void> {
  await getDesktopHost()?.viewerHttp?.syncHosts?.(serverIds);
}
