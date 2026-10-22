import type { DaemonClient } from "./daemon-client.js";
import type { ViewerConnection, ViewerHttpRequest } from "./viewer-http-proxy.js";
import { VIEWER_HTTP_DATA_FRAME_BYTES } from "@getpaseo/protocol/binary-frames/index";

interface RequestLoad {
  remainingBytes: number;
}

interface Upstream {
  client: DaemonClient;
  primary: boolean;
  requests: Set<RequestLoad>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface Route {
  connection: ViewerConnection;
  upstreams: Set<Upstream>;
  connecting: Set<DaemonClient>;
  opening: Promise<Upstream> | null;
  expansionFailed: boolean;
}

export function createViewerHttpUpstream(input: {
  createClient: (connection: ViewerConnection) => DaemonClient;
  onError: (error: unknown) => void;
}) {
  let current: Route | null = null;
  let closed = false;
  const routes = new Set<Route>();
  const closingConnections = new Set<Promise<void>>();

  function closeClient(client: DaemonClient): void {
    const closing = client.close();
    closingConnections.add(closing);
    void closing.catch(input.onError).finally(() => closingConnections.delete(closing));
  }

  function closeUpstream(route: Route, upstream: Upstream): void {
    if (!route.upstreams.delete(upstream)) return;
    if (upstream.idleTimer) clearTimeout(upstream.idleTimer);
    closeClient(upstream.client);
    if (route !== current && route.upstreams.size === 0 && !route.opening) routes.delete(route);
  }

  function release(route: Route, upstream: Upstream, load: RequestLoad): void {
    upstream.requests.delete(load);
    if (upstream.requests.size > 0) return;
    if (closed || route !== current) {
      closeUpstream(route, upstream);
    } else if (!upstream.primary) {
      upstream.idleTimer = setTimeout(() => closeUpstream(route, upstream), 60_000);
    }
  }

  function open(route: Route): Promise<Upstream> {
    const client = input.createClient(route.connection);
    route.connecting.add(client);
    const opening = client.connect().then(async () => {
      if (closed || route !== current) {
        await client.close();
        throw new Error("Viewer route changed");
      }
      if (client.getLastServerInfoMessage()?.features?.viewerHttpProxy !== true) {
        await client.close();
        throw new Error("Update the host to use the viewer HTTP proxy");
      }
      const upstream: Upstream = {
        client,
        primary: route.upstreams.size === 0,
        requests: new Set(),
        idleTimer: null,
      };
      route.upstreams.add(upstream);
      route.expansionFailed = false;
      if (!upstream.primary) {
        upstream.idleTimer = setTimeout(() => closeUpstream(route, upstream), 60_000);
      }
      return upstream;
    });
    route.opening = opening;
    void opening
      .catch((error) => {
        route.expansionFailed = true;
        closeClient(client);
        if (!closed && route === current) input.onError(error);
      })
      .finally(() => {
        route.connecting.delete(client);
        if (route.opening === opening) route.opening = null;
      });
    return opening;
  }

  function remainingBytes(upstream: Upstream): number {
    let bytes = 0;
    for (const load of upstream.requests) bytes += load.remainingBytes;
    return bytes;
  }

  async function fetch(request: ViewerHttpRequest) {
    if (closed || !current) throw new Error("Viewer host is unavailable");
    const route = current;
    if (route.upstreams.size === 0) await (route.opening ?? open(route));
    if (closed || route !== current || request.signal.aborted) {
      throw new Error("Viewer request cancelled");
    }
    const upstreams = [...route.upstreams];
    upstreams.sort(
      (left, right) =>
        remainingBytes(left) - remainingBytes(right) || left.requests.size - right.requests.size,
    );
    const upstream = upstreams[0];
    if (upstream.idleTimer) clearTimeout(upstream.idleTimer);
    upstream.idleTimer = null;
    const shouldExpand =
      route.connection.type === "relay" &&
      remainingBytes(upstream) > 4 * VIEWER_HTTP_DATA_FRAME_BYTES &&
      route.upstreams.size < 4 &&
      !route.opening &&
      !route.expansionFailed;
    if (shouldExpand) void open(route).catch(() => undefined);
    const load: RequestLoad = { remainingBytes: Number.POSITIVE_INFINITY };
    upstream.requests.add(load);
    try {
      await upstream.client.connect();
      const response = await upstream.client.fetchViewerHttp(request);
      const length = Number(response.headers["content-length"]);
      const hasNoBody =
        request.method === "HEAD" || response.status === 204 || response.status === 304;
      if (hasNoBody) load.remainingBytes = 0;
      else if (Number.isSafeInteger(length) && length >= 0) load.remainingBytes = length;
      void response.stream.whenClosed().then(() => release(route, upstream, load));
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
  }

  return {
    fetch,
    updateRoute(connection: ViewerConnection): void {
      if (closed) throw new Error("Viewer proxy is closed");
      if (current && JSON.stringify(current.connection) === JSON.stringify(connection)) return;
      const previous = current;
      current = {
        connection,
        upstreams: new Set(),
        connecting: new Set(),
        opening: null,
        expansionFailed: false,
      };
      routes.add(current);
      if (previous) {
        for (const client of previous.connecting) closeClient(client);
        for (const upstream of previous.upstreams) {
          if (upstream.requests.size === 0) closeUpstream(previous, upstream);
        }
        if (!previous.opening && previous.upstreams.size === 0) routes.delete(previous);
      }
    },
    async close(): Promise<void> {
      closed = true;
      for (const route of routes) {
        for (const client of route.connecting) closeClient(client);
        for (const upstream of route.upstreams) closeUpstream(route, upstream);
      }
      await Promise.allSettled([...routes].map((route) => route.opening));
      await Promise.allSettled(closingConnections);
      routes.clear();
    },
  };
}
