import { requireNativeModule, NativeModule } from "expo-modules-core";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Buffer } from "buffer";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { createViewerHttpUpstream } from "@getpaseo/client/internal/viewer-http-upstream";
import {
  ViewerProxyStateSchema,
  VIEWER_REQUEST_HEADERS,
  viewerPortCandidates,
  type ViewerConnection,
  type ViewerProxyInput,
} from "@getpaseo/client/internal/viewer-http-proxy";
import {
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl,
  shouldUseTlsForDefaultHostedRelay,
} from "@getpaseo/protocol/daemon-endpoints";
import { createAppWebSocketFactory } from "@/runtime/websocket-factory";
import { readValidatedJson } from "@/storage/validated-storage";
import { z } from "zod";

const RequestSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  method: z.enum(["GET", "HEAD"]),
  path: z.string(),
  headers: z.record(z.string(), z.string()),
});
type NativeRequest = z.infer<typeof RequestSchema>;
interface ProxyEvents {
  onRequest: (request: NativeRequest) => void;
  onCancel: (event: { id: string }) => void;
  onStopped: (event: { disabled: boolean }) => void;
}
declare class ProxyModule extends NativeModule<{
  [Event in keyof ProxyEvents]: ProxyEvents[Event];
}> {
  ensureListener(serverId: string, ports: number[]): Promise<number>;
  removeListener(serverId: string): Promise<void>;
  headers(id: string, status: number, headers: Record<string, string>): Promise<void>;
  write(id: string, base64: string): Promise<void>;
  finish(id: string): Promise<void>;
  fail(id: string): Promise<void>;
}

const native = requireNativeModule<ProxyModule>("PaseoViewerProxy");
const STORAGE_KEY = "@paseo:viewer-proxy-ports";
const stateReady = readValidatedJson(AsyncStorage, STORAGE_KEY, ViewerProxyStateSchema).then(
  (state) => state ?? {},
);
const upstreams = new Map<string, ReturnType<typeof createViewerHttpUpstream>>();
const requests = new Map<string, AbortController>();
let mutation = Promise.resolve();
let finishTask: (() => void) | null = null;

function mutate<Result>(operation: () => Promise<Result>): Promise<Result> {
  const pending = mutation.then(operation);
  mutation = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}

function reportError(error: unknown): void {
  console.warn("[viewer-http]", error instanceof Error ? error.message : String(error));
}

function createViewerClient(serverId: string, connection: ViewerConnection): DaemonClient {
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
    clientId: `android-viewer-${globalThis.crypto.randomUUID()}`,
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

function getUpstream(serverId: string) {
  let upstream = upstreams.get(serverId);
  if (!upstream) {
    upstream = createViewerHttpUpstream({
      createClient: (connection) => createViewerClient(serverId, connection),
      onError: reportError,
    });
    upstreams.set(serverId, upstream);
  }
  return upstream;
}

async function forward(raw: NativeRequest): Promise<void> {
  const request = RequestSchema.parse(raw);
  const cancellation = new AbortController();
  requests.set(request.id, cancellation);
  const headers: Record<string, string> = {};
  for (const name of VIEWER_REQUEST_HEADERS) {
    const value = request.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  try {
    const response = await getUpstream(request.serverId).fetch({
      method: request.method,
      path: request.path,
      headers,
      signal: cancellation.signal,
    });
    const stream = response.stream;
    const cancel = () => {
      try {
        stream.cancel();
      } catch (error) {
        stream.abort();
        reportError(error);
      }
    };
    cancellation.signal.addEventListener("abort", cancel, { once: true });
    if (cancellation.signal.aborted) {
      cancel();
      return;
    }
    let tail = native.headers(request.id, response.status, response.headers);
    let queuedBytes = 0;
    let failing = false;
    const fail = async (error: unknown) => {
      if (failing) return;
      failing = true;
      reportError(error);
      cancel();
      await native.fail(request.id);
    };
    // Credit returns after the native socket write, never after enqueueing a bridge call.
    stream.setHandlers({
      onData(data) {
        response.onData(data.byteLength);
        queuedBytes += data.byteLength;
        stream.pause();
        tail = tail.then(async () => {
          await native.write(request.id, Buffer.from(data).toString("base64"));
          queuedBytes -= data.byteLength;
          stream.consumed(data.byteLength);
          if (queuedBytes === 0) stream.resume();
          return undefined;
        });
        void tail.catch(fail).catch(reportError);
      },
      onEnd() {
        void tail
          .then(() => native.finish(request.id))
          .catch(fail)
          .catch(reportError);
      },
      onReset() {
        void native.fail(request.id).catch(reportError);
      },
    });
    void tail.catch(fail).catch(reportError);
    await stream.whenClosed();
    await tail;
    cancellation.signal.removeEventListener("abort", cancel);
  } catch (error) {
    reportError(error);
    await native.fail(request.id);
  } finally {
    requests.delete(request.id);
  }
}

native.addListener("onRequest", (request) => {
  void forward(request).catch(reportError);
});
native.addListener("onCancel", ({ id }) => {
  requests.get(id)?.abort();
});
native.addListener("onStopped", ({ disabled }) => {
  for (const request of requests.values()) request.abort();
  const active = [...upstreams.values()];
  upstreams.clear();
  const finish = finishTask;
  finishTask = null;
  void Promise.allSettled(active.map((upstream) => upstream.close())).then(() => {
    finish?.();
    return undefined;
  });
  if (disabled) {
    void mutate(async () => {
      const state = await stateReady;
      for (const assignment of Object.values(state)) assignment.enabled = false;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }).catch(reportError);
  }
});

export function runViewerProxyTask(): Promise<void> {
  return new Promise<void>((resolve) => {
    finishTask = resolve;
  });
}

export function canProxyViewers(): boolean {
  return true;
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
    getUpstream(input.serverId).updateRoute(input.connection);
    return ensureListener(input.serverId);
  });
}

export function updateViewerProxyRoute(input: ViewerProxyInput): Promise<void> {
  return mutate(async () => {
    const state = await stateReady;
    if (!state[input.serverId]?.enabled) return;
    getUpstream(input.serverId).updateRoute(input.connection);
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
      } else if (assignment.enabled) {
        await ensureListener(serverId);
      }
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  });
}
