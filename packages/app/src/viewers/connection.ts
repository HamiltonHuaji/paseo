import type { ViewerConnection } from "@getpaseo/client/internal/viewer-http-proxy";
import type { HostConnection } from "@/types/host-connection";

export function resolveViewerConnection(
  connection: HostConnection | undefined,
  password?: string,
): ViewerConnection | null {
  if (connection?.type !== "directTcp" && connection?.type !== "relay") return null;
  // Authentication belongs to the host, while endpoint selection belongs to the route.
  return { ...connection, password };
}
