import { Buffer } from "buffer";
import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import type { HostProfile } from "@/types/host-connection";

export function daemonPairingOfferQueryKey(serverId: string) {
  return ["daemon-pairing-offer", serverId] as const;
}

export function savedDaemonPairingOffer(host: HostProfile | undefined) {
  const relay =
    host?.connections.find(
      (connection) => connection.type === "relay" && connection.id === host.preferredConnectionId,
    ) ?? host?.connections.find((connection) => connection.type === "relay");
  if (!host || !relay || relay.type !== "relay") return undefined;
  const offer: ConnectionOffer = {
    v: 2,
    serverId: host.serverId,
    daemonPublicKeyB64: relay.daemonPublicKeyB64,
    relay: { endpoint: relay.relayEndpoint, useTls: relay.useTls },
  };
  const encoded = Buffer.from(JSON.stringify(offer), "utf8").toString("base64url");
  return { relayEnabled: true, url: `https://app.paseo.sh/#offer=${encoded}` };
}
