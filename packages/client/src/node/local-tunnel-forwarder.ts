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
  onConnectionError?: (error: unknown) => void;
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
    let tunnel: DaemonTunnel | null = null;
    let reportedFailure = false;
    const resetTunnel = () => {
      if (!tunnel) return;
      try {
        tunnel.reset();
      } catch {
        tunnel.abort();
      }
    };
    const failConnection = (error: unknown) => {
      if (reportedFailure) return;
      reportedFailure = true;
      try {
        input.onConnectionError?.(error);
      } catch {
        // Diagnostics must not affect forwarding or socket teardown.
      }
      resetTunnel();
      socket.destroy();
    };
    const sendToTunnel = (action: "write" | "end" | "pause" | "resume", data?: Uint8Array) => {
      if (!tunnel) return;
      try {
        switch (action) {
          case "write":
            if (data) tunnel.write(data);
            break;
          case "end":
            tunnel.end();
            break;
          case "pause":
            tunnel.pauseRemote();
            break;
          case "resume":
            tunnel.resumeRemote();
            break;
        }
      } catch (error) {
        failConnection(error);
      }
    };

    // A failed upstream open may destroy this socket before handlers are installed below.
    // Always consume socket errors so one browser resource cannot become an uncaught
    // exception in the Electron main process.
    socket.on("error", resetTunnel);
    socket.once("close", (hadError) => {
      finished = true;
      sockets.delete(socket);
      if (hadError || !localEnded) resetTunnel();
    });

    const idleTunnel = idleTunnels.shift();
    fillIdleTunnels();
    void (idleTunnel ? Promise.resolve(idleTunnel) : openTunnel(input.target))
      .then((openedTunnel) => {
        tunnel = openedTunnel;
        if (finished || socket.destroyed) {
          resetTunnel();
          return undefined;
        }
        let remotePaused = false;
        openedTunnel.setHandlers({
          onData: (data) => {
            if (socket.destroyed) return;
            socket.write(data);
            if (!remotePaused && socket.writableLength >= LOCAL_SOCKET_HIGH_WATER_BYTES) {
              remotePaused = true;
              sendToTunnel("pause");
              if (socket.destroyed) return;
              socket.once("drain", () => {
                remotePaused = false;
                sendToTunnel("resume");
              });
            }
          },
          onEnd: () => socket.end(),
          onReset: () => socket.destroy(),
          onPause: () => socket.pause(),
          onResume: () => socket.resume(),
        });
        socket.on("data", (data) => sendToTunnel("write", data));
        socket.once("end", () => {
          localEnded = true;
          sendToTunnel("end");
        });
        socket.resume();
        return undefined;
      })
      .catch((error: unknown) => {
        if (finished || socket.destroyed) return;
        // This is one failed browser connection, not a failure of the listener.
        // Destroy without an Error: passing it to destroy() emits an uncaught socket
        // error before an upstream tunnel exists, which Electron shows as a modal.
        failConnection(error);
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
