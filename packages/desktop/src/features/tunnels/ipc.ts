import { randomUUID } from "node:crypto";
import { ipcMain } from "electron";
import log from "electron-log/main";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WebSocketLike } from "@getpaseo/client/internal/daemon-client-transport-types";
import {
  createLocalTunnelForwarder,
  type LocalTunnelForwarder,
} from "@getpaseo/client/node/local-tunnel-forwarder";
import {
  createLocalViewerHttpProxy,
  type LocalViewerHttpProxy,
} from "@getpaseo/client/node/local-viewer-http-proxy";
import {
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl,
  shouldUseTlsForDefaultHostedRelay,
} from "@getpaseo/protocol/daemon-endpoints";
import { TunnelTargetSchema, type TunnelTarget } from "@getpaseo/protocol/tunnels";
import { WebSocket } from "ws";
import { z } from "zod";

const ConnectionSchema = z.discriminatedUnion("type", [
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
]);

const EnsureTunnelInputSchema = z.object({
  serverId: z.string().min(1),
  connection: ConnectionSchema,
  target: TunnelTargetSchema,
});

type TunnelConnection = z.infer<typeof ConnectionSchema>;
type ManagedDaemonTunnel = Awaited<ReturnType<DaemonClient["openTunnel"]>>;

interface UpstreamGeneration {
  client: DaemonClient;
  routeKey: string;
  activeStreams: number;
  retiring: boolean;
}

interface ManagedTunnel {
  forwarder: LocalTunnelForwarder;
  updateRoute(connection: TunnelConnection): Promise<void>;
  close(): Promise<void>;
}

interface ManagedViewerProxy {
  proxy: LocalViewerHttpProxy;
  updateRoute(connection: TunnelConnection): Promise<void>;
  close(): Promise<void>;
}

const tunnels = new Map<string, Promise<ManagedTunnel>>();
const viewerProxies = new Map<string, Promise<ManagedViewerProxy>>();

export function registerTunnelHandlers(): void {
  ipcMain.handle("paseo:tunnel:ensure", async (_event, rawInput: unknown) => {
    const input = EnsureTunnelInputSchema.parse(rawInput);
    const key = JSON.stringify({ serverId: input.serverId, target: input.target });
    let pending = tunnels.get(key);
    if (!pending) {
      pending = createManagedTunnel(input).catch((error) => {
        tunnels.delete(key);
        throw error;
      });
      tunnels.set(key, pending);
    }
    const managed = await pending;
    await managed.updateRoute(input.connection);
    return { origin: managed.forwarder.origin };
  });
  ipcMain.handle("paseo:tunnel:updateRoute", async (_event, rawInput: unknown) => {
    const input = EnsureTunnelInputSchema.parse(rawInput);
    const key = JSON.stringify({ serverId: input.serverId, target: input.target });
    const pending = tunnels.get(key);
    if (!pending) return { updated: false };
    await (await pending).updateRoute(input.connection);
    return { updated: true };
  });
  ipcMain.handle("paseo:viewerHttp:ensure", async (_event, rawInput: unknown) => {
    const input = EnsureTunnelInputSchema.omit({ target: true }).parse(rawInput);
    let pending = viewerProxies.get(input.serverId);
    if (!pending) {
      pending = createManagedViewerProxy(input).catch((error) => {
        viewerProxies.delete(input.serverId);
        throw error;
      });
      viewerProxies.set(input.serverId, pending);
    }
    const managed = await pending;
    await managed.updateRoute(input.connection);
    return { origin: managed.proxy.origin };
  });
  ipcMain.handle("paseo:viewerHttp:updateRoute", async (_event, rawInput: unknown) => {
    const input = EnsureTunnelInputSchema.omit({ target: true }).parse(rawInput);
    const pending = viewerProxies.get(input.serverId);
    if (!pending) return { updated: false };
    await (await pending).updateRoute(input.connection);
    return { updated: true };
  });
}

export async function closeAllTunnelForwarders(): Promise<void> {
  const active = [...tunnels.values()];
  const viewers = [...viewerProxies.values()];
  tunnels.clear();
  viewerProxies.clear();
  await Promise.allSettled(active.map(async (pending) => (await pending).close()));
  await Promise.allSettled(viewers.map(async (pending) => (await pending).close()));
}

