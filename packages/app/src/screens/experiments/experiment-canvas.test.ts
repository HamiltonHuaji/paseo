import { describe, expect, it } from "vitest";
import type { ExperimentRecord } from "@getpaseo/protocol/experiments";
import {
  buildAutomaticLayout,
  orthogonalRoute,
  resolvePlacement,
  type ResolvedPlacement,
} from "./experiment-canvas-layout";

describe("Experiment Canvas layout", () => {
  it("places lineage left-to-right and separates cards within a layer", () => {
    const root = experiment("exp_root", null, "goal-a", "2026-01-01T00:00:00Z");
    const childA = experiment("exp_childa", root.id, "goal-a", "2026-01-02T00:00:00Z");
    const childB = experiment("exp_childb", root.id, "goal-a", "2026-01-03T00:00:00Z");
    const otherGoal = experiment("exp_other", null, "goal-b", "2026-01-04T00:00:00Z");
    const layout = buildAutomaticLayout([root, childA, childB, otherGoal], new Map());

    expect(layout.get(childA.id)?.column).toBeGreaterThan(layout.get(root.id)?.column ?? 0);
    expect(layout.get(childB.id)?.column).toBe(layout.get(childA.id)?.column);
    expect(layout.get(childB.id)?.row).toBeGreaterThan(layout.get(childA.id)?.row ?? 0);
    expect(layout.get(otherGoal.id)?.row).toBeGreaterThan(layout.get(childB.id)?.row ?? 0);
  });

  it("uses automatic values only for nullable placement fields", () => {
    const automatic: ResolvedPlacement = {
      experiment: "exp_root",
      column: 2,
      row: 3,
      width: 12,
      height: 8,
    };
    expect(
      resolvePlacement(
        {
          experiment: "exp_root",
          column: 9,
          row: null,
          width: null,
          height: 10,
        },
        automatic,
      ),
    ).toEqual({ experiment: "exp_root", column: 9, row: 3, width: 12, height: 10 });
  });

  it("routes lineage with grid-aligned orthogonal segments", () => {
    const source: ResolvedPlacement = {
      experiment: "exp_root",
      column: 1,
      row: 2,
      width: 12,
      height: 8,
    };
    const target: ResolvedPlacement = {
      experiment: "exp_child",
      column: 18,
      row: 12,
      width: 12,
      height: 8,
    };
    const route = orthogonalRoute(source, target);
    for (const point of route.points) {
      expect(point.x % 24).toBe(0);
      expect(point.y % 24).toBe(0);
    }
    for (let index = 1; index < route.points.length; index += 1) {
      const previous = route.points[index - 1]!;
      const current = route.points[index]!;
      expect(previous.x === current.x || previous.y === current.y).toBe(true);
    }
  });
});

function experiment(
  id: string,
  basedOn: string | null,
  goal: string,
  createdAt: string,
): ExperimentRecord {
  return {
    id,
    basedOn,
    goal,
    shortDescription: id,
    description: id,
    viewerSource: null,
    viewer: null,
    conclusion: null,
    blobRelpath: `blobs/${id}`,
    closedAt: null,
    archivedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}
