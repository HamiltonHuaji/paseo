import {
  arrangeSessions,
  addSessionPlacements,
  sessionAncestors,
  sessionNodes,
  sessionsForCanvas,
  SESSION_CARD_SIZE,
  type CanvasSession,
} from "@/screens/session-canvas/model";
import { describe, expect, it } from "vitest";
import {
  arrangeLineageTrees,
  resolveBoardPlacements,
  orthogonalRoute,
  type ResolvedPlacement,
  type BoardNode,
  type BoardPlacement,
} from "./layout";

import {
  canvasDragDelta,
  canvasWheelDelta,
  fitCanvasCamera,
  zoomCamera,
  MIN_CANVAS_ZOOM,
  MAX_CANVAS_ZOOM,
} from "./camera";

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
    expect(b.column).toBeGreaterThanOrEqual(24);
    expect(b.row).toBe(5);
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
  it("keeps a branching tree readable, forward and deterministic with mixed card sizes", () => {
    const family = [
      nodes[0]!,
      { ...nodes[1]!, id: "first" },
      { ...nodes[1]!, id: "second", createdAt: "2026-01-03" },
      { ...nodes[1]!, id: "grandchild", basedOn: "first", createdAt: "2026-01-04" },
    ];
    const sizes = new Map([["first", { width: 20, height: 10 }]]);
    const positions = resolveBoardPlacements(family, sizes, []);
    const arranged = arrangeLineageTrees(family, positions);
    expect(arrangeLineageTrees(family.toReversed(), positions)).toEqual(arranged);
    const byId = new Map(arranged.map((card) => [card.id, card]));
    expect(byId.get("first")!.column).toBe(byId.get("second")!.column);
    expect(byId.get("first")!.row + 10).toBeLessThan(byId.get("second")!.row);
    for (const node of family.slice(1)) {
      const card = byId.get(node.id)!;
      const parent = byId.get(node.basedOn!)!;
      expect(card.column).toBeGreaterThan(parent.column + parent.width);
    }
    const root = byId.get("a")!;
    expect(root.row).toBeGreaterThan(byId.get("first")!.row);
    expect(root.row).toBeLessThan(byId.get("second")!.row);
    for (const card of arranged) {
      expect(card.width).toBe(positions.get(card.id)!.width);
      expect(card.height).toBe(positions.get(card.id)!.height);
    }
  });

  it("packs independent roots across a shelf instead of creating a tall single column", () => {
    const independent = Array.from({ length: 9 }, (_, index) => ({
      ...nodes[0]!,
      id: String(index),
      createdAt: String(index),
    }));
    const arranged = arrangeLineageTrees(
      independent,
      resolveBoardPlacements(independent, new Map(), []),
    );
    expect(arranged[0]!.row).toBe(arranged[1]!.row);
    expect(arranged[1]!.column).toBeGreaterThan(arranged[0]!.column + arranged[0]!.width);
    expect(Math.max(...arranged.map((card) => card.row + card.height))).toBeLessThan(40);
  });

  it("folds a long unbranched history without adding false branches or overlaps", () => {
    const chain = Array.from({ length: 5 }, (_, index) => ({
      ...nodes[0]!,
      id: String(index),
      basedOn: index ? String(index - 1) : null,
      createdAt: String(index),
    }));
    const placements = resolveBoardPlacements(
      chain,
      new Map(chain.map((node) => [node.id, { width: 15, height: 9 }])),
      [],
    );
    const arranged = arrangeLineageTrees(chain, placements);
    expect(Math.max(...arranged.map((card) => card.column + card.width))).toBeLessThan(58);
    expect(Math.max(...arranged.map((card) => card.row + card.height))).toBeLessThan(25);
    const byId = new Map(arranged.map((card) => [card.id, card]));
    for (const node of chain.slice(1)) {
      const route = orthogonalRoute(byId.get(node.basedOn!)!, byId.get(node.id)!, arranged);
      expectRouteClear(route.points, arranged);
    }
  });

  it("keeps narrow fork connectors between cards and attaches to exact edge centers", () => {
    const source = { id: "source", column: 1, row: 1, width: 16, height: 9 };
    const target = { id: "target", column: 18, row: 10.5, width: 16, height: 9 };
    const route = orthogonalRoute(source, target);
    expect(route.points).toEqual([
      { x: 408, y: 132 },
      { x: 420, y: 132 },
      { x: 420, y: 360 },
      { x: 432, y: 360 },
    ]);
    expect(route.direction).toBe("right");
  });

  it("routes around intervening cards with orthogonal segments", () => {
    const source = { id: "source", column: 1, row: 4, width: 12, height: 7 };
    const target = { id: "target", column: 39, row: 4, width: 12, height: 7 };
    const blocker = { id: "blocker", column: 20, row: 1, width: 12, height: 15 };
    const route = orthogonalRoute(source, target, [source, target, blocker]);
    expect(route.points[0]).toEqual({ x: 312, y: 180 });
    expect(route.end).toEqual({ x: 936, y: 180 });
    expect(route.points.some((point) => point.y <= 16 || point.y >= 392)).toBe(true);
    expectRouteClear(route.points, [source, target, blocker]);
  });

  it("routes reverse and vertical relationships around intervening cards", () => {
    const source = { id: "source", column: 1, row: 1, width: 12, height: 7 };
    const target = { id: "target", column: 1, row: 22, width: 12, height: 7 };
    const blocker = { id: "blocker", column: 1, row: 11, width: 12, height: 7 };
    const forward = orthogonalRoute(source, target, [source, target, blocker]);
    const backward = orthogonalRoute(target, source, [source, target, blocker]);
    expect(forward.direction).toBe("down");
    expect(backward.direction).toBe("up");
    expectRouteClear(forward.points, [source, target, blocker]);
    expectRouteClear(backward.points, [source, target, blocker]);
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
  it("keeps interleaved trees in separate compact regions with time vertical inside each tree", () => {
    const forest = sessions.slice(0, 8).map((session, index) =>
      Object.assign({}, session, {
        forkedFrom:
          index < 2
            ? undefined
            : {
                agentId: sessions[index - 2].id,
                forkedAt: session.createdAt.toISOString(),
              },
      }),
    );
    for (const order of ["oldest", "newest"] as const) {
      const layout = arrangeSessions(forest, "created", order);
      expect(arrangeSessions(forest.toReversed(), "created", order)).toEqual(layout);
      const placements = new Map(layout.map((p) => [p.id, p]));
      const trees: BoardPlacement[][] = [[], []];
      for (const [index, session] of forest.entries())
        trees[index % 2].push(placements.get(session.id)!);
      for (const tree of trees) {
        expect(new Set(tree.map((p) => p.column)).size).toBe(1);
        for (let i = 1; i < tree.length; i++)
          expect(tree[i].row! - tree[i - 1].row!).toBe(
            (order === "oldest" ? 1 : -1) * (SESSION_CARD_SIZE.height + 0.5),
          );
      }
      expect(Math.abs(trees[0][0].column! - trees[1][0].column!)).toBeGreaterThan(
        SESSION_CARD_SIZE.width,
      );
      expect(Math.max(...layout.map((p) => p.row! + p.height!))).toBeLessThan(50);
    }
    expect(sessionNodes(sessions, "Untitled")[1].basedOn).toBe("session-0");
  });
  it("sorts each event separately and places missing events last in both directions", () => {
    expect(arrangeSessions(sessions, "input", "oldest")[0].id).toBe("session-11");
    expect(arrangeSessions(sessions, "created", "newest")[0].id).toBe("session-11");
    expect(
      arrangeSessions(sessions, "forked", "oldest")
        .filter((p) => p.id === "session-1" || p.id === "session-3")
        .map((p) => p.id),
    ).toEqual(["session-1", "session-3"]);
    for (const order of ["oldest", "newest"] as const) {
      const family = arrangeSessions(sessions.slice(0, 4), "reply", order);
      const root = family.find((p) => p.id === "session-0")!;
      for (const id of ["session-1", "session-3"])
        expect(root.row).toBeGreaterThan(family.find((p) => p.id === id)!.row!);
      const forked = arrangeSessions(sessions.slice(0, 4), "forked", order);
      const source = forked.find((p) => p.id === "session-0")!;
      expect(source.row).toBeLessThan(forked.find((p) => p.id === "session-1")!.row!);
    }
  });
  it("shows an out-of-workspace source without inventing a parent node", () => {
    const orphan: CanvasSession = {
      ...sessions[0],
      forkedFrom: { agentId: "elsewhere", forkedAt: sessions[0].createdAt.toISOString() },
    };
    expect(sessionNodes([orphan], "Untitled")[0].basedOn).toBe("elsewhere");
    expect(arrangeSessions([orphan], "created", "oldest")[0].column).toBe(1);
  });
  it("stacks small independent trees beside a tall tree and keeps saved cards when a branch arrives", () => {
    const chain = Array.from({ length: 16 }, (_, index) => ({
      ...sessions[0],
      id: `chain-${index}`,
      createdAt: new Date(Date.UTC(2026, 8, index + 1)),
      forkedFrom: index ? { agentId: `chain-${index - 1}`, forkedAt: "2026-09-01" } : undefined,
    }));
    const roots = sessions.filter((s) => !s.forkedFrom);
    const forest = [...chain, ...roots];
    const arranged = arrangeSessions(forest, "created", "oldest");
    const bottom = arranged.find((p) => p.id === "chain-15")!;
    for (const root of roots) {
      const card = arranged.find((p) => p.id === root.id)!;
      expect(card.column).toBeGreaterThan(SESSION_CARD_SIZE.width);
      expect(card.row! + card.height!).toBeLessThanOrEqual(bottom.row! + bottom.height!);
    }
    const added = {
      ...sessions[1],
      id: "new-branch",
      forkedFrom: { agentId: "chain-2", forkedAt: "2026-12-01" },
    };
    const saved = arranged.map((p) => Object.assign({}, p, { column: p.column! + 50 }));
    const extended = addSessionPlacements({
      sessions: [...forest, added],
      placements: saved,
      time: "created",
      order: "oldest",
    });
    expect(extended.slice(0, saved.length)).toEqual(saved);
    expect(extended.at(-1)!.row).toBe(
      saved.find((p) => p.id === "chain-15")!.row! + SESSION_CARD_SIZE.height + 0.5,
    );
    expect(extended.at(-1)!.column).toBe(saved.find((p) => p.id === "chain-2")!.column);
  });
  it("groups a context tree while keeping a deep single branch in one column", () => {
    const tree = [
      sessions[0],
      sessions[1],
      sessions[3],
      {
        ...sessions[2],
        forkedFrom: { agentId: "session-1", forkedAt: sessions[2].createdAt.toISOString() },
      },
      {
        ...sessions[4],
        forkedFrom: { agentId: "session-2", forkedAt: sessions[4].createdAt.toISOString() },
      },
      sessions[5],
    ];
    const arranged = arrangeSessions(tree, "relationships", "oldest");
    const map = new Map(arranged.map((p) => [p.id, p]));
    expect(map.get("session-1")?.row).toBe(map.get("session-3")?.row);
    expect(map.get("session-1")?.column).not.toBe(map.get("session-3")?.column);
    expect(map.get("session-2")?.column).toBe(map.get("session-1")?.column);
    expect(map.get("session-4")?.column).toBe(map.get("session-1")?.column);
    expect(sessionAncestors("session-4", tree).map((s) => s.id)).toEqual([
      "session-0",
      "session-1",
      "session-2",
    ]);
    expect(arrangeSessions(tree.toReversed(), "relationships", "oldest")).toEqual(arranged);
    const saved = arranged.map((p) =>
      Object.assign({}, p, { column: p.column! + 20, row: p.row! + 15 }),
    );
    const added = {
      ...sessions[6],
      forkedFrom: { agentId: "session-4", forkedAt: sessions[6].createdAt.toISOString() },
    };
    const extended = addSessionPlacements({
      sessions: [...tree, added],
      placements: saved,
      time: "relationships",
      order: "oldest",
    });
    expect(extended.slice(0, saved.length)).toEqual(saved);
    expect(
      extended.at(-1)!.column! - saved.find((p) => p.id === "session-4")!.column!,
    ).toBeLessThanOrEqual(SESSION_CARD_SIZE.width * 2);
    expect(extended.at(-1)?.row).toBe(
      saved.find((p) => p.id === "session-4")!.row! + SESSION_CARD_SIZE.height + 1,
    );
  });
  it("terminates relationship arrangement and ancestry navigation for malformed cycles", () => {
    const cyclic = [
      {
        ...sessions[0],
        forkedFrom: { agentId: "session-1", forkedAt: sessions[0].createdAt.toISOString() },
      },
      sessions[1],
    ];
    for (const mode of ["relationships", "created", "forked", "reply", "input"] as const) {
      expect(arrangeSessions(cyclic, mode, "oldest")).toHaveLength(2);
      expect(arrangeSessions(cyclic.toReversed(), mode, "oldest")).toEqual(
        arrangeSessions(cyclic, mode, "oldest"),
      );
    }
    expect(sessionAncestors("session-0", cyclic).map((s) => s.id)).toEqual(["session-1"]);
  });
});

