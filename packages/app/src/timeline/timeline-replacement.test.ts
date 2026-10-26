import { afterEach, expect, test, vi } from "vitest";
import {
  createTimelineReplica,
  createViewedTimelineOwner,
  type TimelineResponsePayload,
  type ViewedTimelineOwner,
} from "./viewed-timeline-sync";
import { selectAgentTimelineState, useSessionStore } from "@/stores/session-store";
import { fetchAgentTimelineOnce } from "./fetch-agent-timeline-once";
import {
  planTimelineTailFetch,
  type ProjectedTimelineForwardFetchPlan,
} from "./timeline-sync-plan";

const serverId = "replacement-tests";
const agentId = "agent";
function page(epoch: string, endSeq = 2): TimelineResponsePayload {
  return {
    requestId: epoch,
    agentId,
    agent: null,
    direction: "tail",
    projection: "projected",
    epoch,
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 1, maxSeq: endSeq, nextSeq: endSeq + 1 },
    startCursor: { epoch, seq: 1 },
    endCursor: { epoch, seq: endSeq },
    hasOlder: false,
    hasNewer: false,
    error: null,
    entries: [
      {
        provider: "codex",
        item: { type: "assistant_message", messageId: epoch, text: epoch },
        timestamp: "2026-10-26T00:00:00.000Z",
        seqStart: 1,
        seqEnd: endSeq,
        sourceSeqRanges: [{ startSeq: 1, endSeq }],
        collapsed: [],
      },
    ],
  };
}
function world() {
  useSessionStore.getState().initializeSession(serverId, null);
  const persisted: Array<{ epoch: string | undefined; end: number | undefined }> = [];
  const retries: Array<() => void> = [];
  const requests: Array<{
    request: ProjectedTimelineForwardFetchPlan;
    resolve: (value: TimelineResponsePayload) => void;
    reject: (error: Error) => void;
  }> = [];
  const transport = {
    fetchAgentTimeline: vi.fn(
      (_agent: string, request: Parameters<typeof fetchAgentTimelineOnce>[2]) =>
        new Promise<TimelineResponsePayload>((resolve, reject) =>
          requests.push({ request: request as ProjectedTimelineForwardFetchPlan, resolve, reject }),
        ),
    ),
  };
  let owner: ViewedTimelineOwner;
  const readCursor = () => {
    const state = selectAgentTimelineState(useSessionStore.getState().sessions[serverId], agentId);
    return state.status === "synced" && state.range
      ? { epoch: state.range.epoch, endSeq: state.range.endSeq }
      : undefined;
  };
  const fetch = async (
    id: string,
    request: Parameters<typeof fetchAgentTimelineOnce>[2],
    isCurrent = () => true,
  ) => {
    const guard = owner.captureRequest(id, isCurrent);
    const response = await fetchAgentTimelineOnce(transport, id, request, guard.scope);
    if (guard.isCurrent()) {
      guard.validateResponse(response);
      owner.flushStreamAgent(id);
      if (guard.isCurrent()) owner.applyTimelineResponse(response);
    }
    return response;
  };
  owner = createViewedTimelineOwner({
    serverId,
    replica: createTimelineReplica({
      serverId,
      prepareAgent: async () => {},
      storage: {
        readTimeline: async () => undefined,
        commitTimeline: (_host, _agent, timeline) =>
          persisted.push({ epoch: timeline.range?.epoch, end: timeline.range?.endSeq }),
      },
    }),
    replaceDemandedAgentIds: () => {},
    drainQueuedAgentMessage: () => {},
    ports: {
      observe: () => ({ ready: Promise.resolve(), release: async () => {} }),
      readCursor,
      fetchPage: fetch,
      fetchLatestTail: (id, isCurrent) => fetch(id, planTimelineTailFetch(), isCurrent),
      reportError: () => {},
      schedule: (task) => {
        retries.push(task);
        return () => {
          const i = retries.indexOf(task);
          if (i >= 0) retries.splice(i, 1);
        };
      },
    },
  });
  const open = async () => {
    owner.replaceVisibleAgentIds("pane", [agentId]);
    owner.setConnected(true);
    await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
  };
  return { owner, requests, retries, persisted, fetch, readCursor, open };
}
afterEach(() => useSessionStore.getState().clearSession(serverId));

