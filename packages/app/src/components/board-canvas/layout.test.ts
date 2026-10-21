import {
  arrangeSessions,
  sessionNodes,
  SESSION_CARD_SIZE,
  type CanvasSession,
} from "@/screens/session-canvas/model";
import { describe, expect, it } from "vitest";
import {
  arrangeLineageTrees,
  resolveBoardPlacements,
  type BoardNode,
  type BoardPlacement,
} from "./layout";

const nodes: BoardNode[] = [
  { id: "a", title: "Baseline", basedOn: null, goal: "Research", createdAt: "2026-01-01" },
  { id: "b", title: "Resume", basedOn: "a", goal: "Research", createdAt: "2026-01-02" },
  { id: "c", title: "Module", basedOn: null, goal: "Software", createdAt: "2026-01-03" },
];
describe("shared board geometry", () => {
  it("preserves hand placed cards when new work is added and keeps goal groups apart", () => {
    const stored: BoardPlacement[] = [{ id: "a", column: 4, row: 5, width: 20, height: 12 }];
    const placements = resolveBoardPlacements(nodes, new Map(), stored);
    expect(placements.get("a")).toEqual(stored[0]);
    const b = placements.get("b")!;
    expect(b.row).toBeGreaterThanOrEqual(17);
    expect(placements.get("c")!.row).toBeGreaterThan(b.row + b.height);
    const more = resolveBoardPlacements(
      [...nodes, { ...nodes[1]!, id: "d", createdAt: "2026-01-04" }],
      new Map(),
      [...placements.values()],
    );
    for (const [id, position] of placements) expect(more.get(id)).toEqual(position);
  });
  it("arranges source trees without changing dimensions and terminates even with cyclic references", () => {
    const placements = resolveBoardPlacements(nodes, new Map(), []);
    const arranged = arrangeLineageTrees(nodes, placements);
    expect(arranged.map((value) => value.id)).toEqual(["a", "b", "c"]);
    for (const card of arranged) expect(card.width).toBe(placements.get(card.id)!.width);
    const cyclic = [{ ...nodes[0]!, basedOn: "b" }, nodes[1]!];
    expect(arrangeLineageTrees(cyclic, resolveBoardPlacements(cyclic, new Map(), []))).toHaveLength(
      2,
    );
  });
});

describe("session chronology", () => {
  const sessions = Array.from(
    { length: 12 },
    (_, index): CanvasSession => ({
      id: `session-${index}`,
      title: `Session ${index}`,
      provider: "codex",
      status: "idle",
      createdAt: new Date(Date.UTC(2026, 9, index + 1)),
      lastUserMessageAt: new Date(Date.UTC(2026, 10, 12 - index)),
      lastAssistantMessageAt: index === 0 ? null : new Date(Date.UTC(2026, 11, index + 1)),
      forkedFrom:
        index === 1 || index === 3
          ? { agentId: "session-0", forkedAt: new Date(Date.UTC(2026, 9, index + 1)).toISOString() }
          : undefined,
    }),
  );
  it("keeps time strictly vertical with a compact gap, independently of branches and canvas width", () => {
    const layout = arrangeSessions(sessions, "created", "oldest");
    for (let i = 1; i < layout.length; i++) {
      expect(layout[i].row! - layout[i - 1].row!).toBe(SESSION_CARD_SIZE.height + 0.5);
    }
    expect(layout[1].column).toBeGreaterThan(layout[0].column!);
    expect(layout[2].column).toBe(layout[0].column);
    expect(sessionNodes(sessions, "Untitled")[1].basedOn).toBe("session-0");
  });
  it("sorts each event separately and places missing events last in both directions", () => {
    expect(arrangeSessions(sessions, "input", "oldest")[0].id).toBe("session-11");
    expect(arrangeSessions(sessions, "created", "newest")[0].id).toBe("session-11");
    expect(
      arrangeSessions(sessions, "forked", "oldest")
        .slice(0, 2)
        .map((p) => p.id),
    ).toEqual(["session-1", "session-3"]);
    for (const order of ["oldest", "newest"] as const)
      expect(arrangeSessions(sessions, "reply", order).at(-1)?.id).toBe("session-0");
  });
  it("shows an out-of-workspace source without inventing a parent node", () => {
    const orphan: CanvasSession = {
      ...sessions[0],
      forkedFrom: { agentId: "elsewhere", forkedAt: sessions[0].createdAt.toISOString() },
    };
    expect(sessionNodes([orphan], "Untitled")[0].basedOn).toBe("elsewhere");
    expect(arrangeSessions([orphan], "created", "oldest")[0].column).toBe(1);
  });
});
