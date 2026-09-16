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
const TREE_ROW_COLUMNS = 58;
const TREE_COLUMN_GAP = 3;
const TREE_ROW_GAP = 3;
const TREE_BLOCK_GAP = 4;

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
  storedPlacements: ExperimentBoardPlacement[] = [],
): Map<string, ResolvedPlacement> {
  const storedByExperiment = new Map(
    storedPlacements.map((placement) => [placement.experiment, placement]),
  );
  const depthById = lineageDepths(experiments);
  const goalGroups = groupExperimentsByGoal(experiments);
  const result = new Map<string, ResolvedPlacement>();
  const occupied = reservedPlacements(
    experiments,
    detailByExperiment,
    storedByExperiment,
    depthById,
  );
  let groupRow = 1;
  for (const group of goalGroups.values()) {
    let row = groupRow;
    let groupBottom = 0;
    for (const experiment of group) {
      const stored = storedByExperiment.get(experiment.id);
      const automatic = automaticPlacement(experiment, detailByExperiment, depthById, row);
      automatic.column = stored?.column ?? automatic.column;
      if (stored?.row === null || stored?.row === undefined) {
        automatic.row = firstAvailableRow(resolvePlacement(stored, automatic), occupied);
      }
      result.set(experiment.id, automatic);
      const resolved = resolvePlacement(stored, automatic);
      if (stored?.row === null || stored?.row === undefined) occupied.push(resolved);
      row = resolved.row + resolved.height + 1;
      groupBottom = Math.max(groupBottom, resolved.row + resolved.height);
    }
    groupRow = groupBottom + 2;
  }
  return result;
}

export function resolveBoardPlacements(
  experiments: ExperimentRecord[],
  detailByExperiment: Map<string, ExperimentDetail>,
  storedPlacements: ExperimentBoardPlacement[],
): Map<string, ResolvedPlacement> {
  const automatic = buildAutomaticLayout(experiments, detailByExperiment, storedPlacements);
  const storedByExperiment = new Map(
    storedPlacements.map((placement) => [placement.experiment, placement]),
  );
  return new Map(
    experiments.map((experiment, index) => {
      const fallback = automatic.get(experiment.id) ?? fallbackPlacement(experiment.id, index);
      return [experiment.id, resolvePlacement(storedByExperiment.get(experiment.id), fallback)];
    }),
  );
}

export function arrangeLineageTrees(
  experiments: ExperimentRecord[],
  placements: Map<string, ResolvedPlacement>,
): ResolvedPlacement[] {
  const arranged: ResolvedPlacement[] = [];
  let row = 1;
  for (const tree of lineageTrees(experiments)) {
    const rows = packTreeRows(tree, placements);
    rows.forEach((cards, rowIndex) => {
      const reverse = rowIndex % 2 === 1;
      let rowRight = TREE_ROW_COLUMNS;
      for (const card of cards) rowRight = Math.max(rowRight, card.width + 1);
      let column = reverse ? rowRight : 1;
      let rowHeight = 0;
      for (const card of cards) {
        if (reverse) column -= card.width;
        arranged.push({ ...card, column, row });
        if (reverse) column -= TREE_COLUMN_GAP;
        else column += card.width + TREE_COLUMN_GAP;
        rowHeight = Math.max(rowHeight, card.height);
      }
      row += rowHeight + TREE_ROW_GAP;
    });
    row += TREE_BLOCK_GAP;
  }
  return arranged;
}

