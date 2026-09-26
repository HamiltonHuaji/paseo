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
import { VIEWER_HTTP_DATA_FRAME_BYTES } from "@getpaseo/protocol/binary-frames/index";
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

interface ViewerUpstream extends UpstreamGeneration {
  primary: boolean;
  requests: Set<ViewerRequestLoad>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface ViewerRequestLoad {
  remainingBytes: number;
}

interface ViewerRoute {
  connection: TunnelConnection;
  routeKey: string;
  upstreams: Set<ViewerUpstream>;
  opening: Promise<ViewerUpstream | null> | null;
  expansionFailed: boolean;
}

// A nearly finished response is cheaper to share than another relay handshake.
// This compares remaining HTTP body bytes, not elapsed time or socket age.
const VIEWER_REUSE_TAIL_FRAMES = 4;
const VIEWER_REUSE_TAIL_BYTES = VIEWER_REUSE_TAIL_FRAMES * VIEWER_HTTP_DATA_FRAME_BYTES;
const VIEWER_IDLE_CONNECTION_MS = 60_000;

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
  const first = await createUpstream(input.serverId, input.connection);
  if (first.client.getLastServerInfoMessage()?.features?.viewerHttpProxy !== true) {
    await first.client.close();
    throw new Error("Update the host to use the viewer HTTP proxy");
  }
  const firstUpstream: ViewerUpstream = {
    ...first,
    primary: true,
    requests: new Set(),
    idleTimer: null,
  };
  let currentRoute: ViewerRoute = {
    connection: input.connection,
    routeKey: first.routeKey,
    upstreams: new Set([firstUpstream]),
    opening: null,
    expansionFailed: false,
  };
  const generations = new Set<ViewerUpstream>([firstUpstream]);
  const pendingOpenings = new Set<Promise<ViewerUpstream | null>>();
  let routeUpdate = Promise.resolve();
  let closing = false;