test.each(["tail", "before", "after"] as const)(
  "replacement fences a late %s response before installing or persisting it",
  async (direction) => {
    const w = world();
    try {
      await w.open();
      w.requests[0].resolve(page("old"));
      await vi.waitFor(() => expect(w.owner.getAgentTimelineStatus(agentId)).toBe("ready"));
      const oldRead = w.fetch(agentId, {
        direction,
        projection: "projected",
        limit: 40,
        cursor: { epoch: "old", seq: 2 },
      });
      w.owner.replaceTimeline(agentId, "new");
      expect(w.owner.getAgentTimelineStatus(agentId)).toBe("pending");
      expect(
        useSessionStore.getState().sessions[serverId].agentHistorySyncGeneration.has(agentId),
      ).toBe(false);
      expect(w.requests).toHaveLength(3);
      w.requests[2].resolve(page("new"));
      await vi.waitFor(() => expect(w.owner.getAgentTimelineStatus(agentId)).toBe("ready"));
      const saved = w.persisted.length;
      w.requests[1].resolve({ ...page("old"), direction });
      await oldRead;
      expect(w.readCursor()?.epoch).toBe("new");
      expect(w.persisted).toHaveLength(saved);
    } finally {
      w.owner.dispose();
    }
  },
);

test("replacement starts a fresh bounded tail and retries it after a failed first read", async () => {
  const w = world();
  try {
    await w.open();
    w.owner.replaceTimeline(agentId, "new");
    expect(w.requests).toHaveLength(2);
    expect(w.requests[1].request).toEqual(planTimelineTailFetch());
    w.requests[1].reject(new Error("temporarily offline"));
    await vi.waitFor(() => expect(w.owner.getAgentTimelineStatus(agentId)).toBe("error"));
    w.retries.shift()?.();
    expect(w.requests).toHaveLength(3);
    expect(w.requests[2].request).toEqual(planTimelineTailFetch());
    w.requests[2].resolve(page("new"));
    await vi.waitFor(() => expect(w.owner.getAgentTimelineStatus(agentId)).toBe("ready"));
    w.requests[0].resolve(page("old"));
    await Promise.resolve();
    await Promise.resolve();
    expect(w.readCursor()?.epoch).toBe("new");
    expect(w.persisted.every((entry) => entry.epoch === "new")).toBe(true);
  } finally {
    w.owner.dispose();
  }
});

test("a delayed tail cannot roll back same-epoch live coverage, even with reset", async () => {
  const w = world();
  try {
    w.owner.applyTimelineResponse(page("stable"));
    w.owner.enqueueStreamEvent(agentId, {
      event: {
        type: "timeline",
        provider: "codex",
        item: { type: "assistant_message", messageId: "live", text: "live" },
      },
      epoch: "stable",
      seq: 3,
      timestamp: new Date(),
    });
    w.owner.flushStreamAgent(agentId);
    w.owner.applyTimelineResponse({ ...page("stable"), reset: true });
    expect(w.readCursor()?.endSeq).toBe(3);
    expect(w.persisted.at(-1)?.end).toBe(3);
  } finally {
    w.owner.dispose();
  }
});

