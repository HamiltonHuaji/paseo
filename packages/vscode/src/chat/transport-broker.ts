import type {
  ConnectionState,
  DaemonTransportFrame,
} from "@getpaseo/client/internal/daemon-client";
import {
  decodeDaemonTransportFrame,
  encodeDaemonTransportFrame,
  type DaemonTransportBridgeEvent,
  parseDaemonTransportBridgeRequest,
} from "@getpaseo/client/internal/daemon-transport-bridge";
import { asUint8Array, decodeBinaryFrame } from "@getpaseo/protocol/binary-frames/index";
import type { ServerInfoStatusPayload } from "@getpaseo/protocol/messages";

export interface WorkspaceTransportConnection {
  readonly connectionState: ConnectionState;
  readonly onDidChangeStatus: (handler: (state: ConnectionState) => void) => DisposableLike;
  readonly onDidReceiveTransportFrame: (
    handler: (frame: DaemonTransportFrame) => void,
  ) => DisposableLike;
  getSharedTransportServerInfo(): Promise<ServerInfoStatusPayload>;
  sendSharedTransportFrame(frame: DaemonTransportFrame): Promise<void>;
}

type DisposableLike = (() => void) | { dispose(): unknown };

export interface WorkspaceTransportSink {
  postMessage(message: DaemonTransportBridgeEvent): PromiseLike<boolean>;
}

interface VirtualPort {
  helloReceived: boolean;
  portId: string;
  sink: WorkspaceTransportSink;
}

export class WorkspaceTransportBroker {
  private readonly portsBySink = new Map<WorkspaceTransportSink, Map<string, VirtualPort>>();
  private readonly cleanup: Array<() => void>;

  constructor(
    private readonly connection: WorkspaceTransportConnection,
    private readonly log: (message: string) => void,
  ) {
    this.cleanup = [
      toDispose(connection.onDidReceiveTransportFrame((frame) => this.broadcastFrame(frame))),
      toDispose(
        connection.onDidChangeStatus((state) => {
          if (
            state.status === "idle" ||
            state.status === "disconnected" ||
            state.status === "disposed"
          ) {
            this.closeAllPorts(
              state.status === "disconnected" ? (state.reason ?? "disconnected") : state.status,
            );
          }
          this.logCounts(state);
        }),
      ),
    ];
  }

  async handleMessage(sink: WorkspaceTransportSink, value: unknown): Promise<boolean> {
    const request = parseDaemonTransportBridgeRequest(value);
    if (!request) {
      return false;
    }

    if (request.action === "open") {
      const port: VirtualPort = { sink, portId: request.portId, helloReceived: false };
      const ports = this.portsBySink.get(sink) ?? new Map<string, VirtualPort>();
      ports.set(port.portId, port);
      this.portsBySink.set(sink, ports);
      try {
        await this.connection.getSharedTransportServerInfo();
        if (this.getPort(sink, port.portId) === port) {
          this.post(port, { type: "daemonTransportEvent", event: "open", portId: port.portId });
          this.logCounts(this.connection.connectionState);
        }
      } catch (error) {
        this.failPort(port, error);
      }
      return true;
    }

    const port = this.getPort(sink, request.portId);
    if (!port) {
      return true;
    }
    if (request.action === "close") {
      this.deletePort(port);
      this.logCounts(this.connection.connectionState);
      return true;
    }

    const frame = decodeDaemonTransportFrame(request.frame);
    const controlType = typeof frame === "string" ? parseControlFrameType(frame) : null;
    if (controlType === "hello") {
      try {
        const serverInfo = await this.connection.getSharedTransportServerInfo();
        port.helloReceived = true;
        this.postFrame(port, createServerInfoFrame(serverInfo));
      } catch (error) {
        this.failPort(port, error);
      }
      return true;
    }
    if (controlType === "ping") {
      this.postFrame(port, JSON.stringify({ type: "pong" }));
      return true;
    }
    if (!port.helloReceived) {
      this.failPort(port, "VS Code daemon transport received data before hello");
      return true;
    }
    try {
      await this.connection.sendSharedTransportFrame(frame);
    } catch (error) {
      this.failPort(port, error);
    }
    return true;
  }

