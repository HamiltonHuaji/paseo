import net from "node:net";
import type { TunnelTarget } from "@getpaseo/protocol/tunnels";
import type { DaemonClient } from "../daemon-client.js";
import type { DaemonTunnel } from "../daemon-tunnel.js";

export interface LocalTunnelForwarder {
  readonly host: string;
  readonly port: number;
  readonly origin: string;
  resetIdleTunnels(): void;
  close(): Promise<void>;
}

const LOCAL_SOCKET_HIGH_WATER_BYTES = 1024 * 1024;

export async function createLocalTunnelForwarder(input: {
  client?: DaemonClient;
  openTunnel?: (target: TunnelTarget) => Promise<DaemonTunnel>;
  target: TunnelTarget;
  host?: string;
  port?: number;
  idleTunnelPoolSize?: number;
}): Promise<LocalTunnelForwarder> {
  const host = input.host ?? "127.0.0.1";
  const openTunnel =
    input.openTunnel ?? ((target: TunnelTarget) => input.client!.openTunnel(target));
  if (!input.client && !input.openTunnel)
    throw new Error("Local tunnel requires an upstream client");
  const idleTunnelPoolSize = Math.max(0, Math.floor(input.idleTunnelPoolSize ?? 0));
  const sockets = new Set<net.Socket>();
  const idleTunnels: DaemonTunnel[] = [];
  let openingIdleTunnels = 0;
  let poolEpoch = 0;
  let closed = false;

  const fillIdleTunnels = () => {
    if (closed) return;
    const epoch = poolEpoch;
    const missingTunnelCount = idleTunnelPoolSize - idleTunnels.length - openingIdleTunnels;
    for (let slot = 0; slot < missingTunnelCount; slot += 1) {
      openingIdleTunnels += 1;
      void openTunnel(input.target)
        .then((tunnel) => {
          if (closed || epoch !== poolEpoch) {
            tunnel.reset();
            return undefined;
          }
          idleTunnels.push(tunnel);
          void tunnel.whenClosed().then(() => {
            const index = idleTunnels.indexOf(tunnel);
            if (index < 0) return undefined;
            idleTunnels.splice(index, 1);
            fillIdleTunnels();
            return undefined;
          });
          return undefined;
        })
        .catch(() => undefined)
        .finally(() => {
          openingIdleTunnels -= 1;
          if (epoch !== poolEpoch) fillIdleTunnels();
        });
    }
  };

  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.pause();
    let finished = false;
    let localEnded = false;

    const idleTunnel = idleTunnels.shift();
    fillIdleTunnels();
    void (idleTunnel ? Promise.resolve(idleTunnel) : openTunnel(input.target))
      .then((tunnel) => {
        if (finished || socket.destroyed) {
          tunnel.reset();
          return undefined;
        }
        let remotePaused = false;
        tunnel.setHandlers({
          onData: (data) => {
            socket.write(data);
            if (!remotePaused && socket.writableLength >= LOCAL_SOCKET_HIGH_WATER_BYTES) {
              remotePaused = true;
              tunnel.pauseRemote();
              socket.once("drain", () => {
                remotePaused = false;
                tunnel.resumeRemote();
              });
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

  fillIdleTunnels();

  return {
    host,
    port: address.port,
    origin: `http://${host}:${address.port}`,
    resetIdleTunnels: () => {
      poolEpoch += 1;
      for (const tunnel of idleTunnels.splice(0)) tunnel.reset();
      fillIdleTunnels();
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        closed = true;
        poolEpoch += 1;
        for (const tunnel of idleTunnels.splice(0)) tunnel.reset();
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
