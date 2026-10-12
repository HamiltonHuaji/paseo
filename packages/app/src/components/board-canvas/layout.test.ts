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
