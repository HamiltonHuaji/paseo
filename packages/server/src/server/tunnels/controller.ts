import net from "node:net";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { DaemonTunnel } from "@getpaseo/client/internal/daemon-tunnel";
import {
  encodeTunnelStreamFrame,
  TunnelStreamOpcode,
  type TunnelStreamFrame,
} from "@getpaseo/protocol/binary-frames/index";
import type { TunnelTarget } from "@getpaseo/protocol/tunnels";
import type { OwnedOperation } from "../session/owned-subscriptions/index.js";
import type { ServiceProxySubsystem } from "../service-proxy.js";

interface TunnelEntry {
  socket: net.Socket;
  owner: OwnedOperation;
  stream: DaemonTunnel;
  sendChain: Promise<void>;
  sourceId: string;
  deliveryFailed: boolean;
}

export class TunnelController {
  private readonly tunnels = new Map<string, TunnelEntry>();
  private readonly sources = new WeakMap<object, string>();

  constructor(
    private readonly serviceProxy: ServiceProxySubsystem | null,
    private readonly logger?: Pick<Logger, "debug" | "warn">,
    private readonly permitted: () => boolean = () => true,
  ) {}

  getState() {
    return [...this.tunnels.values()].map((entry) => this.describe(entry));
  }

  private describe(entry: TunnelEntry) {
    const state = Object.assign(entry.stream.getState(), { source: entry.sourceId });
    if (entry.deliveryFailed) {
      state.state = "aborted";
      state.terminationReason = "delivery_failed";
    }
    return state;
  }

  async open(target: TunnelTarget, owner: OwnedOperation): Promise<string> {
    if (owner.signal.aborted) throw new Error("Tunnel source detached");
    const endpoint = this.resolveTarget(target);
    const tunnelId = randomUUID();
    const socket = net.createConnection({ ...endpoint, allowHalfOpen: true });
    socket.setNoDelay(true);
    socket.pause();
    let sourceId = this.sources.get(owner.source);
    if (!sourceId) {
      sourceId = randomUUID();
      this.sources.set(owner.source, sourceId);
    }
    const stream = new DaemonTunnel(
      tunnelId,
      (frame) => {
        if (owner.signal.aborted) throw new Error("Tunnel source detached");
        entry.sendChain = entry.sendChain
          .then(async () => {
            if (!this.permitted()) {
              await owner.emitBinary(
                encodeTunnelStreamFrame({ opcode: TunnelStreamOpcode.Reset, tunnelId }),
              );
              stream.abort("permission_revoked");
              return undefined;
            }
            await owner.emitBinary(frame);
            return undefined;
          })
          .catch(() => {
            entry.deliveryFailed = true;
            this.logger?.warn({ tunnelId, source: entry.sourceId }, "Tunnel delivery failed");
            stream.abort("delivery_failed");
          });
      },
      () => {
        const state = stream.getState();
        // A FIN is directional. Finish the target's queued writes before releasing its socket.
        const drained =
          state.terminationReason === "complete" && !socket.writableFinished
            ? new Promise<void>((resolve) => {
                socket.once("finish", resolve);
                socket.once("close", resolve);
              })
            : Promise.resolve();
        if (state.terminationReason !== "complete") {
          if (!socket.destroyed && !socket.pending) socket.resetAndDestroy();
          else socket.destroy();
        }
        void Promise.all([entry.sendChain, drained]).finally(() => {
          this.logger?.debug(this.describe(entry), "Tunnel terminated");
          this.tunnels.delete(tunnelId);
          socket.destroy();
          owner.signal.removeEventListener("abort", detached);
          void owner.release();
        });
      },
    );
    const entry: TunnelEntry = {
      socket,
      owner,
      stream,
      sendChain: Promise.resolve(),
      sourceId,
      deliveryFailed: false,
    };
    const detached = () => stream.abort("source_detached");
    owner.signal.addEventListener("abort", detached, { once: true });
    this.tunnels.set(tunnelId, entry);
    socket.on("error", () => {
      try {
        stream.reset("target_error");
      } catch {
        stream.abort();
      }
    });
    socket.on("close", () => {
      if (stream.getState().terminationReason) return;
      try {
        stream.reset("target_closed");
      } catch {
        stream.abort();
      }
    });
    socket.on("data", (chunk: Buffer) => {
      try {
        stream.write(chunk);
      } catch {
        socket.destroy();
      }
    });
    socket.on("end", () => {
      try {
        stream.end();
      } catch {
        socket.destroy();
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          socket.off("error", failed);
          socket.off("close", closed);
        };
        const failed = () => {
          cleanup();
          reject(new Error("Tunnel target unavailable"));
        };
        const closed = () => {
          cleanup();
          reject(new Error("Tunnel source detached"));
        };
        socket.once("connect", () => {
          cleanup();
          resolve();
        });
        socket.once("error", failed);
        socket.once("close", closed);
      });
      if (owner.signal.aborted) throw new Error("Tunnel source detached");
      stream.setHandlers({
        onData: (bytes) => {
          socket.write(bytes, (error) => {
            if (error) {
              stream.abort("target_write_failed");
              return;
            }
            try {
              if (bytes.byteLength) stream.consumed(bytes.byteLength);
            } catch {
              socket.destroy();
            }
          });
        },
        onEnd: () => socket.end(),
        onReset: () => socket.destroy(),
        onPause: () => socket.pause(),
        onResume: () => socket.resume(),
      });
      this.logger?.debug({ tunnelId, source: sourceId, state: "open" }, "Tunnel opened");
      return tunnelId;
    } catch (error) {
      stream.abort("open_failed");
      throw error;
    }
  }

  handleFrame(frame: TunnelStreamFrame, source: object): void {
    const entry = this.tunnels.get(frame.tunnelId);
    if (!entry || entry.owner.source !== source) return;
    if (!this.permitted()) {
      this.revoke(source);
      return;
    }
    try {
      entry.stream.handleFrame(frame);
    } catch {
      entry.stream.abort("send_failed");
    }
  }

  revoke(source?: object): void {
    for (const entry of this.tunnels.values()) {
      if (source && entry.owner.source !== source) continue;
      // Reset must still be delivered after permission removal so the browser can settle.
      const frame = encodeTunnelStreamFrame({
        opcode: TunnelStreamOpcode.Reset,
        tunnelId: entry.stream.id,
      });
      entry.sendChain = entry.sendChain
        .then(() => entry.owner.emitBinary(frame))
        .catch(() => undefined);
      entry.stream.abort("permission_revoked");
    }
  }

  abort(tunnelId: string): void {
    this.tunnels.get(tunnelId)?.stream.abort("source_detached");
  }
  dispose(): void {
    for (const entry of this.tunnels.values()) entry.stream.abort("daemon_shutdown");
  }

  private resolveTarget(target: TunnelTarget): { host: string; port: number } {
    if (target.type === "tcp") return { host: target.host, port: target.port };
    const route = this.serviceProxy?.resolveInternalService(target.name);
    if (!route) throw new Error("Tunnel service is unavailable");
    return { host: route.host, port: route.port };
  }
}
