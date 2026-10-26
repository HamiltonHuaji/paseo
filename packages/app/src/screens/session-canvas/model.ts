import type { Agent } from "@/stores/session-store";
import type { AgentSessionLineage } from "@getpaseo/protocol/messages";
import type { BoardNode, BoardPlacement } from "@/components/board-canvas/layout";

export type SessionTime = "created" | "forked" | "reply" | "input";
export type SessionArrangement = "relationships" | SessionTime;
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
  | "sessionLineage"
  | "workspaceId"
  | "archivedAt"
>;
export const SESSION_CARD_SIZE = { width: 16, height: 9 };

export function sessionTime(session: CanvasSession, time: SessionTime): number | null {
  switch (time) {
    case "created":
      return session.createdAt.getTime();
    case "forked":
      const origin = session.sessionLineage?.find((entry) => entry.operation !== "rewind");
      if (origin) return Date.parse(origin.createdAt);
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
  time: SessionArrangement,
  order: SessionOrder,
): BoardPlacement[] {
  if (time === "relationships") return arrangeSessionFamilies(sessions, order);
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

/** Qualify relationships before feeding the existing layout and edge renderer. */
export function sessionsForCanvas(sessions: CanvasSession[], serverId: string): CanvasSession[] {
  return sessions.map((session) => {
    const origin = session.sessionLineage?.find((entry) => entry.operation !== "rewind");
    const reference = sessionSource(origin);
    const source = reference?.hostId === serverId ? reference.agentId : undefined;
    return {
      ...session,
      forkedFrom:
        source && source !== session.id && origin
          ? {
              ...session.forkedFrom,
              agentId: source,
              sourceHostId: serverId,
              forkedAt: origin.createdAt,
            }
          : undefined,
    };
  });
}

export function sessionSource(origin: AgentSessionLineage | undefined) {
  if (!origin || origin.sourceResolution !== "resolved") return undefined;
  if (origin.resolvedSource) return origin.resolvedSource;
  // COMPAT(resolvedSessionSource): added in fork v0.13.4, remove after 2027-04-26
  // once hosts provide the separate addressable source reference.
  if (origin.sourceHostId && origin.sourceAgentId)
    return { hostId: origin.sourceHostId, agentId: origin.sourceAgentId };
  return undefined;
}

interface SessionFamily {
  placements: BoardPlacement[];
  width: number;
  height: number;
}

function arrangeSessionFamilies(sessions: CanvasSession[], order: SessionOrder): BoardPlacement[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const children = new Map<string, CanvasSession[]>();
  const roots: CanvasSession[] = [];
  const sorted = [...sessions].sort((a, b) => {
    const delta =
      (sessionTime(a, "forked") ?? a.createdAt.getTime()) -
      (sessionTime(b, "forked") ?? b.createdAt.getTime());
    return (order === "oldest" ? delta : -delta) || a.id.localeCompare(b.id);
  });
  for (const session of sorted) {
    const parentId = session.forkedFrom?.agentId;
    if (!parentId || parentId === session.id || !byId.has(parentId)) roots.push(session);
    else {
      const siblings = children.get(parentId) ?? [];
      siblings.push(session);
      children.set(parentId, siblings);
    }
  }
  const visited = new Set<string>();
  function family(session: CanvasSession): SessionFamily {
    visited.add(session.id);
    const branches: SessionFamily[] = [];
    for (const child of children.get(session.id) ?? []) {
      if (!visited.has(child.id)) branches.push(family(child));
    }
    const placements: BoardPlacement[] = [];
    let width = 0;
    let height = 0;
    for (const branch of branches) {
      for (const placement of branch.placements) {
        placements.push({
          ...placement,
          column: (placement.column ?? 0) + width,
          row: (placement.row ?? 0) + SESSION_CARD_SIZE.height + 1,
        });
      }
      width += branch.width + 2;
      height = Math.max(height, branch.height);
    }
    width = Math.max(SESSION_CARD_SIZE.width, width - 2);
    placements.unshift({
      id: session.id,
      // Keep the context root visible at the start of its family. Centering it
      // over every leaf can put the entire top of a wide tree off screen.
      column: 0,
      row: 0,
      ...SESSION_CARD_SIZE,
    });
    return { placements, width, height: SESSION_CARD_SIZE.height + (height ? height + 1 : 0) };
  }
  const families: SessionFamily[] = [];
  for (const session of [...roots, ...sorted]) {
    if (!visited.has(session.id)) families.push(family(session));
  }
  const area = families.reduce((sum, group) => sum + (group.width + 3) * (group.height + 2), 0);
  const widest = Math.max(SESSION_CARD_SIZE.width, ...families.map((group) => group.width));
  const targetWidth = Math.max(widest, Math.sqrt(area * 1.5));
  let column = 1;
  let row = 1;
  let shelfHeight = 0;
  const result: BoardPlacement[] = [];
  for (const group of families) {
    if (column > 1 && column + group.width > targetWidth + 1) {
      row += shelfHeight + 2;
      column = 1;
      shelfHeight = 0;
    }
    for (const placement of group.placements)
      result.push({
        ...placement,
        column: (placement.column ?? 0) + column,
        row: (placement.row ?? 0) + row,
      });
    column += group.width + 3;
    shelfHeight = Math.max(shelfHeight, group.height);
  }
  return result;
}

/** Add near the source without moving any saved card, including cards currently filtered out. */
export function addSessionPlacements(input: {
  sessions: CanvasSession[];
  placements: BoardPlacement[];
  time: SessionArrangement;
  order: SessionOrder;
}): BoardPlacement[] {
  const { sessions, placements, time, order } = input;
  if (!placements.length) return arrangeSessions(sessions, time, order);
  const result = [...placements];
  const known = new Map(placements.map((placement) => [placement.id, placement]));
  const byId = new Map(sessions.map((session) => [session.id, session]));
  for (const proposed of arrangeSessions(sessions, time, order)) {
    if (known.has(proposed.id)) continue;
    const parent = known.get(byId.get(proposed.id)?.forkedFrom?.agentId ?? "");
    const bottom =
      Math.max(...result.map((p) => (p.row ?? 0) + (p.height ?? SESSION_CARD_SIZE.height))) + 0.5;
    let candidate = { ...proposed, row: bottom };
    if (time === "relationships" && parent) {
      candidate = {
        ...candidate,
        column: parent.column,
        row: (parent.row ?? 0) + (parent.height ?? SESSION_CARD_SIZE.height) + 1,
      };
      const candidates = result.filter((p) => p.id !== parent.id);
      const collides = () =>
        candidates.some(
          (p) =>
            (candidate.column ?? 0) < (p.column ?? 0) + (p.width ?? SESSION_CARD_SIZE.width) + 1 &&
            (candidate.column ?? 0) + SESSION_CARD_SIZE.width + 1 > (p.column ?? 0) &&
            candidate.row < (p.row ?? 0) + (p.height ?? SESSION_CARD_SIZE.height) + 0.5 &&
            candidate.row + SESSION_CARD_SIZE.height + 0.5 > (p.row ?? 0),
        );
      while (collides())
        candidate = { ...candidate, column: (candidate.column ?? 0) + SESSION_CARD_SIZE.width + 2 };
    }
    result.push(candidate);
    known.set(candidate.id, candidate);
  }
  return result;
}

export function sessionAncestors(id: string, sessions: CanvasSession[]): CanvasSession[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const ancestors: CanvasSession[] = [];
  const seen = new Set([id]);
  let parent = byId.get(byId.get(id)?.forkedFrom?.agentId ?? "");
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    ancestors.unshift(parent);
    parent = byId.get(parent.forkedFrom?.agentId ?? "");
  }
  return ancestors;
}