function lineageTrees(experiments: ExperimentRecord[]): ExperimentRecord[][] {
  const chronological = [...experiments].sort(compareExperiments);
  const byId = new Map(chronological.map((experiment) => [experiment.id, experiment]));
  const children = new Map<string, ExperimentRecord[]>();
  for (const experiment of chronological) {
    if (!experiment.basedOn || !byId.has(experiment.basedOn)) continue;
    const siblings = children.get(experiment.basedOn) ?? [];
    siblings.push(experiment);
    children.set(experiment.basedOn, siblings);
  }
  const visited = new Set<string>();
  const trees: ExperimentRecord[][] = [];
  const roots = chronological.filter(
    (experiment) => !experiment.basedOn || !byId.has(experiment.basedOn),
  );
  for (const root of [...roots, ...chronological]) {
    if (visited.has(root.id)) continue;
    const tree: ExperimentRecord[] = [];
    const pending = [root];
    while (pending.length > 0) {
      const experiment = pending.pop();
      if (!experiment || visited.has(experiment.id)) continue;
      visited.add(experiment.id);
      tree.push(experiment);
      pending.push(...(children.get(experiment.id) ?? []).toReversed());
    }
    trees.push(tree);
  }
  return trees;
}

function packTreeRows(
  tree: ExperimentRecord[],
  placements: Map<string, ResolvedPlacement>,
): ResolvedPlacement[][] {
  const rows: ResolvedPlacement[][] = [];
  let cards: ResolvedPlacement[] = [];
  let rowWidth = 0;
  for (const experiment of tree) {
    const card = placements.get(experiment.id);
    if (!card) throw new Error(`Missing canvas placement for ${experiment.id}`);
    const nextWidth = rowWidth + (cards.length > 0 ? TREE_COLUMN_GAP : 0) + card.width;
    if (cards.length > 0 && nextWidth + 1 > TREE_ROW_COLUMNS) {
      rows.push(cards);
      cards = [];
      rowWidth = 0;
    }
    rowWidth += (cards.length > 0 ? TREE_COLUMN_GAP : 0) + card.width;
    cards.push(card);
  }
  if (cards.length > 0) rows.push(cards);
  return rows;
}

function lineageDepths(experiments: ExperimentRecord[]): Map<string, number> {
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
  return depthById;
}

function groupExperimentsByGoal(experiments: ExperimentRecord[]): Map<string, ExperimentRecord[]> {
  const goalGroups = new Map<string, ExperimentRecord[]>();
  for (const experiment of [...experiments].sort(compareExperiments)) {
    const key = experiment.goal ?? "Ungrouped";
    goalGroups.set(key, [...(goalGroups.get(key) ?? []), experiment]);
  }
  return goalGroups;
}

function reservedPlacements(
  experiments: ExperimentRecord[],
  detailByExperiment: Map<string, ExperimentDetail>,
  storedByExperiment: Map<string, ExperimentBoardPlacement>,
  depthById: Map<string, number>,
): ResolvedPlacement[] {
  const occupied: ResolvedPlacement[] = [];
  for (const experiment of experiments) {
    const stored = storedByExperiment.get(experiment.id);
    if (stored?.row === null || stored?.row === undefined) continue;
    occupied.push(
      resolvePlacement(
        stored,
        automaticPlacement(experiment, detailByExperiment, depthById, stored.row),
      ),
    );
  }
  return occupied;
}

function automaticPlacement(
  experiment: ExperimentRecord,
  detailByExperiment: Map<string, ExperimentDetail>,
  depthById: Map<string, number>,
  row: number,
): ResolvedPlacement {
  const size = automaticCardSize(experiment, detailByExperiment.get(experiment.id) ?? null);
  return {
    experiment: experiment.id,
    column: 1 + (depthById.get(experiment.id) ?? 0) * LINEAGE_INDENT,
    row,
    width: size.width,
    height: size.height,
  };
}

function firstAvailableRow(card: ResolvedPlacement, occupied: ResolvedPlacement[]): number {
  let row = card.row;
  for (;;) {
    const overlapping = occupied.find(
      (other) =>
        card.column < other.column + other.width &&
        card.column + card.width > other.column &&
        row < other.row + other.height &&
        row + card.height > other.row,
    );
    if (!overlapping) return row;
    row = overlapping.row + overlapping.height + 1;
  }
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
  const hasProgress = detail ? selectCardProgressAttempts(detail).length > 0 : false;
  return { width, height: hasProgress ? 8 : DEFAULT_HEIGHT };
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
