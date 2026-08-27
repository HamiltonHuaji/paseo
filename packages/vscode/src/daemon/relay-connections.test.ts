import { describe, expect, test } from "vitest";
import { parseRelayPairingLink } from "./relay-connections";

function pairingLink(offer: object): string {
  return `https://app.paseo.sh/#offer=${Buffer.from(JSON.stringify(offer)).toString("base64url")}`;
}

describe("relay pairing links", () => {
  test("parses the official offer format", () => {
    const parsed = parseRelayPairingLink(
      pairingLink({
        v: 2,
        serverId: "host-1",
        daemonPublicKeyB64: "public-key",
        relay: { endpoint: "relay.paseo.sh:443", useTls: true },
      }),
      "Training host",
    );
    expect(parsed).toMatchObject({
      serverId: "host-1",
      relayEndpoint: "relay.paseo.sh:443",
      useTls: true,
      daemonPublicKeyB64: "public-key",
      label: "Training host",
    });
  });

  test("infers TLS for a legacy port-443 offer", () => {
    const parsed = parseRelayPairingLink(
      pairingLink({
        v: 2,
        serverId: "host-1",
        daemonPublicKeyB64: "public-key",
        relay: { endpoint: "relay.example.com:443" },
      }),
    );
    expect(parsed.useTls).toBe(true);
  });

  test("rejects ordinary web URLs", () => {
    expect(() => parseRelayPairingLink("https://app.paseo.sh")).toThrow(/#offer=/);
  });
});
