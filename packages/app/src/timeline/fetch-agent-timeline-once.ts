import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

type TimelineClient = Pick<DaemonClient, "fetchAgentTimeline">;
type TimelineRequest = Parameters<TimelineClient["fetchAgentTimeline"]>[1];
type TimelinePage = Awaited<ReturnType<TimelineClient["fetchAgentTimeline"]>>;

export interface TimelineRequestScope {
  scope: object;
  isCurrent(): boolean;
  validateResponse(page: TimelinePage): void;
}

const inFlightByClient = new WeakMap<object, WeakMap<object, Map<string, Promise<TimelinePage>>>>();

export function fetchAgentTimelineOnce(
  client: TimelineClient,
  agentId: string,
  request: TimelineRequest,
  scope: object = client,
): Promise<TimelinePage> {
  let scopes = inFlightByClient.get(client);
  if (!scopes) {
    scopes = new WeakMap();
    inFlightByClient.set(client, scopes);
  }
  let inFlight = scopes.get(scope);
  if (!inFlight) {
    inFlight = new Map();
    scopes.set(scope, inFlight);
  }

  const key = `${agentId}:${JSON.stringify(request)}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const fetch = client.fetchAgentTimeline(agentId, request);
  inFlight.set(key, fetch);
  const clear = () => {
    if (inFlight.get(key) === fetch) inFlight.delete(key);
  };
  void fetch.then(clear, clear);
  return fetch;
}