async function createManagedViewerProxy(input: {
  serverId: string;
  connection: TunnelConnection;
}): Promise<ManagedViewerProxy> {
  let current = await createUpstream(input.serverId, input.connection);
  if (current.client.getLastServerInfoMessage()?.features?.viewerHttpProxy !== true) {
    await current.client.close();
    throw new Error("Update the host to use the viewer HTTP proxy");
  }
  const generations = new Set<UpstreamGeneration>([current]);
  let routeUpdate = Promise.resolve();
  const retireIfDrained = async (generation: UpstreamGeneration): Promise<void> => {
    if (!generation.retiring || generation.activeStreams > 0) return;
    generations.delete(generation);
    await generation.client.close();
  };
  const proxy = await createLocalViewerHttpProxy({
    fetch: async (request) => {
      const generation = current;
      generation.activeStreams += 1;
      try {
        const response = await generation.client.fetchViewerHttp(request);
        void response.stream.whenClosed().then(() => {
          generation.activeStreams -= 1;
          void retireIfDrained(generation);
          return undefined;
        });
        return response;
      } catch (error) {
        generation.activeStreams -= 1;
        void retireIfDrained(generation);
        throw error;
      }
    },
    onRequestError: (error) => log.debug("[viewer-http] Upstream resource failed", error),
  });
  const updateRoute = (connection: TunnelConnection): Promise<void> => {
    routeUpdate = routeUpdate
      .catch(() => undefined)
      .then(async () => {
        const nextRouteKey = JSON.stringify(connection);
        if (current.routeKey === nextRouteKey) return undefined;
        const replacement = await createUpstream(input.serverId, connection);
        if (replacement.client.getLastServerInfoMessage()?.features?.viewerHttpProxy !== true) {
          await replacement.client.close();
          throw new Error("Update the host to use the viewer HTTP proxy");
        }
        generations.add(replacement);
        const previous = current;
        current = replacement;
        previous.retiring = true;
        await retireIfDrained(previous);
        return undefined;
      });
    return routeUpdate;
  };
  return {
    proxy,
    updateRoute,
    close: async () => {
      await routeUpdate.catch(() => undefined);
      await proxy.close();
      await Promise.allSettled([...generations].map((generation) => generation.client.close()));
      generations.clear();
    },
  };
}

async function createManagedTunnel(
  input: z.infer<typeof EnsureTunnelInputSchema>,
): Promise<ManagedTunnel> {
  let current = await createUpstream(input.serverId, input.connection);
  const generations = new Set<UpstreamGeneration>([current]);
  let routeUpdate = Promise.resolve();

  const retireIfDrained = async (generation: UpstreamGeneration): Promise<void> => {
    if (!generation.retiring || generation.activeStreams > 0) return;
    generations.delete(generation);
    await generation.client.close();
  };

  const openTunnel = async (target: TunnelTarget): Promise<ManagedDaemonTunnel> => {
    const generation = current;
    generation.activeStreams += 1;
    try {
      const tunnel = await generation.client.openTunnel(target);
      void tunnel.whenClosed().finally(() => {
        generation.activeStreams -= 1;
        void retireIfDrained(generation);
      });
      return tunnel;
    } catch (error) {
      generation.activeStreams -= 1;
      void retireIfDrained(generation);
      throw error;
    }
  };

  const forwarder = await createLocalTunnelForwarder({
    openTunnel,
    target: input.target,
    onConnectionError: (error) => {
      log.warn("[tunnel-forwarder] Browser connection failed", error);
    },
  });
  const updateRoute = (connection: TunnelConnection): Promise<void> => {
    routeUpdate = routeUpdate
      .catch(() => undefined)
      .then(async () => {
        const nextRouteKey = JSON.stringify(connection);
        if (current.routeKey === nextRouteKey) return undefined;
        const replacement = await createUpstream(input.serverId, connection);
        generations.add(replacement);
        const previous = current;
        current = replacement;
        forwarder.resetIdleTunnels();
        previous.retiring = true;
        await retireIfDrained(previous);
        return undefined;
      });
    return routeUpdate;
  };
  return {
    forwarder,
    updateRoute,
    close: async () => {
      await routeUpdate.catch(() => undefined);
      await forwarder.close();
      await Promise.allSettled([...generations].map((generation) => generation.client.close()));
      generations.clear();
    },
  };
}

async function createUpstream(
  serverId: string,
  connection: TunnelConnection,
): Promise<UpstreamGeneration> {
  const isRelay = connection.type === "relay";
  const useTls = isRelay
    ? (connection.useTls ?? shouldUseTlsForDefaultHostedRelay(connection.relayEndpoint))
    : (connection.useTls ?? false);
  const client = new DaemonClient({
    url: isRelay
      ? buildRelayWebSocketUrl({
          endpoint: connection.relayEndpoint,
          useTls,
          serverId,
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
    return {
      client,
      routeKey: JSON.stringify(connection),
      activeStreams: 0,
      retiring: false,
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
