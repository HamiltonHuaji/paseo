import { useEffect, useMemo } from "react";
import { Buffer } from "buffer";
import { createViewerHttpUpstream } from "@getpaseo/client/internal/viewer-http-upstream";
import {
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
  useHosts,
} from "@/runtime/host-runtime";
import { createViewerClient } from "@/viewers/client";
import { openHostViewer } from "@/viewers/open-from-host";

import { errorMessage, type WorksContextValue } from "./context";
export function useWorksConnection(
  serverId: string,
  projectId: string,
  active: boolean,
): WorksContextValue {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const hosts = useHosts();
  const runtime = useHostRuntimeSnapshot(serverId);
  const host = hosts.find((candidate) => candidate.serverId === serverId);
  const route = host?.connections.find(
    (connection) => connection.id === runtime?.activeConnectionId,
  );
  const connection = route?.type === "directTcp" || route?.type === "relay" ? route : null;
  const upstream = useMemo(() => {
    const value = createViewerHttpUpstream({
      createClient: (routeConnection) => createViewerClient(serverId, routeConnection),
      onError: (error) => console.warn("[works-viewer]", errorMessage(error)),
    });
    if (connection) value.updateRoute(connection);
    return value;
  }, [connection, serverId]);
  useEffect(
    () => () => {
      void upstream.close();
    },
    [upstream],
  );
  return useMemo(
    () => ({
      serverId,
      projectId,
      active,
      connected,
      client,
      readData: (path: string, signal: AbortSignal) => readViewerJson(upstream, path, signal),
      openViewer: (path: string) => openHostViewer(serverId, path),
    }),
    [serverId, projectId, active, connected, client, upstream],
  );
}

async function readViewerJson(
  upstream: ReturnType<typeof createViewerHttpUpstream>,
  path: string,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await upstream.fetch({
    method: "GET",
    path,
    headers: { accept: "application/json" },
    signal,
  });
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = [];
    const cleanup = () => signal.removeEventListener("abort", cancel);
    const cancel = () => {
      cleanup();
      response.stream.cancel();
      reject(new Error("Request cancelled"));
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    response.stream.setHandlers({
      onData(data) {
        parts.push(Buffer.from(data));
        response.onData(data.byteLength);
        response.stream.consumed(data.byteLength);
      },
      onEnd() {
        cleanup();
        resolve(Buffer.concat(parts));
      },
      onReset() {
        cleanup();
        reject(new Error("Viewer connection interrupted"));
      },
    });
  });
  const result: unknown = JSON.parse(bytes.toString("utf8"));
  if (response.status >= 400) {
    let message = `Viewer returned ${response.status}`;
    if (typeof result === "object" && result !== null && "error" in result) {
      const error = result.error;
      message =
        typeof error === "object" && error !== null && "message" in error
          ? String(error.message)
          : String(error);
    }
    throw new Error(message);
  }
  return result;
}
