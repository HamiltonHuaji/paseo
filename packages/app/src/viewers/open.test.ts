import { describe, expect, it } from "vitest";
import type {
  ViewerConnection,
  ViewerProxyInput,
} from "@getpaseo/client/internal/viewer-http-proxy";
import { openViewer, type ViewerOpenPorts, type ViewerOpenTarget } from "./open";

const path = "/view/v2/remote%3Agithub.com%2FOrg%2FRepo/card_123/files/a%20b.html?run=a%2Fb#L12";
const direct: ViewerConnection = {
  type: "directTcp",
  endpoint: "remote.example:6767",
  useTls: true,
};
const relay: ViewerConnection = {
  type: "relay",
  relayEndpoint: "relay.example",
  daemonPublicKeyB64: "remote-key",
};

function target(connection: ViewerConnection | null): ViewerOpenTarget {
  return {
    serverId: "RemoteHost",
    connection,
    serverInfo: {
      experimentViewer: { host: "127.0.0.1", port: 19001, scope: "loopback" },
      features: { viewerHttpProxy: true },
    },
    directHttpUrl: "https://remote.example:6767/",
  };
}

function createPorts() {
  const requested: ViewerProxyInput[] = [];
  const opened: string[] = [];
  const ports: ViewerOpenPorts = {
    ensureProxy: async (input) => {
      requested.push(input);
      return { origin: "http://127.0.0.1:23456" };
    },
    openExternalUrl: async (url) => {
      opened.push(url);
    },
  };
  return { ports, requested, opened };
}

describe("opening a viewer", () => {
  it.each([direct, relay])(
    "uses the client's proxy for a remote loopback viewer over $type",
    async (connection) => {
      const { ports, requested, opened } = createPorts();
      await openViewer(target(connection), path, ports);
      expect(requested).toEqual([{ serverId: "RemoteHost", connection }]);
      expect(opened).toEqual([`http://127.0.0.1:23456${path}`]);
    },
  );

  it("still proxies when the remote viewer has a network listener", async () => {
    const { ports, requested, opened } = createPorts();
    const remote = target(direct);
    remote.serverInfo!.experimentViewer = { host: "0.0.0.0", port: 19001, scope: "network" };
    await openViewer(remote, path, ports);
    expect(requested).toHaveLength(1);
    expect(opened).toEqual([`http://127.0.0.1:23456${path}`]);
  });

  it("preserves query and fragment when a browser-only client opens a reachable viewer directly", async () => {
    const { ports, opened } = createPorts();
    ports.ensureProxy = null;
    const remote = target(direct);
    remote.serverInfo!.experimentViewer = { host: "0.0.0.0", port: 19001, scope: "network" };
    await openViewer(remote, path, ports);
    expect(opened).toEqual([`https://remote.example:19001${path}`]);
  });

  it.each([direct, relay])(
    "refuses to open the daemon's loopback as the browser's loopback over $type",
    async (connection) => {
      const { ports, opened } = createPorts();
      ports.ensureProxy = null;
      await expect(openViewer(target(connection), path, ports)).rejects.toThrow(
        "viewer forwarding",
      );
      expect(opened).toEqual([]);
    },
  );

  it("reports proxy failure without falling back to the daemon address", async () => {
    const { ports, opened } = createPorts();
    ports.ensureProxy = async () => {
      throw new Error("Cannot start viewer proxy");
    };
    await expect(openViewer(target(direct), path, ports)).rejects.toThrow(
      "Cannot start viewer proxy",
    );
    expect(opened).toEqual([]);
  });

  it("requires the Host's viewer forwarding capability", async () => {
    const { ports, requested, opened } = createPorts();
    const remote = target(direct);
    remote.serverInfo!.features = {};
    await expect(openViewer(remote, path, ports)).rejects.toThrow("Update the host");
    expect(requested).toEqual([]);
    expect(opened).toEqual([]);
  });
});
