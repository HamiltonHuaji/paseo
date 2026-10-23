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

export async function isDirectViewerReachable(origin: string): Promise<boolean> {
  const probe = getDesktopHost()?.viewerHttp?.isReachable;
  if (probe) return probe(origin);
  try {
    await fetch(origin, { method: "HEAD", mode: "no-cors", signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}
