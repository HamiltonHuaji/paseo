import net from "node:net";
import { randomUUID } from "node:crypto";
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
  sendChain: Promise<void>;
  activated: boolean;
  downstreamEnded: boolean;
  upstreamEnded: boolean;
}

export class TunnelController {
  private readonly tunnels = new Map<string, TunnelEntry>();

  constructor(private readonly serviceProxy: ServiceProxySubsystem | null) {}

  async open(target: TunnelTarget, owner: OwnedOperation): Promise<string> {
    const endpoint = this.resolveTarget(target);
    const tunnelId = randomUUID();
    const socket = net.createConnection({ ...endpoint, allowHalfOpen: true });
    socket.setNoDelay(true);
    socket.pause();
    const entry: TunnelEntry = {
      socket,
      owner,
      sendChain: Promise.resolve(),
      activated: false,
      downstreamEnded: false,
      upstreamEnded: false,
    };
    this.tunnels.set(tunnelId, entry);

    socket.on("data", (chunk: Buffer) => {
      socket.pause();
      this.enqueueSend(tunnelId, entry, TunnelStreamOpcode.Data, chunk, () => {
        if (entry.activated && !entry.upstreamEnded) socket.resume();
      });
    });
    socket.on("end", () => {
      if (entry.upstreamEnded) return;
      entry.upstreamEnded = true;
      this.enqueueSend(tunnelId, entry, TunnelStreamOpcode.End, undefined, () =>
        this.finishIfClosed(tunnelId, entry),
      );
    });
    socket.on("error", () => {
      void this.reset(tunnelId, entry, true);
    });
    socket.on("close", (hadError) => {
      if (this.tunnels.get(tunnelId) !== entry) return;
      if (hadError || !entry.upstreamEnded || !entry.downstreamEnded) {
        void this.reset(tunnelId, entry, true);
      } else {
        this.finish(tunnelId, entry);
      }
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onConnect = () => {
          socket.off("error", onError);
          resolve();
        };
        const onError = (error: Error) => {
          socket.off("connect", onConnect);
          reject(error);
        };
        socket.once("connect", onConnect);
        socket.once("error", onError);
      });
      return tunnelId;
    } catch (error) {
      this.tunnels.delete(tunnelId);
      socket.destroy();
      throw error;
    }
  }

  handleFrame(frame: TunnelStreamFrame, source: object): void {
    const entry = this.tunnels.get(frame.tunnelId);
    if (!entry || entry.owner.source !== source) return;
    if (frame.opcode === TunnelStreamOpcode.Data) {
      if (entry.downstreamEnded) {
        void this.reset(frame.tunnelId, entry, true);
        return;
      }
      if (!entry.socket.write(frame.payload)) {
        this.enqueueSend(frame.tunnelId, entry, TunnelStreamOpcode.Pause);
        entry.socket.once("drain", () => {
          this.enqueueSend(frame.tunnelId, entry, TunnelStreamOpcode.Resume);
        });
      }
      return;
    }
    if (frame.opcode === TunnelStreamOpcode.Pause) {
      entry.socket.pause();
      return;
    }
    if (frame.opcode === TunnelStreamOpcode.Resume) {
      entry.activated = true;
      if (!entry.upstreamEnded) entry.socket.resume();
      return;
    }
    if (frame.opcode === TunnelStreamOpcode.Reset) {
      void this.reset(frame.tunnelId, entry, false);
      return;
    }
    if (entry.downstreamEnded) return;
    entry.downstreamEnded = true;
    entry.socket.end();
    this.finishIfClosed(frame.tunnelId, entry);
  }

  abort(tunnelId: string): void {
    const entry = this.tunnels.get(tunnelId);
    if (!entry) return;
    this.tunnels.delete(tunnelId);
    entry.socket.destroy();
  }

  dispose(): void {
    for (const [tunnelId] of this.tunnels) this.abort(tunnelId);
  }

  private resolveTarget(target: TunnelTarget): { host: string; port: number } {
    if (target.type === "tcp") return { host: target.host, port: target.port };
    const route = this.serviceProxy?.resolveInternalService(target.name);
    if (!route) throw new Error(`Tunnel service is unavailable: ${target.name}`);
    return { host: "127.0.0.1", port: route.port };
  }

  private enqueueSend(
    tunnelId: string,
    entry: TunnelEntry,
    opcode: TunnelStreamOpcode,
    payload?: Uint8Array,
    after?: () => void,
  ): void {
    entry.sendChain = entry.sendChain
      .then(() => entry.owner.emitBinary(encodeTunnelStreamFrame({ opcode, tunnelId, payload })))
      .then(
        () => after?.(),
        () => {
          void this.reset(tunnelId, entry, false);
        },
      );
  }

  private finishIfClosed(tunnelId: string, entry: TunnelEntry): void {
    if (!entry.downstreamEnded || !entry.upstreamEnded) return;
    void entry.sendChain.finally(() => this.finish(tunnelId, entry));
  }

  private finish(tunnelId: string, entry: TunnelEntry): void {
    if (this.tunnels.get(tunnelId) !== entry) return;
    this.tunnels.delete(tunnelId);
    entry.socket.destroy();
    void entry.owner.release();
  }

  private async reset(tunnelId: string, entry: TunnelEntry, notifyPeer: boolean): Promise<void> {
    if (this.tunnels.get(tunnelId) !== entry) return;
    this.tunnels.delete(tunnelId);
    entry.socket.destroy();
    if (notifyPeer) {
      await entry.sendChain.catch(() => undefined);
      await entry.owner
        .emitBinary(encodeTunnelStreamFrame({ opcode: TunnelStreamOpcode.Reset, tunnelId }))
        .catch(() => undefined);
    }
    await entry.owner.release().catch(() => undefined);
  }
}
