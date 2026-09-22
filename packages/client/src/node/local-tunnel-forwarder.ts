import net from "node:net";
import type { TunnelTarget } from "@getpaseo/protocol/tunnels";
import type { DaemonClient } from "../daemon-client.js";
import type { DaemonTunnel } from "../daemon-tunnel.js";

export interface LocalTunnelForwarder {
  readonly host: string;
  readonly port: number;
  readonly origin: string;
  close(): Promise<void>;
}

export async function createLocalTunnelForwarder(input: {
  client?: DaemonClient;
  openTunnel?: (target: TunnelTarget) => Promise<DaemonTunnel>;
  target: TunnelTarget;
  host?: string;
  port?: number;
}): Promise<LocalTunnelForwarder> {
  const host = input.host ?? "127.0.0.1";
  const openTunnel =
    input.openTunnel ?? ((target: TunnelTarget) => input.client!.openTunnel(target));
  if (!input.client && !input.openTunnel)
    throw new Error("Local tunnel requires an upstream client");
  const sockets = new Set<net.Socket>();
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.pause();
    let finished = false;
    let localEnded = false;

    void openTunnel(input.target)
      .then((tunnel) => {
        if (finished || socket.destroyed) {
          tunnel.reset();
          return undefined;
        }
        tunnel.setHandlers({
          onData: (data) => {
            if (!socket.write(data)) {
              tunnel.pauseRemote();
              socket.once("drain", () => tunnel.resumeRemote());
            }
          },
          onEnd: () => socket.end(),
          onReset: () => socket.destroy(),
          onPause: () => socket.pause(),
          onResume: () => socket.resume(),
        });
        socket.on("data", (data) => tunnel.write(data));
        socket.once("end", () => {
          localEnded = true;
          tunnel.end();
        });
        socket.once("error", () => tunnel.reset());
        socket.once("close", (hadError) => {
          if (hadError || !localEnded) tunnel.reset();
        });
        socket.resume();
        return undefined;
      })
      .catch((error: unknown) => {
        socket.destroy(error instanceof Error ? error : new Error(String(error)));
      });

    socket.once("close", () => {
      finished = true;
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Local tunnel did not bind a TCP port");
  }

  return {
    host,
    port: address.port,
    origin: `http://${host}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
