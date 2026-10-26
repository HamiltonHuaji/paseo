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

// Time is ordinal within each source tree. Independent trees occupy separate blocks;
// a week without a message adds no empty canvas.
export function arrangeSessions(
  sessions: CanvasSession[],
  time: SessionArrangement,
  order: SessionOrder,
): BoardPlacement[] {
  if (time === "relationships") return arrangeSessionFamilies(sessions, order);
  const groups = sessionForest(sessions, order).map((tree) => {
    const lanes = new Map<string, number>();
    const members: CanvasSession[] = [];
    const visit = (branch: SessionBranch, lane: number): number => {
      members.push(branch.session);
      lanes.set(branch.session.id, lane);
      let next = lane;
      for (const child of branch.children) next = visit(child, next) + 1;
      return Math.max(lane, next - 1);
    };
    visit(tree, 0);
    const sorted = members.sort((a, b) => compareSessionTimes(a, b, time, order));
    const firstTimed = sorted.find((session) => sessionTime(session, time) !== null);
    // A source with no fork event is context for this tree, not a fabricated timestamp.
    // Keep it above its descendants instead of sending all such roots to a global tail.
    if (time === "forked" && sessionTime(tree.session, time) === null) {
      sorted.splice(sorted.indexOf(tree.session), 1);
      sorted.unshift(tree.session);
    }
    const placements = sorted.map((session, index) => ({
      id: session.id,
      // Rows never overlap in time mode, so branch indentation need not consume
      // a whole card width. An unbranched continuation stays in the same lane.
      column: lanes.get(session.id)! * 4,
      row: index * (SESSION_CARD_SIZE.height + 0.5),
      width: SESSION_CARD_SIZE.width,
      height: SESSION_CARD_SIZE.height,
    }));
    return {
      first: firstTimed ?? tree.session,
      placements,
      width: Math.max(...placements.map((p) => p.column + p.width)),
      height: placements.length * (SESSION_CARD_SIZE.height + 0.5) - 0.5,
    };
  });
  groups.sort((a, b) => compareSessionTimes(a.first, b.first, time, order));
  return packSessionFamilies(groups);
}

function compareSessionTimes(
  a: CanvasSession,
  b: CanvasSession,
  time: SessionTime,
  order: SessionOrder,
): number {
  const left = sessionTime(a, time);
  const right = sessionTime(b, time);
  if (left === null && right !== null) return 1;
  if (right === null && left !== null) return -1;
  const delta = left !== null && right !== null ? left - right : 0;
  return (
    (order === "oldest" ? delta : -delta) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    a.id.localeCompare(b.id)
  );
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

interface SessionBranch {
  session: CanvasSession;
  children: SessionBranch[];
}

function sessionForest(sessions: CanvasSession[], order: SessionOrder): SessionBranch[] {
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
  function visit(session: CanvasSession): SessionBranch {
    visited.add(session.id);
    const branches: SessionBranch[] = [];
    for (const child of children.get(session.id) ?? []) {
      if (!visited.has(child.id)) branches.push(visit(child));
    }
    return { session, children: branches };
  }
  const trees: SessionBranch[] = [];
  for (const session of [...roots, ...sorted])
    if (!visited.has(session.id)) trees.push(visit(session));
  return trees;
}

function arrangeSessionFamilies(sessions: CanvasSession[], order: SessionOrder): BoardPlacement[] {
  function family(tree: SessionBranch): SessionFamily {
    const branches = tree.children.map(family);
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
      id: tree.session.id,
      // Keep the context root visible at the start of its family. Centering it
      // over every leaf can put the entire top of a wide tree off screen.
      column: 0,
      row: 0,
      ...SESSION_CARD_SIZE,
    });
    return { placements, width, height: SESSION_CARD_SIZE.height + (height ? height + 1 : 0) };
  }
  return packSessionFamilies(sessionForest(sessions, order).map(family));
}