  const closeUpstream = async (route: ViewerRoute, upstream: ViewerUpstream): Promise<void> => {
    if (!generations.delete(upstream)) return;
    if (upstream.idleTimer) clearTimeout(upstream.idleTimer);
    upstream.idleTimer = null;
    route.upstreams.delete(upstream);
    try {
      await upstream.client.close();
    } catch (error) {
      log.debug("[viewer-http] Could not close idle upstream", error);
    }
  };
  const retireIfDrained = (route: ViewerRoute, upstream: ViewerUpstream): void => {
    if (upstream.retiring && upstream.activeStreams === 0) {
      void closeUpstream(route, upstream);
    }
  };
  const release = (route: ViewerRoute, upstream: ViewerUpstream, load: ViewerRequestLoad): void => {
    upstream.requests.delete(load);
    upstream.activeStreams -= 1;
    if (upstream.retiring) {
      retireIfDrained(route, upstream);
    } else if (!upstream.primary && upstream.activeStreams === 0) {
      // Retain a warm socket for subsequent assets and Range requests, then give
      // the relay its resources back when the page becomes quiet.
      upstream.idleTimer = setTimeout(() => {
        if (upstream.activeStreams === 0) void closeUpstream(route, upstream);
      }, VIEWER_IDLE_CONNECTION_MS);
      upstream.idleTimer.unref();
    }
  };
  const reserve = (upstream: ViewerUpstream): ViewerRequestLoad => {
    if (upstream.idleTimer) clearTimeout(upstream.idleTimer);
    upstream.idleTimer = null;
    upstream.activeStreams += 1;
    const load = { remainingBytes: 0 };
    upstream.requests.add(load);
    return load;
  };
  const remainingBytes = (upstream: ViewerUpstream): number => {
    let total = 0;
    for (const load of upstream.requests) total += load.remainingBytes;
    return total;
  };
  const leastBusy = (route: ViewerRoute): ViewerUpstream => {
    let selected: ViewerUpstream | undefined;
    for (const upstream of route.upstreams) {
      if (
        !selected ||
        remainingBytes(upstream) < remainingBytes(selected) ||
        (remainingBytes(upstream) === remainingBytes(selected) &&
          upstream.activeStreams < selected.activeStreams)
      ) {
        selected = upstream;
      }
    }
    if (!selected) throw new Error("Viewer proxy has no upstream connection");
    return selected;
  };
  const openAdditional = (route: ViewerRoute): Promise<ViewerUpstream | null> => {
    const opening = (async () => {
      const next = await createUpstream(input.serverId, route.connection);
      if (next.client.getLastServerInfoMessage()?.features?.viewerHttpProxy !== true) {
        await next.client.close();
        throw new Error("Update the host to use the viewer HTTP proxy");
      }
      if (closing || route !== currentRoute) {
        await next.client.close();
        return null;
      }
      const upstream: ViewerUpstream = {
        ...next,
        primary: false,
        requests: new Set(),
        idleTimer: null,
      };
      route.upstreams.add(upstream);
      generations.add(upstream);
      // The request that prompted this handshake may already have been
      // cancelled. Do not leave an unused extra connection alive indefinitely.
      upstream.idleTimer = setTimeout(() => {
        if (upstream.activeStreams === 0) void closeUpstream(route, upstream);
      }, VIEWER_IDLE_CONNECTION_MS);
      upstream.idleTimer.unref();
      log.debug("[viewer-http] Added relay connection", {
        serverId: input.serverId,
        connections: route.upstreams.size,
      });
      return upstream;
    })().catch((error) => {
      route.expansionFailed = true;
      log.debug("[viewer-http] Could not expand upstream pool", error);
      return null;
    });
    route.opening = opening;
    pendingOpenings.add(opening);
    void opening
      .finally(() => {
        if (route.opening === opening) route.opening = null;
        pendingOpenings.delete(opening);
      })
      .catch(() => undefined);
    return opening;
  };
  const acquire = (
    signal: AbortSignal,
  ): { route: ViewerRoute; upstream: ViewerUpstream; load: ViewerRequestLoad } => {
    if (closing || signal.aborted) throw new Error("Viewer request cancelled");
    const route = currentRoute;
    const available = leastBusy(route);
    if (
      route.connection.type === "relay" &&
      remainingBytes(available) > VIEWER_REUSE_TAIL_BYTES &&
      !route.expansionFailed &&
      !route.opening
    ) {
      // Do not hold this browser resource behind a relay handshake. It can
      // share the current socket while the new one becomes available to later
      // resources; concurrent arrivals still share one opening attempt.
      void openAdditional(route);
    }
    return { route, upstream: available, load: reserve(available) };
  };
  const proxy = await createLocalViewerHttpProxy({
    fetch: async (request) => {
      const { route, upstream, load } = acquire(request.signal);
      try {
        const response = await upstream.client.fetchViewerHttp(request);
        const contentLength = Number(response.headers["content-length"]);
        if (request.method === "HEAD" || response.status === 204 || response.status === 304) {
          load.remainingBytes = 0;
        } else if (Number.isSafeInteger(contentLength) && contentLength >= 0) {
          load.remainingBytes = contentLength;
        } else {
          load.remainingBytes = Number.POSITIVE_INFINITY;
        }
        route.expansionFailed = false;
        void response.stream.whenClosed().then(
          () => release(route, upstream, load),
          () => release(route, upstream, load),
        );
        return {
          ...response,
          onData: (bytes: number) => {
            load.remainingBytes = Math.max(0, load.remainingBytes - bytes);
          },
        };
      } catch (error) {
        release(route, upstream, load);
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
        if (currentRoute.routeKey === nextRouteKey) return undefined;
        const replacement = await createUpstream(input.serverId, connection);
        if (replacement.client.getLastServerInfoMessage()?.features?.viewerHttpProxy !== true) {
          await replacement.client.close();
          throw new Error("Update the host to use the viewer HTTP proxy");
        }
        if (closing) {
          await replacement.client.close();
          return undefined;
        }
        const upstream: ViewerUpstream = {
          ...replacement,
          primary: true,
          requests: new Set(),
          idleTimer: null,
        };
        const nextRoute: ViewerRoute = {
          connection,
          routeKey: nextRouteKey,
          upstreams: new Set([upstream]),
          opening: null,
          expansionFailed: false,
        };
        generations.add(upstream);
        const previous = currentRoute;
        currentRoute = nextRoute;
        for (const old of previous.upstreams) {
          old.retiring = true;
          retireIfDrained(previous, old);
        }
        return undefined;
      });
    return routeUpdate;
  };
  return {
    proxy,
    updateRoute,
    close: async () => {
      closing = true;
      await routeUpdate.catch(() => undefined);
      await proxy.close();
      await Promise.allSettled(pendingOpenings);
      await Promise.allSettled([...generations].map((upstream) => upstream.client.close()));
      for (const upstream of generations) {
        if (upstream.idleTimer) clearTimeout(upstream.idleTimer);
      }
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
