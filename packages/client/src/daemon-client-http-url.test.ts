import { describe, expect, test } from "vitest";
import { DaemonClient } from "./daemon-client.js";

describe("DaemonClient.resolveDirectHttpUrl", () => {
  test("maps direct WebSocket endpoints to daemon HTTP paths", () => {
    const plain = new DaemonClient({ url: "ws://127.0.0.1:6768/ws", clientId: "plain" });
    const tls = new DaemonClient({ url: "wss://host.example/ws", clientId: "tls" });

    expect(plain.resolveDirectHttpUrl("/view/prj/exp/report/index.html")).toBe(
      "http://127.0.0.1:6768/view/prj/exp/report/index.html",
    );
    expect(tls.resolveDirectHttpUrl("view/prj/exp/report/index.html")).toBe(
      "https://host.example/view/prj/exp/report/index.html",
    );
  });

  test("does not invent an HTTP path for relay or bridge transports", () => {
    const relay = new DaemonClient({
      url: "wss://relay.example/ws?role=client&serverId=srv_test&v=2",
      clientId: "relay",
    });
    const bridge = new DaemonClient({ url: "vscode://bridge", clientId: "bridge" });

    expect(relay.resolveDirectHttpUrl("/view/example")).toBeNull();
    expect(bridge.resolveDirectHttpUrl("/view/example")).toBeNull();
  });
});
