import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ViewerConnection } from "@getpaseo/client/internal/viewer-http-proxy";
import {
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl,
  shouldUseTlsForDefaultHostedRelay,
} from "@getpaseo/protocol/daemon-endpoints";
import { createAppWebSocketFactory } from "@/runtime/websocket-factory";
export function createViewerClient(serverId: string, connection: ViewerConnection): DaemonClient {
  let url: string;
  if (connection.type === "relay") {
    url = buildRelayWebSocketUrl({
      endpoint: connection.relayEndpoint,
      useTls: connection.useTls ?? shouldUseTlsForDefaultHostedRelay(connection.relayEndpoint),
      serverId,
      role: "client",
    });
  } else {
    url = buildDaemonWebSocketUrl(connection.endpoint, { useTls: connection.useTls ?? false });
  }
  const client = new DaemonClient({
    url,
    clientId: `viewer-${globalThis.crypto.randomUUID()}`,
    clientType: "mobile",
    webSocketFactory: createAppWebSocketFactory(),
    password: connection.type === "directTcp" ? connection.password : undefined,
    e2ee:
      connection.type === "relay"
        ? {
            enabled: true,
            daemonPublicKeyB64: connection.daemonPublicKeyB64,
          }
        : undefined,
    reconnect: { enabled: true },
  });
  return client;
}
