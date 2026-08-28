import { describe, expect, it } from "vitest";
import type { ProgressUnitPlan } from "@getpaseo/protocol/experiments";
import { projectProgressCurrent } from "./experiment-progress-units";

describe("Experiment progress unit projection", () => {
  const frames: ProgressUnitPlan = {
    unit: "seen-frame",
    total: 1_600_000,
    projection: [
      { sourceStart: 0, sourceEnd: 100, targetStart: 0, targetEnd: 200_000 },
      { sourceStart: 100, sourceEnd: 300, targetStart: 200_000, targetEnd: 1_000_000 },
      { sourceStart: 300, sourceEnd: 400, targetStart: 1_000_000, targetEnd: 1_600_000 },
    ],
  };

  it("keeps the primary unit unchanged", () => {
    expect(projectProgressCurrent(125, "step", { unit: "step", total: 400 })).toBe(125);
  });

  it("projects progress piecewise into another unit", () => {
    expect(projectProgressCurrent(50, "step", frames)).toBe(100_000);
    expect(projectProgressCurrent(200, "step", frames)).toBe(600_000);
    expect(projectProgressCurrent(400, "step", frames)).toBe(1_600_000);
  });

  it("does not invent a position outside configured coverage", () => {
    expect(projectProgressCurrent(450, "step", frames)).toBeNull();
    expect(projectProgressCurrent(200, "step", { unit: "token", total: 1_000_000 })).toBeNull();
  });
});