function expectRouteClear(points: { x: number; y: number }[], cards: ResolvedPlacement[]) {
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!,
      b = points[index]!;
    expect(a.x === b.x || a.y === b.y).toBe(true);
    for (const card of cards) {
      const left = card.column * 24,
        right = (card.column + card.width) * 24;
      const top = card.row * 24,
        bottom = (card.row + card.height) * 24;
      const intersects =
        a.x === b.x
          ? a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom
          : a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
      expect(intersects).toBe(false);
    }
  }
}

describe("host-qualified session relationships", () => {
  it("never connects a foreign or unresolved origin to a local session with the same ID", () => {
    const source: CanvasSession = {
      id: "same-id",
      title: "Local source",
      provider: "codex",
      status: "closed",
      createdAt: new Date("2026-10-01T10:00:00Z"),
      lastUserMessageAt: null,
    };
    const origin = {
      operation: "native-fork" as const,
      sourceHostId: "remote",
      sourceAgentId: source.id,
      sourceProviderSessionId: "same-native-id",
      resultProviderSessionId: "branch",
      createdAt: source.createdAt.toISOString(),
      sourceResolution: "resolved" as const,
      sourceEvidence: "paseo-operation" as const,
    };
    const fork: CanvasSession = {
      ...source,
      id: "fork",
      forkedFrom: { agentId: source.id, forkedAt: origin.createdAt },
      sessionLineage: [origin],
    };
    const relatedNodes = (child: CanvasSession) =>
      sessionNodes(sessionsForCanvas([source, child], "local"), "Untitled");
    expect(relatedNodes(fork)[1].basedOn).toBeNull();
    expect(
      relatedNodes({ ...fork, sessionLineage: [{ ...origin, sourceHostId: "local" }] })[1].basedOn,
    ).toBe(source.id);
    for (const sourceResolution of ["missing", "ambiguous", "unknown-host"] as const) {
      expect(
        relatedNodes({
          ...fork,
          sessionLineage: [{ ...origin, sourceHostId: "local", sourceResolution }],
        })[1].basedOn,
      ).toBeNull();
    }
    expect(relatedNodes({ ...fork, sessionLineage: undefined })[1].basedOn).toBeNull();
    expect(
      relatedNodes({
        ...fork,
        sessionLineage: [
          {
            ...origin,
            sourceHostId: undefined,
            resolvedSource: { hostId: "local", agentId: source.id },
            sourceEvidence: "provider-history",
          },
        ],
      })[1].basedOn,
    ).toBe(source.id);
  });
});

