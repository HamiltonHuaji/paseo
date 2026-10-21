import type { Agent } from "@/stores/session-store";
import type { BoardNode, BoardPlacement } from "@/components/board-canvas/layout";

export type SessionTime = "created" | "forked" | "reply" | "input";
export type SessionOrder = "oldest" | "newest";
export type CanvasSession = Pick<
  Agent,
  | "id"
  | "title"
  | "provider"
  | "status"
  | "createdAt"
  | "lastUserMessageAt"
  | "lastAssistantMessageAt"
  | "forkedFrom"
  | "workspaceId"
  | "archivedAt"
>;
export const SESSION_CARD_SIZE = { width: 16, height: 9 };

export function sessionTime(session: CanvasSession, time: SessionTime): number | null {
  switch (time) {
    case "created":
      return session.createdAt.getTime();
    case "forked":
      return session.forkedFrom ? Date.parse(session.forkedFrom.forkedAt) : null;
    case "reply":
      return session.lastAssistantMessageAt?.getTime() ?? null;
    case "input":
      return session.lastUserMessageAt?.getTime() ?? null;
  }
}

export function sessionNodes(sessions: CanvasSession[], untitled: string): BoardNode[] {
  return sessions.map((session) => ({
    id: session.id,
    title: session.title || untitled,
    goal: null,
    basedOn: session.forkedFrom?.agentId ?? null,
    createdAt: session.createdAt.toISOString(),
  }));
}

// Time is ordinal, not proportional: a week without a message adds no empty canvas.
// Every next card is lower, including across branches. Never wrap into rows.
export function arrangeSessions(
  sessions: CanvasSession[],
  time: SessionTime,
  order: SessionOrder,
): BoardPlacement[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const lanes = new Map<string, number>();
  const laneFor = (id: string, visiting = new Set<string>()): number => {
    const known = lanes.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parentId = byId.get(id)?.forkedFrom?.agentId;
    const lane = parentId && byId.has(parentId) ? laneFor(parentId, visiting) + 1 : 0;
    lanes.set(id, lane);
    return lane;
  };
  const sorted = [...sessions].sort((a, b) => {
    const left = sessionTime(a, time);
    const right = sessionTime(b, time);
    // Sessions with no such event belong at the end in either direction.
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    const delta = left !== null && right !== null ? left - right : 0;
    return (
      (order === "oldest" ? delta : -delta) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id)
    );
  });
  return sorted.map((session, index) => ({
    id: session.id,
    column: 1 + laneFor(session.id) * (SESSION_CARD_SIZE.width + 1),
    row: 1 + index * (SESSION_CARD_SIZE.height + 0.5),
    width: SESSION_CARD_SIZE.width,
    height: SESSION_CARD_SIZE.height,
  }));
}
