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
  ViewerConnectionSchema,
  viewerPortCandidates,
} from "@getpaseo/client/internal/viewer-http-proxy";
import {
  createLocalViewerHttpProxy,
  type LocalViewerHttpProxy,
} from "@getpaseo/client/node/local-viewer-http-proxy";
import { createViewerHttpUpstream } from "@getpaseo/client/internal/viewer-http-upstream";
import { createTunnelUpstream } from "@getpaseo/client/internal/tunnel-upstream";
import net from "node:net";
import { loadViewerPorts, saveViewerPorts } from "./viewer-ports.js";
import {
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl,
  shouldUseTlsForDefaultHostedRelay,
} from "@getpaseo/protocol/daemon-endpoints";
import { TunnelTargetSchema, type TunnelTarget } from "@getpaseo/protocol/tunnels";
import { WebSocket } from "ws";
import { z } from "zod";

const ConnectionSchema = ViewerConnectionSchema;

const EnsureTunnelInputSchema = z.object({
  serverId: z.string().min(1),
  connection: ConnectionSchema,
  target: TunnelTargetSchema,
  routeGeneration: z.number().int().nonnegative().optional(),
});

type TunnelConnection = z.infer<typeof ConnectionSchema>;
interface ManagedTunnel {
  forwarder: LocalTunnelForwarder;
  updateRoute(connection: TunnelConnection, generation?: number): Promise<void>;
  getState(): unknown;
  close(): Promise<void>;
}

const tunnels = new Map<string, Promise<ManagedTunnel>>();
interface ManagedViewerProxy {
  proxy: LocalViewerHttpProxy;
  updateRoute(connection: TunnelConnection): void;
  close(): Promise<void>;
}
const viewerProxies = new Map<string, ManagedViewerProxy>();
let viewerMutation = Promise.resolve();

function mutateViewers<Result>(operation: () => Promise<Result>): Promise<Result> {
  const pending = viewerMutation.then(operation);
  viewerMutation = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

async function ensureViewerProxy(serverId: string): Promise<ManagedViewerProxy> {
  const existing = viewerProxies.get(serverId);
  if (existing) return existing;
  const state = await loadViewerPorts();
  const upstream = createViewerHttpUpstream({
    createClient: (connection) => createTunnelClient(serverId, connection),
    onError: (error) => log.warn("[viewer-http] Upstream failed", { serverId, error }),
  });
  const proxy = await createLocalViewerHttpProxy({
    fetch: upstream.fetch,
    ports: viewerPortCandidates({ serverId, state }),
    onRequestError: (error) => log.debug("[viewer-http] Resource failed", { serverId, error }),
  });
  const previous = state[serverId];
  state[serverId] = { port: Number(new URL(proxy.origin).port), enabled: true };
  try {
    await saveViewerPorts(state);
  } catch (error) {
    if (previous) state[serverId] = previous;
    else delete state[serverId];
    await proxy.close();
    await upstream.close();
    throw error;
  }
  const managed: ManagedViewerProxy = {
    proxy,
    updateRoute: upstream.updateRoute,
    close: async () => {
      await proxy.close();
      await upstream.close();
    },
  };
  viewerProxies.set(serverId, managed);
  log.info("[viewer-http] Listening", { serverId, origin: proxy.origin });
  return managed;
}

export function registerTunnelHandlers(): void {
  ipcMain.handle("paseo:viewerHttp:getState", () =>
    [...viewerProxies].map(([serverId, managed]) => ({ serverId, origin: managed.proxy.origin })),
  );
  ipcMain.handle("paseo:viewerHttp:isReachable", async (_event, raw: unknown) => {
    const origin = new URL(z.string().url().parse(raw));
    if (
      origin.protocol !== "http:" ||
      origin.pathname !== "/" ||
      origin.username ||
      origin.password
    )
      return false;
    return new Promise<boolean>((resolve) => {
      const socket = net.createConnection({
        host: origin.hostname.replace(/^\[|\]$/g, ""),
        port: Number(origin.port || 80),
      });
      const finish = (reachable: boolean) => {
        socket.destroy();
        resolve(reachable);
      };
      socket.setTimeout(1500, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    });
  });
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
    await managed.updateRoute(input.connection, input.routeGeneration);
    return { origin: managed.forwarder.origin };
  });
  ipcMain.handle("paseo:tunnel:updateRoute", async (_event, rawInput: unknown) => {
    const input = EnsureTunnelInputSchema.parse(rawInput);
    const key = JSON.stringify({ serverId: input.serverId, target: input.target });
    const pending = tunnels.get(key);
    if (!pending) return { updated: false };
    await (await pending).updateRoute(input.connection, input.routeGeneration);
    return { updated: true };
  });
  ipcMain.handle("paseo:viewerHttp:ensure", async (_event, rawInput: unknown) => {
    const input = EnsureTunnelInputSchema.omit({ target: true }).parse(rawInput);
    return mutateViewers(async () => {
      const managed = await ensureViewerProxy(input.serverId);
      managed.updateRoute(input.connection);
      return { origin: managed.proxy.origin };
    });
  });
  ipcMain.handle("paseo:viewerHttp:updateRoute", async (_event, rawInput: unknown) => {
    const input = EnsureTunnelInputSchema.omit({ target: true }).parse(rawInput);
    return mutateViewers(async () => {
      const state = await loadViewerPorts();
      if (!state[input.serverId]?.enabled) return { updated: false };
      const managed = await ensureViewerProxy(input.serverId);
      managed.updateRoute(input.connection);
      return { updated: true };
    });
  });
  ipcMain.handle("paseo:viewerHttp:syncHosts", async (_event, rawInput: unknown) => {
    const serverIds = new Set(z.array(z.string().min(1)).parse(rawInput));
    return mutateViewers(async () => {
      const state = await loadViewerPorts();
      for (const [serverId, assignment] of Object.entries(state)) {
        if (!serverIds.has(serverId)) {
          assignment.enabled = false;
          const managed = viewerProxies.get(serverId);
          viewerProxies.delete(serverId);
          await managed?.close();
        } else if (assignment.enabled) {
          await ensureViewerProxy(serverId);
        }
      }
      await saveViewerPorts(state);
    });
  });
}

