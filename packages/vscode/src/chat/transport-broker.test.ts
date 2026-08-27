import {
  encodeTerminalStreamFrame,
  TerminalStreamOpcode,
} from "@getpaseo/protocol/binary-frames/index";
import type { ServerInfoStatusPayload } from "@getpaseo/protocol/messages";
import { describe, expect, it } from "vitest";
import type {
  ConnectionState,
  DaemonTransportFrame,
} from "@getpaseo/client/internal/daemon-client";
import type { DaemonTransportBridgeEvent } from "@getpaseo/client/internal/daemon-transport-bridge";
import {
  type WorkspaceTransportConnection,
  WorkspaceTransportBroker,
  type WorkspaceTransportSink,
} from "./transport-broker";

const serverInfo: ServerInfoStatusPayload = {
  status: "server_info",
  serverId: "srv_test",
  hostname: "test-host",
  version: "0.3.1",
};

class TestConnection implements WorkspaceTransportConnection {
  connectionState: ConnectionState = { status: "connected" };
  sent: DaemonTransportFrame[] = [];
  sendError: Error | null = null;
  private readonly statusHandlers = new Set<(state: ConnectionState) => void>();
  private readonly frameHandlers = new Set<(frame: DaemonTransportFrame) => void>();

  onDidChangeStatus = (handler: (state: ConnectionState) => void) => {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  };

  onDidReceiveTransportFrame = (handler: (frame: DaemonTransportFrame) => void) => {
    this.frameHandlers.add(handler);
    return () => this.frameHandlers.delete(handler);
  };

  async getSharedTransportServerInfo(): Promise<ServerInfoStatusPayload> {
    return serverInfo;
  }

  async sendSharedTransportFrame(frame: DaemonTransportFrame): Promise<void> {
    if (this.sendError) {
      throw this.sendError;
    }
    this.sent.push(frame);
  }

  receive(frame: DaemonTransportFrame): void {
    for (const handler of this.frameHandlers) handler(frame);
  }

  setStatus(state: ConnectionState): void {
    this.connectionState = state;
    for (const handler of this.statusHandlers) handler(state);
  }
}

class TestSink implements WorkspaceTransportSink {
  events: DaemonTransportBridgeEvent[] = [];

  postMessage(message: DaemonTransportBridgeEvent): PromiseLike<boolean> {
    this.events.push(message);
    return Promise.resolve(true);
  }
}

describe("WorkspaceTransportBroker", () => {
  it("multiplexes virtual clients without forwarding hello or ping", async () => {
    const connection = new TestConnection();
    const sinkA = new TestSink();
    const sinkB = new TestSink();
    const logs: string[] = [];
    const broker = new WorkspaceTransportBroker(connection, (message) => logs.push(message));

    await openPort(broker, sinkA, "a");
    await openPort(broker, sinkB, "b");
    await sendText(broker, sinkA, "a", { type: "hello", clientId: "one" });
    await sendText(broker, sinkB, "b", { type: "hello", clientId: "two" });
    await sendText(broker, sinkA, "a", { type: "ping" });
    await sendText(broker, sinkA, "a", {
      type: "session",
      message: { type: "abort_request" },
    });

    expect(connection.sent).toEqual([
      JSON.stringify({ type: "session", message: { type: "abort_request" } }),
    ]);
    expect(sinkA.events.filter((event) => event.event === "message")).toHaveLength(2);
    expect(sinkB.events.filter((event) => event.event === "message")).toHaveLength(1);
    expect(logs.at(-1)).toBe("[vscode-transport] physicalConnections=1 virtualPorts=2");

    connection.receive(JSON.stringify({ type: "session", message: { type: "agent_update" } }));
    expect(sinkA.events.filter((event) => event.event === "message")).toHaveLength(3);
    expect(sinkB.events.filter((event) => event.event === "message")).toHaveLength(2);

    broker.dispose();
  });

  it("does not fan native terminal binary traffic out to chat webviews", async () => {
    const connection = new TestConnection();
    const sink = new TestSink();
    const broker = new WorkspaceTransportBroker(connection, () => {});
    await openPort(broker, sink, "a");
    await sendText(broker, sink, "a", { type: "hello", clientId: "one" });
    sink.events.length = 0;

    connection.receive(
      encodeTerminalStreamFrame({
        opcode: TerminalStreamOpcode.Output,
        slot: 1,
        payload: "large terminal output",
      }),
    );

    expect(sink.events).toEqual([]);
    broker.dispose();
  });

  it("closes all virtual ports when the physical connection drops", async () => {
    const connection = new TestConnection();
    const sink = new TestSink();
    const broker = new WorkspaceTransportBroker(connection, () => {});
    await openPort(broker, sink, "a");

    connection.setStatus({ status: "disconnected", reason: "network lost" });

    expect(sink.events.at(-1)).toEqual({
      type: "daemonTransportEvent",
      event: "close",
      portId: "a",
      reason: "network lost",
    });
    broker.dispose();
  });

  it("closes only the failed virtual port when forwarding fails", async () => {
    const connection = new TestConnection();
    const sink = new TestSink();
    const broker = new WorkspaceTransportBroker(connection, () => {});
    await openPort(broker, sink, "a");
    await sendText(broker, sink, "a", { type: "hello", clientId: "one" });
    connection.sendError = new Error("relay unavailable");

    await sendText(broker, sink, "a", {
      type: "session",
      message: { type: "abort_request" },
    });

    expect(sink.events.slice(-2)).toEqual([
      {
        type: "daemonTransportEvent",
        event: "error",
        portId: "a",
        message: "relay unavailable",
      },
      {
        type: "daemonTransportEvent",
        event: "close",
        portId: "a",
        reason: "relay unavailable",
      },
    ]);
    broker.dispose();
  });
});

async function openPort(
  broker: WorkspaceTransportBroker,
  sink: WorkspaceTransportSink,
  portId: string,
): Promise<void> {
  await broker.handleMessage(sink, {
    type: "daemonTransportRequest",
    action: "open",
    portId,
  });
}

async function sendText(
  broker: WorkspaceTransportBroker,
  sink: WorkspaceTransportSink,
  portId: string,
  value: unknown,
): Promise<void> {
  await broker.handleMessage(sink, {
    type: "daemonTransportRequest",
    action: "send",
    portId,
    frame: { kind: "text", value: JSON.stringify(value) },
  });
}
