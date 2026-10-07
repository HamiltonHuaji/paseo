import { z } from "zod";

export const ViewerConnectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("relay"),
    relayEndpoint: z.string().min(1),
    useTls: z.boolean().optional(),
    daemonPublicKeyB64: z.string().min(1),
  }),
  z.object({
    type: z.literal("directTcp"),
    endpoint: z.string().min(1),
    useTls: z.boolean().optional(),
    password: z.string().optional(),
  }),
]);

export type ViewerConnection = z.infer<typeof ViewerConnectionSchema>;

export const ViewerProxyStateSchema = z.record(
  z.string(),
  z.object({ port: z.number().int().min(1024).max(65535), enabled: z.boolean() }),
);
export type ViewerProxyState = z.infer<typeof ViewerProxyStateSchema>;

export interface ViewerProxyInput {
  serverId: string;
  connection: ViewerConnection;
}

export interface ViewerHttpRequest {
  method: "GET" | "HEAD";
  path: string;
  headers: Record<string, string>;
  signal: AbortSignal;
}

export const VIEWER_REQUEST_HEADERS = [
  "accept",
  "cache-control",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "range",
] as const;

// Remembered assignments win over the hash, including previous conflict fallbacks.
// Reserve inactive Hosts' ports too so opening order does not reshuffle origins.
export function viewerPortCandidates(input: {
  serverId: string;
  state: ViewerProxyState;
}): number[] {
  const candidates: number[] = [];
  const remembered = input.state[input.serverId];
  if (remembered) candidates.push(remembered.port);
  const reserved = new Set(
    Object.entries(input.state)
      .filter(([serverId]) => serverId !== input.serverId)
      .map(([, assignment]) => assignment.port),
  );
  let hash = 2166136261;
  for (const character of input.serverId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  // This range avoids browser-blocked service ports. Bound conflict work to 64 attempts.
  for (let offset = 0; offset < 64; offset += 1) {
    const port = 20000 + ((hash + offset) % 10000);
    if (!reserved.has(port) && !candidates.includes(port)) candidates.push(port);
  }
  candidates.push(0);
  return candidates;
}
