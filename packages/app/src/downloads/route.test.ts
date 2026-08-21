import { describe, expect, it } from "vitest";
import { defaultHostAppearance } from "@/hosts/appearance";
import type { HostProfile } from "@/types/host-connection";
import { resolveActiveDirectDownloadConnection } from "./route";

const host: HostProfile = {
  serverId: "server-1",
  label: "Workstation",
  appearance: defaultHostAppearance(),
  lifecycle: {},
  connections: [
    {
      id: "direct:lan:6767",
      type: "directTcp",
      endpoint: "lan:6767",
      useTls: false,
    },
    {
      id: "relay:relay.paseo.sh:443",
      type: "relay",
      relayEndpoint: "relay.paseo.sh:443",
      useTls: true,
      daemonPublicKeyB64: "public-key",
    },
  ],
  preferredConnectionId: "direct:lan:6767",
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};

describe("resolveActiveDirectDownloadConnection", () => {
  it("uses the active direct TCP connection for the HTTP fast path", () => {
    expect(
      resolveActiveDirectDownloadConnection({
        host,
        activeConnectionId: "direct:lan:6767",
      }),
    ).toEqual(host.connections[0]);
  });

  it("does not use a saved direct endpoint while relay is active", () => {
    expect(
      resolveActiveDirectDownloadConnection({
        host,
        activeConnectionId: "relay:relay.paseo.sh:443",
      }),
    ).toBeNull();
  });

  it("does not guess a direct endpoint before the runtime selects a connection", () => {
    expect(resolveActiveDirectDownloadConnection({ host, activeConnectionId: null })).toBeNull();
  });
});
