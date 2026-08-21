import type { DirectTcpHostConnection, HostProfile } from "@/types/host-connection";

/**
 * HTTP downloads are valid only for the direct TCP connection that currently
 * owns the host runtime. A saved LAN endpoint is not evidence that it is
 * reachable while the client is connected through relay.
 */
export function resolveActiveDirectDownloadConnection(input: {
  host: HostProfile | undefined;
  activeConnectionId: string | null;
}): DirectTcpHostConnection | null {
  if (!input.activeConnectionId) return null;
  const active = input.host?.connections.find(
    (connection) => connection.id === input.activeConnectionId,
  );
  return active?.type === "directTcp" ? active : null;
}