function packSessionFamilies(families: SessionFamily[]): BoardPlacement[] {
  const area = families.reduce((sum, group) => sum + (group.width + 3) * (group.height + 2), 0);
  const widest = Math.max(SESSION_CARD_SIZE.width, ...families.map((group) => group.width));
  const tallest = Math.max(SESSION_CARD_SIZE.height, ...families.map((group) => group.height));
  const narrowest = Math.min(SESSION_CARD_SIZE.width, ...families.map((group) => group.width));
  // A tall time tree fixes the total height already. Stack its smaller neighbors
  // beside it instead of making a wide shelf with empty space underneath.
  const targetWidth = Math.max(
    widest,
    Math.min(Math.sqrt(area * 1.5), Math.max(widest + 3 + narrowest, area / tallest)),
  );
  const occupied: { column: number; row: number; width: number; height: number }[] = [];
  const result: BoardPlacement[] = [];
  for (const group of families) {
    // Pack whole rectangles, including their empty branch space. Small independent
    // trees can stack beside a tall one without appearing inside its source family.
    let position: { column: number; row: number } | undefined;
    const columns = [1, ...occupied.map((box) => box.column + box.width + 3)];
    for (const column of columns) {
      if (column + group.width > targetWidth + 1) continue;
      let row = 1;
      for (;;) {
        const collisions = occupied.filter(
          (box) =>
            column < box.column + box.width + 3 &&
            column + group.width + 3 > box.column &&
            row < box.row + box.height + 2 &&
            row + group.height + 2 > box.row,
        );
        if (!collisions.length) break;
        row = Math.max(...collisions.map((box) => box.row + box.height + 2));
      }
      if (!position || row < position.row || (row === position.row && column < position.column))
        position = { column, row };
    }
    const { column, row } = position!;
    for (const placement of group.placements)
      result.push({
        ...placement,
        column: (placement.column ?? 0) + column,
        row: (placement.row ?? 0) + row,
      });
    occupied.push({ column, row, width: group.width, height: group.height });
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
  const familyById = new Map<string, Set<string>>();
  function collect(branch: SessionBranch, ids: Set<string>) {
    ids.add(branch.session.id);
    familyById.set(branch.session.id, ids);
    for (const child of branch.children) collect(child, ids);
  }
  for (const tree of sessionForest(sessions, order)) collect(tree, new Set());
  for (const proposed of arrangeSessions(sessions, time, order)) {
    if (known.has(proposed.id)) continue;
    const parent = known.get(byId.get(proposed.id)?.forkedFrom?.agentId ?? "");
    const bottom =
      Math.max(...result.map((p) => (p.row ?? 0) + (p.height ?? SESSION_CARD_SIZE.height))) + 0.5;
    let candidate = { ...proposed, row: bottom };
    if (parent && time !== "relationships") {
      const ids = familyById.get(proposed.id)!;
      const relatives = result.filter((p) => ids.has(p.id));
      candidate = {
        ...candidate,
        column: parent.column,
        row:
          Math.max(...relatives.map((p) => (p.row ?? 0) + (p.height ?? SESSION_CARD_SIZE.height))) +
          0.5,
      };
      // Append inside the source family's column without shifting existing cards
      // or dropping the new branch into a different family's empty interior.
      for (;;) {
        const blockers = result.filter(
          (p) =>
            (candidate.column ?? 0) < (p.column ?? 0) + (p.width ?? SESSION_CARD_SIZE.width) + 1 &&
            (candidate.column ?? 0) + SESSION_CARD_SIZE.width + 1 > (p.column ?? 0) &&
            candidate.row < (p.row ?? 0) + (p.height ?? SESSION_CARD_SIZE.height) + 0.5 &&
            candidate.row + SESSION_CARD_SIZE.height + 0.5 > (p.row ?? 0),
        );
        if (!blockers.length) break;
        candidate.row =
          Math.max(...blockers.map((p) => (p.row ?? 0) + (p.height ?? SESSION_CARD_SIZE.height))) +
          0.5;
      }
    } else if (parent) {
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