test("an unknown large epoch sequence refreshes and catches up events newer than the snapshot", async () => {
  const w = world();
  const first = 281474976710657;
  try {
    await w.open();
    w.requests[0].resolve(page("old"));
    await vi.waitFor(() => expect(w.owner.getAgentTimelineStatus(agentId)).toBe("ready"));
    const event = (epoch: string, seq: number) => ({
      event: {
        type: "timeline" as const,
        provider: "codex" as const,
        item: { type: "assistant_message" as const, messageId: String(seq), text: "live" },
      },
      epoch,
      seq,
      timestamp: new Date(),
    });
    w.owner.enqueueStreamEvent(agentId, event("new", first));
    expect(w.requests).toHaveLength(2);
    w.owner.enqueueStreamEvent(agentId, event("new", first + 1));
    w.requests[1].resolve(page("new", first));
    await vi.waitFor(() => expect(w.requests).toHaveLength(3));
    expect(w.owner.getAgentTimelineStatus(agentId)).toBe("pending");
    expect(w.requests[2].request).toMatchObject({
      direction: "after",
      limit: 40,
      cursor: { epoch: "new", seq: first },
    });
    w.requests[2].resolve(page("new", first + 1));
    await vi.waitFor(() => expect(w.owner.getAgentTimelineStatus(agentId)).toBe("ready"));
    expect(w.readCursor()?.endSeq).toBe(first + 1);
    w.owner.enqueueStreamEvent(agentId, event("old", 4));
    w.owner.flushStreamAgent(agentId);
    expect(w.requests).toHaveLength(3);
    expect(w.readCursor()?.epoch).toBe("new");
  } finally {
    w.owner.dispose();
  }
});

test.each(["foreground", "reconnect"])(
  "%s invalidates the in-flight request before creating another",
  async (reason) => {
    const w = world();
    try {
      await w.open();
      if (reason === "foreground") {
        w.owner.setActive(false);
        w.owner.setActive(true);
      } else {
        w.owner.setConnected(false);
        w.owner.setConnected(true);
      }
      await vi.waitFor(() => expect(w.requests).toHaveLength(2));
      w.requests[1].resolve(page("new"));
      await vi.waitFor(() => expect(w.owner.getAgentTimelineStatus(agentId)).toBe("ready"));
      w.requests[0].resolve(page("old"));
      await Promise.resolve();
      await Promise.resolve();
      expect(w.readCursor()?.epoch).toBe("new");
    } finally {
      w.owner.dispose();
    }
  },
);

test("a rewind receipt without an epoch still refreshes through the owner", async () => {
  const w = world();
  try {
    await w.open();
    w.requests[0].resolve(page("old"));
    await vi.waitFor(() => expect(w.owner.getAgentTimelineStatus(agentId)).toBe("ready"));
    w.owner.replaceTimeline(agentId);
    w.requests[1].resolve(page("new"));
    await vi.waitFor(() => expect(w.owner.getAgentTimelineStatus(agentId)).toBe("ready"));
    expect(w.readCursor()?.epoch).toBe("new");
  } finally {
    w.owner.dispose();
  }
});

test("concurrent reads cannot install an unfamiliar older epoch after another snapshot", async () => {
  const w = world();
  try {
    const old = w.fetch(agentId, planTimelineTailFetch());
    const next = w.fetch(agentId, { direction: "tail", projection: "projected", limit: 20 });
    w.requests[1].resolve(page("new"));
    await next;
    const saved = w.persisted.length;
    w.requests[0].resolve(page("unknown-old"));
    await expect(old).rejects.toThrow("epoch changed");
    expect(w.persisted).toHaveLength(saved);
    expect(w.readCursor()?.epoch).toBe("new");
  } finally {
    w.owner.dispose();
  }
});

test("a fresh snapshot may already be newer than its replacement notification", async () => {
  const w = world();
  try {
    await w.open();
    w.requests[0].resolve(page("old"));
    await vi.waitFor(() => expect(w.owner.getAgentTimelineStatus(agentId)).toBe("ready"));
    w.owner.replaceTimeline(agentId, "intermediate");
    w.requests[1].resolve(page("latest"));
    await vi.waitFor(() => expect(w.owner.getAgentTimelineStatus(agentId)).toBe("ready"));
    expect(w.readCursor()?.epoch).toBe("latest");
    w.owner.replaceTimeline(agentId, "intermediate");
    expect(w.requests).toHaveLength(2);
  } finally {
    w.owner.dispose();
  }
});
