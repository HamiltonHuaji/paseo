import type { DaemonClient } from "./daemon-client.js";
import type { DaemonTunnel } from "./daemon-tunnel.js";
import type { TunnelTarget } from "@getpaseo/protocol/tunnels";
import type { ViewerConnection } from "./viewer-http-proxy.js";

interface Generation {
  id: number;
  client: DaemonClient;
  streams: Set<DaemonTunnel>;
  opening: number;
  ready: Promise<void>;
}

/** HostRuntime supplies generations; this manager never probes or selects a route. */
export function createTunnelUpstream(input: {
  createClient: (connection: ViewerConnection) => DaemonClient;
  onError: (error: unknown) => void;
}) {
  let current: Generation | null = null;
  let desired: { key: string; generation: Generation } | null = null;
  let closed = false;
  const generations = new Set<Generation>();
  const closing = new Set<Promise<void>>();
  const terminated: Array<ReturnType<DaemonTunnel["getState"]> & { generation: number }> = [];

  function retire(generation: Generation): void {
    if (!closed && (generation === current || generation === desired?.generation)) return;
    if (generation.streams.size || generation.opening) return;
    if (!generations.delete(generation)) return;
    const pending = generation.client.close();
    closing.add(pending);
    void pending.catch(input.onError).finally(() => closing.delete(pending));
  }

  function updateRoute(connection: ViewerConnection, routeGeneration: number): Promise<void> {
    if (closed) return Promise.reject(new Error("Tunnel forwarder is closed"));
    const key = JSON.stringify([connection, routeGeneration]);
    if (desired?.key === key) return desired.generation.ready;
    const client = input.createClient(connection);
    const generation: Generation = {
      id: routeGeneration,
      client,
      streams: new Set(),
      opening: 0,
      ready: Promise.resolve(),
    };
    const previousDesired = desired?.generation;
    desired = { key, generation };
    generations.add(generation);
    generation.ready = client
      .connect()
      .then(() => {
        if (closed || desired?.generation !== generation) {
          retire(generation);
          throw new Error("Tunnel route superseded");
        }
        const previous = current;
        current = generation;
        if (previous) retire(previous);
        return undefined;
      })
      .catch((error: unknown) => {
        if (desired?.generation === generation) desired = null;
        retire(generation);
        throw error;
      });
    // Route changes are proactive, including when no browser connection is waiting.
    void generation.ready.catch(input.onError);
    if (previousDesired && previousDesired !== current) retire(previousDesired);
    return generation.ready;
  }

  async function openTunnel(target: TunnelTarget): Promise<DaemonTunnel> {
    if (closed || !desired) throw new Error("Viewer transport is unavailable");
    // New sockets wait for the selected replacement. Existing streams keep their source.
    const generation = desired.generation;
    await generation.ready;
    if (closed || desired?.generation !== generation) throw new Error("Tunnel route changed");
    generation.opening += 1;
    try {
      await generation.client.connect();
      const stream = await generation.client.openTunnel(target);
      generation.streams.add(stream);
      void stream.whenClosed().then(() => {
        generation.streams.delete(stream);
        terminated.push(Object.assign(stream.getState(), { generation: generation.id }));
        if (terminated.length > 64) terminated.shift();
        retire(generation);
        return undefined;
      });
      if (closed) stream.abort("forwarder_closed");
      return stream;
    } finally {
      generation.opening -= 1;
      retire(generation);
    }
  }

  return {
    updateRoute,
    openTunnel,
    getState: () => ({
      currentRouteGeneration: current?.id ?? null,
      terminatedStreams: [...terminated],
      generations: [...generations].map((generation) => ({
        generation: generation.id,
        state: generation.client.getConnectionState().status,
        activeStreams: generation.streams.size,
        openingStreams: generation.opening,
        streams: [...generation.streams].map((stream) => stream.getState()),
      })),
    }),
    async close(): Promise<void> {
      closed = true;
      current = null;
      desired = null;
      for (const generation of generations) {
        for (const stream of generation.streams) stream.abort("forwarder_closed");
        const pending = generation.client.close();
        closing.add(pending);
      }
      await Promise.allSettled(closing);
      generations.clear();
    },
  };
}
