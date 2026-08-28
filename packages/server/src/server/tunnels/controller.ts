import net from "node:net";
import { randomUUID } from "node:crypto";
import {
  encodeTunnelStreamFrame,
  TunnelStreamOpcode,
  type TunnelStreamFrame,
} from "@getpaseo/protocol/binary-frames/index";
import type { TunnelTarget } from "@getpaseo/protocol/tunnels";
import type { ServiceProxySubsystem } from "../service-proxy.js";

interface TunnelEntry {
  socket: net.Socket;
  source: object;
  sendChain: Promise<void>;
}

export class TunnelController {
  private readonly tunnels = new Map<string, TunnelEntry>();

  constructor(
    private readonly serviceProxy: ServiceProxySubsystem | null,
    private readonly emitBinary: (source: object, frame: Uint8Array) => Promise<void>,
  ) {}

  async open(target: TunnelTarget, source: object): Promise<string> {
    const endpoint = this.resolveTarget(target);
    const tunnelId = randomUUID();
    const socket = net.createConnection(endpoint);
    socket.setNoDelay(true);
    socket.pause();
    const entry: TunnelEntry = { socket, source, sendChain: Promise.resolve() };
    this.tunnels.set(tunnelId, entry);

    socket.on("data", (chunk: Buffer) => {
      socket.pause();
      entry.sendChain = entry.sendChain
        .then(() =>
          this.emitBinary(
            source,
            encodeTunnelStreamFrame({
              opcode: TunnelStreamOpcode.Data,
              tunnelId,
              payload: chunk,
            }),
          ),
        )
        .then(
          () => {
            socket.resume();
            return undefined;
          },
          () => {
            socket.destroy();
            return undefined;
          },
        );
    });
    socket.on("end", () => {
      void this.emitEnd(tunnelId, entry);
    });
    socket.on("close", () => {
      if (this.tunnels.get(tunnelId) === entry) this.tunnels.delete(tunnelId);
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
      socket.on("error", () => {
        void this.emitEnd(tunnelId, entry);
      });
      return tunnelId;
    } catch (error) {
      this.tunnels.delete(tunnelId);
      socket.destroy();
      throw error;
    }
  }

  activate(tunnelId: string, source: object): void {
    const entry = this.tunnels.get(tunnelId);
    if (entry?.source === source) entry.socket.resume();
  }

  handleFrame(frame: TunnelStreamFrame, source: object): void {
    const entry = this.tunnels.get(frame.tunnelId);
    if (!entry || entry.source !== source) return;
    if (frame.opcode === TunnelStreamOpcode.Data) {
      if (!entry.socket.write(frame.payload)) {
        void this.emitBinary(
          source,
          encodeTunnelStreamFrame({ opcode: TunnelStreamOpcode.Pause, tunnelId: frame.tunnelId }),
        );
        entry.socket.once("drain", () => {
          void this.emitBinary(
            source,
            encodeTunnelStreamFrame({
              opcode: TunnelStreamOpcode.Resume,
              tunnelId: frame.tunnelId,
            }),
          );
        });
      }
      return;
    }
    if (frame.opcode === TunnelStreamOpcode.Pause) {
      entry.socket.pause();
      return;
    }
    if (frame.opcode === TunnelStreamOpcode.Resume) {
      entry.socket.resume();
      return;
    }
    entry.socket.end();
  }

  closeSource(source: object): void {
    for (const [tunnelId, entry] of this.tunnels) {
      if (entry.source !== source) continue;
      this.tunnels.delete(tunnelId);
      entry.socket.destroy();
    }
  }

  dispose(): void {
    for (const entry of this.tunnels.values()) entry.socket.destroy();
    this.tunnels.clear();
  }

  private resolveTarget(target: TunnelTarget): { host: string; port: number } {
    if (target.type === "tcp") return { host: target.host, port: target.port };
    const route = this.serviceProxy?.resolveInternalService(target.name);
    if (!route) throw new Error(`Tunnel service is unavailable: ${target.name}`);
    return { host: "127.0.0.1", port: route.port };
  }

  private async emitEnd(tunnelId: string, entry: TunnelEntry): Promise<void> {
    if (this.tunnels.get(tunnelId) !== entry) return;
    this.tunnels.delete(tunnelId);
    await entry.sendChain.catch(() => undefined);
    await this.emitBinary(
      entry.source,
      encodeTunnelStreamFrame({ opcode: TunnelStreamOpcode.End, tunnelId }),
    ).catch(() => undefined);
  }
}