export async function closeAllTunnelForwarders(): Promise<void> {
  const active = [...tunnels.values()];
  await viewerMutation;
  const viewers = [...viewerProxies.values()];
  tunnels.clear();
  viewerProxies.clear();
  await Promise.allSettled(active.map(async (pending) => (await pending).close()));
  await Promise.allSettled(viewers.map((managed) => managed.close()));
}

async function createManagedTunnel(input: {
  serverId: string;
  target: TunnelTarget;
  connection?: TunnelConnection;
  routeGeneration?: number;
  ports?: number[];
}): Promise<ManagedTunnel> {
  const upstream = createTunnelUpstream({
    createClient: (connection) => createTunnelClient(input.serverId, connection),
    onError: () => log.warn("[viewer-tunnel] Upstream unavailable", { serverId: input.serverId }),
  });
  const forwarder = await createLocalTunnelForwarder({
    openTunnel: upstream.openTunnel,
    target: input.target,
    ports: input.ports,
    onConnectionError: () =>
      log.warn("[viewer-tunnel] Connection failed", { serverId: input.serverId }),
  });
  const getState = () => ({
    serverId: input.serverId,
    target: input.target.type === "service" ? `service:${input.target.name}` : "tcp",
    origin: forwarder.origin,
    ...forwarder.getState(),
    ...upstream.getState(),
  });
  const updateRoute = async (connection: TunnelConnection, generation = 0) => {
    await upstream.updateRoute(connection, generation);
    forwarder.resetIdleTunnels();
    log.debug("[viewer-tunnel] Route ready", getState());
  };
  return {
    forwarder,
    updateRoute,
    getState,
    close: async () => {
      await forwarder.close();
      await upstream.close();
    },
  };
}

function createTunnelClient(serverId: string, connection: TunnelConnection): DaemonClient {
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
  return client;
}
