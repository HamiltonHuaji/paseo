import { parseConnectionOfferFromUrl } from "@getpaseo/protocol/connection-offer";
import {
  normalizeHostPort,
  shouldUseTlsForDefaultHostedRelay,
} from "@getpaseo/protocol/daemon-endpoints";
import type * as vscode from "vscode";

const RELAY_CONNECTIONS_KEY = "paseo.vscode.relayConnections.v1";

export interface SavedRelayConnection {
  serverId: string;
  relayEndpoint: string;
  useTls: boolean;
  daemonPublicKeyB64: string;
  label: string;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSavedRelayConnection(value: unknown): SavedRelayConnection | null {
  if (!isRecord(value)) {
    return null;
  }
  const serverId = typeof value.serverId === "string" ? value.serverId.trim() : "";
  const relayEndpoint = typeof value.relayEndpoint === "string" ? value.relayEndpoint.trim() : "";
  const daemonPublicKeyB64 =
    typeof value.daemonPublicKeyB64 === "string" ? value.daemonPublicKeyB64.trim() : "";
  if (!serverId || !relayEndpoint || !daemonPublicKeyB64 || typeof value.useTls !== "boolean") {
    return null;
  }
  try {
    return {
      serverId,
      relayEndpoint: normalizeHostPort(relayEndpoint),
      useTls: value.useTls,
      daemonPublicKeyB64,
      label: typeof value.label === "string" && value.label.trim() ? value.label.trim() : serverId,
      updatedAt:
        typeof value.updatedAt === "string" && value.updatedAt
          ? value.updatedAt
          : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function parseRelayPairingLink(pairingLink: string, label?: string): SavedRelayConnection {
  const offer = parseConnectionOfferFromUrl(pairingLink);
  if (!offer) {
    throw new Error("Pairing link must contain a #offer= fragment.");
  }
  const relayEndpoint = normalizeHostPort(offer.relay.endpoint);
  return {
    serverId: offer.serverId,
    relayEndpoint,
    useTls: offer.relay.useTls ?? shouldUseTlsForDefaultHostedRelay(offer.relay.endpoint),
    daemonPublicKeyB64: offer.daemonPublicKeyB64,
    label: label?.trim() || offer.serverId,
    updatedAt: new Date().toISOString(),
  };
}

export function getSavedRelayConnections(context: vscode.ExtensionContext): SavedRelayConnection[] {
  const raw = context.globalState.get<unknown>(RELAY_CONNECTIONS_KEY);
  if (!Array.isArray(raw)) {
    return [];
  }
  const byServerId = new Map<string, SavedRelayConnection>();
  for (const value of raw) {
    const connection = parseSavedRelayConnection(value);
    if (connection) {
      byServerId.set(connection.serverId, connection);
    }
  }
  return [...byServerId.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export async function saveRelayConnection(
  context: vscode.ExtensionContext,
  connection: SavedRelayConnection,
): Promise<void> {
  const next = getSavedRelayConnections(context).filter(
    (candidate) => candidate.serverId !== connection.serverId,
  );
  next.push(connection);
  await context.globalState.update(RELAY_CONNECTIONS_KEY, next);
}

export async function updateRelayConnectionLabel(
  context: vscode.ExtensionContext,
  serverId: string,
  label: string,
): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) {
    return;
  }
  const connections = getSavedRelayConnections(context);
  const index = connections.findIndex((connection) => connection.serverId === serverId);
  const existing = connections[index];
  if (!existing || existing.label === trimmed || existing.label !== existing.serverId) {
    return;
  }
  connections[index] = { ...existing, label: trimmed, updatedAt: new Date().toISOString() };
  await context.globalState.update(RELAY_CONNECTIONS_KEY, connections);
}
