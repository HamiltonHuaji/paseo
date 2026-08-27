import { describe, expect, it } from "vitest";
import type { DaemonTransportBridgeEvent } from "./daemon-transport-bridge";
import {
  createDaemonTransportBridgeFactory,
  decodeDaemonTransportFrame,
  encodeDaemonTransportFrame,
  parseDaemonTransportBridgeEvent,
  parseDaemonTransportBridgeRequest,
} from "./daemon-transport-bridge";

describe("daemon transport bridge frames", () => {
  it("round-trips text and binary frames", () => {
    expect(decodeDaemonTransportFrame(encodeDaemonTransportFrame("hello"))).toBe("hello");
    expect(
      decodeDaemonTransportFrame(encodeDaemonTransportFrame(new Uint8Array([0, 1, 254, 255]))),
    ).toEqual(new Uint8Array([0, 1, 254, 255]));
  });

  it("rejects malformed bridge messages", () => {
    expect(parseDaemonTransportBridgeRequest({ type: "daemonTransportRequest" })).toBeNull();
    expect(parseDaemonTransportBridgeEvent({ type: "daemonTransportEvent" })).toBeNull();
  });
});

describe("createDaemonTransportBridgeFactory", () => {
  it("opens a virtual port and carries frames in both directions", async () => {
    const requests: unknown[] = [];
    const listeners = new Set<(event: DaemonTransportBridgeEvent) => void>();
    const transport = createDaemonTransportBridgeFactory({
      createPortId: () => "port-1",
      post: (request) => requests.push(request),
      subscribe: (handler) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
      },
    })({ url: "vscode://bridge" });
    const opened: string[] = [];
    const messages: unknown[] = [];
    transport.onOpen(() => opened.push("open"));
    transport.onMessage((message) => messages.push(message));

    await Promise.resolve();
    expect(requests).toEqual([
      { type: "daemonTransportRequest", action: "open", portId: "port-1" },
    ]);

    for (const listener of listeners) {
      listener({ type: "daemonTransportEvent", event: "open", portId: "port-1" });
    }
    transport.send("request");
    for (const listener of listeners) {
      listener({
        type: "daemonTransportEvent",
        event: "message",
        portId: "port-1",
        frame: encodeDaemonTransportFrame("response"),
      });
    }

    expect(opened).toEqual(["open"]);
    expect(messages).toEqual(["response"]);
    expect(requests.at(-1)).toEqual({
      type: "daemonTransportRequest",
      action: "send",
      portId: "port-1",
      frame: { kind: "text", value: "request" },
    });
  });
});