  detachSink(sink: WorkspaceTransportSink): void {
    const ports = this.portsBySink.get(sink);
    if (!ports) {
      return;
    }
    this.portsBySink.delete(sink);
    this.logCounts(this.connection.connectionState);
  }

  dispose(): void {
    for (const dispose of this.cleanup.splice(0)) {
      dispose();
    }
    this.closeAllPorts("Workspace transport broker disposed");
  }

  private broadcastFrame(frame: DaemonTransportFrame): void {
    if (isTerminalFrame(frame)) {
      return;
    }
    for (const ports of this.portsBySink.values()) {
      for (const port of ports.values()) {
        if (port.helloReceived) {
          this.postFrame(port, frame);
        }
      }
    }
  }

  private closeAllPorts(reason: string): void {
    const ports: VirtualPort[] = [];
    for (const portsById of this.portsBySink.values()) {
      ports.push(...portsById.values());
    }
    this.portsBySink.clear();
    for (const port of ports) {
      this.post(port, {
        type: "daemonTransportEvent",
        event: "close",
        portId: port.portId,
        reason,
      });
    }
  }

  private postFrame(port: VirtualPort, frame: DaemonTransportFrame): void {
    this.post(port, {
      type: "daemonTransportEvent",
      event: "message",
      portId: port.portId,
      frame: encodeDaemonTransportFrame(frame),
    });
  }

  private post(port: VirtualPort, event: DaemonTransportBridgeEvent): void {
    void Promise.resolve(port.sink.postMessage(event)).catch((error) => {
      this.log(
        `[vscode-transport] Failed to post to virtual port ${port.portId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private getPort(sink: WorkspaceTransportSink, portId: string): VirtualPort | null {
    return this.portsBySink.get(sink)?.get(portId) ?? null;
  }

  private deletePort(port: VirtualPort): void {
    const ports = this.portsBySink.get(port.sink);
    if (!ports || ports.get(port.portId) !== port) {
      return;
    }
    ports.delete(port.portId);
    if (ports.size === 0) {
      this.portsBySink.delete(port.sink);
    }
  }

  private failPort(port: VirtualPort, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.deletePort(port);
    this.post(port, {
      type: "daemonTransportEvent",
      event: "error",
      portId: port.portId,
      message,
    });
    this.post(port, {
      type: "daemonTransportEvent",
      event: "close",
      portId: port.portId,
      reason: message,
    });
    this.logCounts(this.connection.connectionState);
  }

  private logCounts(state: ConnectionState): void {
    let virtualPorts = 0;
    for (const ports of this.portsBySink.values()) {
      virtualPorts += ports.size;
    }
    this.log(
      `[vscode-transport] physicalConnections=${state.status === "connected" ? 1 : 0} virtualPorts=${virtualPorts}`,
    );
  }
}

function toDispose(value: DisposableLike): () => void {
  return typeof value === "function" ? value : () => value.dispose();
}

function parseControlFrameType(frame: string): string | null {
  try {
    const value = JSON.parse(frame) as unknown;
    return typeof value === "object" &&
      value !== null &&
      "type" in value &&
      typeof value.type === "string"
      ? value.type
      : null;
  } catch {
    return null;
  }
}

function createServerInfoFrame(serverInfo: ServerInfoStatusPayload): string {
  return JSON.stringify({
    type: "session",
    message: { type: "status", payload: serverInfo },
  });
}

function isTerminalFrame(frame: DaemonTransportFrame): boolean {
  if (typeof frame === "string") {
    return false;
  }
  const bytes = asUint8Array(frame);
  return bytes ? decodeBinaryFrame(bytes)?.kind === "terminal" : false;
}