describe("canvas view coordinates", () => {
  it("keeps the same world point under the cursor across zoom and clamp boundaries", () => {
    const camera = { x: -240, y: 72, zoom: 0.8 };
    const cursor = { x: 430, y: 290 };
    for (const target of [0.001, 0.5, 1, 2, 99]) {
      const result = zoomCamera(camera, target, cursor);
      expect(result.zoom).toBeGreaterThanOrEqual(MIN_CANVAS_ZOOM);
      expect(result.zoom).toBeLessThanOrEqual(MAX_CANVAS_ZOOM);
      expect((cursor.x - result.x) / result.zoom).toBeCloseTo((cursor.x - camera.x) / camera.zoom);
      expect((cursor.y - result.y) / result.zoom).toBeCloseTo((cursor.y - camera.y) / camera.zoom);
      const restored = zoomCamera(result, camera.zoom, cursor);
      expect(restored.x).toBeCloseTo(camera.x);
      expect(restored.y).toBeCloseTo(camera.y);
    }
  });
  it("fits actual visible card bounds with room for controls without changing placements", () => {
    const cards = [
      { id: "a", column: 50, row: 20, width: 20, height: 12 },
      { id: "b", column: 90, row: 60, width: 30, height: 20 },
    ];
    const snapshot = structuredClone(cards);
    const camera = fitCanvasCamera(cards, { width: 900, height: 600 })!;
    for (const card of cards) {
      expect(camera.x + card.column * 24 * camera.zoom).toBeGreaterThanOrEqual(23.99);
      expect(camera.y + card.row * 24 * camera.zoom).toBeGreaterThanOrEqual(23.99);
      expect(camera.x + (card.column + card.width) * 24 * camera.zoom).toBeLessThanOrEqual(876.01);
      expect(camera.y + (card.row + card.height) * 24 * camera.zoom).toBeLessThanOrEqual(528.01);
    }
    expect(cards).toEqual(snapshot);
    expect(fitCanvasCamera([], { width: 900, height: 600 })).toBeNull();
    expect(fitCanvasCamera(cards, { width: 0, height: 0 })).toBeNull();
  });
  it("converts the same pointer movement back to world coordinates at every scale", () => {
    for (const zoom of [0.1, 0.5, 1, 2, 3]) {
      const delta = canvasDragDelta({ dx: 72 * zoom, dy: -48 * zoom }, zoom);
      expect(delta.dx).toBeCloseTo(72);
      expect(delta.dy).toBeCloseTo(-48);
    }
  });
  it("normalizes wheel line and page units before pan or zoom", () => {
    expect(canvasWheelDelta({ deltaX: 1, deltaY: 2, deltaMode: 0 }, 600)).toEqual({ x: 1, y: 2 });
    expect(canvasWheelDelta({ deltaX: 1, deltaY: 2, deltaMode: 1 }, 600)).toEqual({ x: 16, y: 32 });
    expect(canvasWheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 600)).toEqual({ x: 0, y: 600 });
  });
});
