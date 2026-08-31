import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WebSocketLike } from "@getpaseo/client/internal/daemon-client-transport-types";
import {
  createLocalTunnelForwarder,
  type LocalTunnelForwarder,
} from "@getpaseo/client/node/local-tunnel-forwarder";
import {
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl,
  shouldUseTlsForDefaultHostedRelay,
} from "@getpaseo/protocol/daemon-endpoints";
import { TunnelTargetSchema } from "@getpaseo/protocol/tunnels";
import { WebSocket } from "ws";
import { z } from "zod";

const EnsureTunnelInputSchema = z.object({
  serverId: z.string().min(1),
  connection: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("relay"),
      relayEndpoint: z.string().min(1),
      useTls: z.boolean().optional(),
      daemonPublicKeyB64: z.string().min(1),
    }),
    z.object({
      type: z.literal("directTcp"),
      endpoint: z.string().min(1),
      useTls: z.boolean().optional(),
      password: z.string().optional(),
    }),
  ]),
  target: TunnelTargetSchema,
});

interface ManagedTunnel {
  client: DaemonClient;
  forwarder: LocalTunnelForwarder;
}

const tunnels = new Map<string, Promise<ManagedTunnel>>();

export function registerTunnelHandlers(): void {
  ipcMain.handle("paseo:tunnel:ensure", async (_event, rawInput: unknown) => {
    const input = EnsureTunnelInputSchema.parse(rawInput);
    const key = JSON.stringify(input);
    let managed = tunnels.get(key);
    if (!managed) {
      managed = createManagedTunnel(input).catch((error) => {
        tunnels.delete(key);
        throw error;
      });
      tunnels.set(key, managed);
    }
    const { forwarder } = await managed;
    return { origin: forwarder.origin };
  });
}

export async function closeAllTunnelForwarders(): Promise<void> {
  const active = [...tunnels.values()];
  tunnels.clear();
  await Promise.allSettled(
    active.map(async (pending) => {
      const { client, forwarder } = await pending;
      await forwarder.close();
      await client.close();
    }),
  );
}

async function createManagedTunnel(
  input: z.infer<typeof EnsureTunnelInputSchema>,
): Promise<ManagedTunnel> {
  const connection = input.connection;
  const isRelay = connection.type === "relay";
  const useTls = isRelay
    ? (connection.useTls ?? shouldUseTlsForDefaultHostedRelay(connection.relayEndpoint))
    : (connection.useTls ?? false);
  const client = new DaemonClient({
    url: isRelay
      ? buildRelayWebSocketUrl({
          endpoint: connection.relayEndpoint,
          useTls,
          serverId: input.serverId,
          role: "client",
        })
      : buildDaemonWebSocketUrl(connection.endpoint, { useTls }),
    clientId: `desktop-tunnel-${randomUUID()}`,
    clientType: "cli",
    password: isRelay ? undefined : connection.password,
    webSocketFactory: (url, options) =>
      new WebSocket(url, options?.protocols, {
        headers: options?.headers,
      }) as unknown as WebSocketLike,
    e2ee: isRelay
      ? {
          enabled: true,
          daemonPublicKeyB64: connection.daemonPublicKeyB64,
        }
      : undefined,
    reconnect: { enabled: true },
  });
  try {
    await client.connect();
    const forwarder = await createLocalTunnelForwarder({ client, target: input.target });
    return { client, forwarder };
  } catch (error) {
    await client.close();
    throw error;
  }
}
