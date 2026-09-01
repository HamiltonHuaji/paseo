import type {
  ExperimentBoardPlacement,
  ExperimentDetail,
  ExperimentRecord,
} from "@getpaseo/protocol/experiments";
import { selectCardProgressAttempts } from "./experiment-progress-state";

export const EXPERIMENT_CANVAS_GRID_SIZE = 24;
export const EXPERIMENT_CANVAS_MIN_ROWS = 30;
const DEFAULT_WIDTH = 12;
const DEFAULT_HEIGHT = 7;
const MIN_COLUMNS = 58;
const LINEAGE_INDENT = 3;

export type ResolvedPlacement = Omit<
  ExperimentBoardPlacement,
  "column" | "row" | "width" | "height"
> & {
  column: number;
  row: number;
  width: number;
  height: number;
};

export function buildAutomaticLayout(
  experiments: ExperimentRecord[],
  detailByExperiment: Map<string, ExperimentDetail>,
): Map<string, ResolvedPlacement> {
  const experimentById = new Map(experiments.map((experiment) => [experiment.id, experiment]));
  const depthById = new Map<string, number>();
  const resolveDepth = (experiment: ExperimentRecord, visiting: Set<string>): number => {
    const cached = depthById.get(experiment.id);
    if (cached !== undefined) return cached;
    if (!experiment.basedOn || visiting.has(experiment.id)) return 0;
    const parent = experimentById.get(experiment.basedOn);
    if (!parent) return 0;
    const nextVisiting = new Set(visiting);
    nextVisiting.add(experiment.id);
    const depth = resolveDepth(parent, nextVisiting) + 1;
    depthById.set(experiment.id, depth);
    return depth;
  };
  for (const experiment of experiments) resolveDepth(experiment, new Set());

  const goalGroups = new Map<string, ExperimentRecord[]>();
  for (const experiment of [...experiments].sort(compareExperiments)) {
    const key = experiment.goal ?? "Ungrouped";
    goalGroups.set(key, [...(goalGroups.get(key) ?? []), experiment]);
  }

  const result = new Map<string, ResolvedPlacement>();
  let groupRow = 1;
  for (const group of goalGroups.values()) {
    let row = groupRow;
    for (const experiment of group) {
      const depth = depthById.get(experiment.id) ?? 0;
      const size = automaticCardSize(experiment, detailByExperiment.get(experiment.id) ?? null);
      result.set(experiment.id, {
        experiment: experiment.id,
        column: 1 + depth * LINEAGE_INDENT,
        row,
        width: size.width,
        height: size.height,
      });
      row += size.height + 1;
    }
    groupRow = row + 1;
  }
  return result;
}

export function resolvePlacement(
  stored: ExperimentBoardPlacement | undefined,
  automatic: ResolvedPlacement,
): ResolvedPlacement {
  return {
    experiment: automatic.experiment,
    column: stored?.column ?? automatic.column,
    row: stored?.row ?? automatic.row,
    width: stored?.width ?? automatic.width,
    height: stored?.height ?? automatic.height,
  };
}

export function fallbackPlacement(experiment: string, index: number): ResolvedPlacement {
  return {
    experiment,
    column: 1 + (index % 3) * 14,
    row: 1 + Math.floor(index / 3) * 10,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
}

export function canvasDimensions(placements: Map<string, ResolvedPlacement>) {
  let columns = MIN_COLUMNS;
  let rows = EXPERIMENT_CANVAS_MIN_ROWS;
  for (const placement of placements.values()) {
    columns = Math.max(columns, placement.column + placement.width + 3);
    rows = Math.max(rows, placement.row + placement.height + 3);
  }
  return {
    width: columns * EXPERIMENT_CANVAS_GRID_SIZE,
    height: rows * EXPERIMENT_CANVAS_GRID_SIZE,
  };
}

export function orthogonalRoute(source: ResolvedPlacement, target: ResolvedPlacement) {
  const sourceBox = placementBox(source);
  const targetBox = placementBox(target);
  if (sourceBox.right <= targetBox.left) {
    const start = { x: sourceBox.right, y: sourceBox.centerY };
    const end = { x: targetBox.left, y: targetBox.centerY };
    const middle = snap((start.x + end.x) / 2);
    return {
      points: [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end],
      end,
      direction: "right" as const,
    };
  }
  if (targetBox.right <= sourceBox.left) {
    const start = { x: sourceBox.left, y: sourceBox.centerY };
    const end = { x: targetBox.right, y: targetBox.centerY };
    const middle = snap((start.x + end.x) / 2);
    return {
      points: [start, { x: middle, y: start.y }, { x: middle, y: end.y }, end],
      end,
      direction: "left" as const,
    };
  }
  const targetIsBelow = targetBox.centerY >= sourceBox.centerY;
  const start = {
    x: sourceBox.centerX,
    y: targetIsBelow ? sourceBox.bottom : sourceBox.top,
  };
  const end = {
    x: targetBox.centerX,
    y: targetIsBelow ? targetBox.top : targetBox.bottom,
  };
  const middle = snap((start.y + end.y) / 2);
  return {
    points: [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end],
    end,
    direction: targetIsBelow ? ("down" as const) : ("up" as const),
  };
}

function automaticCardSize(
  experiment: ExperimentRecord,
  detail: ExperimentDetail | null,
): Pick<ResolvedPlacement, "width" | "height"> {
  const width = experiment.shortDescription.length > 48 ? 14 : DEFAULT_WIDTH;
  const progressCount = detail ? selectCardProgressAttempts(detail).length : 0;
  const height = progressCount > 0 ? 8 + Math.max(0, progressCount - 1) : DEFAULT_HEIGHT;
  return { width, height };
}

function compareExperiments(left: ExperimentRecord, right: ExperimentRecord): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function placementBox(placement: ResolvedPlacement) {
  const left = placement.column * EXPERIMENT_CANVAS_GRID_SIZE;
  const top = placement.row * EXPERIMENT_CANVAS_GRID_SIZE;
  const right = (placement.column + placement.width) * EXPERIMENT_CANVAS_GRID_SIZE;
  const bottom = (placement.row + placement.height) * EXPERIMENT_CANVAS_GRID_SIZE;
  return {
    left,
    top,
    right,
    bottom,
    centerX: snap((left + right) / 2),
    centerY: snap((top + bottom) / 2),
  };
}

function snap(value: number): number {
  return Math.round(value / EXPERIMENT_CANVAS_GRID_SIZE) * EXPERIMENT_CANVAS_GRID_SIZE;
}
