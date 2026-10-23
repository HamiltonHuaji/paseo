import { requireNativeModule, NativeModule } from "expo-modules-core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Buffer } from "buffer";
import { createTunnelUpstream } from "@getpaseo/client/internal/tunnel-upstream";
import type { DaemonTunnel } from "@getpaseo/client/internal/daemon-tunnel";
import {
  ViewerProxyStateSchema,
  viewerPortCandidates,
  type ViewerProxyInput,
} from "@getpaseo/client/internal/viewer-http-proxy";
import { createViewerClient } from "./client";
import { createViewerTaskLifetime } from "./task-lifetime";
import { readValidatedJson } from "@/storage/validated-storage";

interface ProxyEvents {
  onOpen: (event: { id: string; serverId: string }) => void;
  onData: (event: { id: string; base64: string }) => void;
  onEnd: (event: { id: string }) => void;
  onReset: (event: { id: string }) => void;
  onStopped: (event: { disabled: boolean; serviceId: string }) => void;
}
declare class ProxyModule extends NativeModule<{
  [Event in keyof ProxyEvents]: ProxyEvents[Event];
}> {
  ensureListener(serverId: string, ports: number[]): Promise<number>;
  removeListener(serverId: string): Promise<void>;
  resume(id: string): Promise<void>;
  write(id: string, base64: string): Promise<void>;
  end(id: string): Promise<void>;
  reset(id: string): Promise<void>;
  getState(): Promise<unknown>;
  getServiceId(): Promise<string | null>;
}

const native = requireNativeModule<ProxyModule>("PaseoViewerProxy");
const STORAGE_KEY = "@paseo:viewer-proxy-ports";
const stateReady = readValidatedJson(AsyncStorage, STORAGE_KEY, ViewerProxyStateSchema).then(
  (state) => state ?? {},
);
const upstreams = new Map<string, ReturnType<typeof createTunnelUpstream>>();
const streams = new Map<string, { tunnel: DaemonTunnel | null; paused: boolean }>();
let mutation = Promise.resolve();
const tasks = createViewerTaskLifetime(() => native.getServiceId());

function mutate<Result>(operation: () => Promise<Result>): Promise<Result> {
  const pending = mutation.then(operation);
  mutation = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}
function reportError(): void {
  console.warn("[viewer-tunnel] Transport operation failed");
}
function getUpstream(serverId: string) {
  let upstream = upstreams.get(serverId);
  if (!upstream) {
    upstream = createTunnelUpstream({
      createClient: (connection) => createViewerClient(serverId, connection),
      onError: reportError,
    });
    upstreams.set(serverId, upstream);
  }
  return upstream;
}
function reset(id: string): void {
  const stream = streams.get(id);
  streams.delete(id);
  try {
    stream?.tunnel?.reset();
  } catch {
    stream?.tunnel?.abort();
  }
  void native.reset(id).catch(reportError);
}

native.addListener("onOpen", ({ id, serverId }) => {
  const state = { tunnel: null as DaemonTunnel | null, paused: false };
  streams.set(id, state);
  void getUpstream(serverId)
    .openTunnel({ type: "service", name: "viewers" })
    .then(async (tunnel) => {
      if (streams.get(id) !== state) {
        tunnel.reset();
        return undefined;
      }
      state.tunnel = tunnel;
      let tail = Promise.resolve();
      const fail = () => {
        reportError();
        reset(id);
      };
      tunnel.setHandlers({
        onData(bytes) {
          tail = tail.then(async () => {
            await native.write(id, Buffer.from(bytes).toString("base64"));
            if (bytes.byteLength) tunnel.consumed(bytes.byteLength);
            return undefined;
          });
          void tail.catch(fail);
        },
        onEnd() {
          tail = tail.then(() => native.end(id));
          void tail.catch(fail);
        },
        onReset() {
          reset(id);
        },
        onPause() {
          state.paused = true;
        },
        onResume() {
          state.paused = false;
          void native.resume(id).catch(fail);
        },
      });
      await native.resume(id);
      await tunnel.whenClosed();
      await tail;
      streams.delete(id);
      return undefined;
    })
    .catch(() => {
      reportError();
      reset(id);
    });
});
native.addListener("onData", ({ id, base64 }) => {
  const stream = streams.get(id);
  if (!stream?.tunnel) {
    reset(id);
    return;
  }
  try {
    stream.tunnel.write(Buffer.from(base64, "base64"));
    if (!stream.paused) void native.resume(id).catch(() => reset(id));
  } catch {
    reset(id);
  }
});
native.addListener("onEnd", ({ id }) => {
  try {
    streams.get(id)?.tunnel?.end();
  } catch {
    reset(id);
  }
});
native.addListener("onReset", ({ id }) => {
  reset(id);
});
native.addListener("onStopped", ({ disabled, serviceId }) => {
  // Serialize with listener creation: a queued stop from an old service must not
  // close the replacement's routes or persist its listeners as disabled.
  void mutate(async () => {
    const current = await native.getServiceId();
    if (current !== null && current !== serviceId) return;
    for (const id of streams.keys()) reset(id);
    const active = [...upstreams.values()];
    upstreams.clear();
    await Promise.allSettled(active.map((upstream) => upstream.close()));
    if (disabled) {
      const state = await stateReady;
      for (const assignment of Object.values(state)) assignment.enabled = false;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  })
    .finally(() => tasks.stop(serviceId))
    .catch(reportError);
});

export function runViewerProxyTask(serviceId: string): Promise<void> {
  return tasks.run(serviceId);
}
export function canProxyViewers(): boolean {
  return true;
}
export async function isDirectViewerReachable(origin: string): Promise<boolean> {
  try {
    await fetch(origin, { method: "HEAD", signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function ensureListener(serverId: string): Promise<{ origin: string }> {
  const state = await stateReady;
  const port = await native.ensureListener(serverId, viewerPortCandidates({ serverId, state }));
  const previous = state[serverId];
  state[serverId] = { port, enabled: true };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    if (previous) state[serverId] = previous;
    else delete state[serverId];
    await native.removeListener(serverId);
    throw error;
  }
  return { origin: `http://127.0.0.1:${port}` };
}
export function ensureViewerProxy(input: ViewerProxyInput): Promise<{ origin: string }> {
  return mutate(async () => {
    const listener = await ensureListener(input.serverId);
    await getUpstream(input.serverId).updateRoute(input.connection, input.routeGeneration ?? 0);
    return listener;
  });
}
export function updateViewerProxyRoute(input: ViewerProxyInput): Promise<void> {
  return mutate(async () => {
    if (!(await stateReady)[input.serverId]?.enabled) return;
    await getUpstream(input.serverId).updateRoute(input.connection, input.routeGeneration ?? 0);
  });
}
export function syncViewerProxyHosts(serverIds: string[]): Promise<void> {
  return mutate(async () => {
    const state = await stateReady;
    const hosts = new Set(serverIds);
    for (const [serverId, assignment] of Object.entries(state)) {
      if (!hosts.has(serverId)) {
        assignment.enabled = false;
        await native.removeListener(serverId);
        await upstreams.get(serverId)?.close();
        upstreams.delete(serverId);
      } else if (assignment.enabled) await ensureListener(serverId);
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  });
}
export async function getViewerProxyState() {
  return {
    listeners: await native.getState(),
    upstreams: [...upstreams].map(([serverId, upstream]) =>
      Object.assign(upstream.getState(), { serverId }),
    ),
  };
}
