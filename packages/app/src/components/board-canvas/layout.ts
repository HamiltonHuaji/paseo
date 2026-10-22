export interface BoardNode {
  id: string;
  title: string;
  goal: string | null;
  basedOn: string | null;
  createdAt: string;
}
export interface BoardSize {
  width: number;
  height: number;
}
export interface BoardPlacement {
  id: string;
  column: number | null;
  row: number | null;
  width: number | null;
  height: number | null;
}

export const BOARD_CANVAS_GRID_SIZE = 24;
export const BOARD_CANVAS_MIN_ROWS = 30;
const DEFAULT_WIDTH = 12;
const DEFAULT_HEIGHT = 7;
const MIN_COLUMNS = 58;
const TREE_COLUMN_GAP = 3;
const TREE_ROW_GAP = 2;
const TREE_BLOCK_GAP = 4;

export { orthogonalRoute, roundedRoutePath } from "./routing";

export type ResolvedPlacement = Omit<BoardPlacement, "column" | "row" | "width" | "height"> & {
  column: number;
  row: number;
  width: number;
  height: number;
};

export function buildAutomaticLayout(
  experiments: BoardNode[],
  sizes: Map<string, BoardSize>,
  storedPlacements: BoardPlacement[] = [],
): Map<string, ResolvedPlacement> {
  const storedByExperiment = new Map(
    storedPlacements.map((placement) => [placement.id, placement]),
  );
  const initial = new Map(
    experiments.map((node, index) => {
      const size = automaticCardSize(node, sizes.get(node.id) ?? null);
      return [
        node.id,
        resolvePlacement(storedByExperiment.get(node.id), {
          ...fallbackPlacement(node.id, index),
          ...size,
        }),
      ];
    }),
  );
  const candidates = arrangeLineageTrees(experiments, initial);
  const occupied = candidates.flatMap((candidate) => {
    const stored = storedByExperiment.get(candidate.id);
    return stored?.row == null ? [] : [resolvePlacement(stored, candidate)];
  });
  const nodes = new Map(experiments.map((node) => [node.id, node]));
  const result = new Map<string, ResolvedPlacement>();
  for (const candidate of candidates) {
    const stored = storedByExperiment.get(candidate.id);
    const automatic = { ...candidate };
    const parentId = nodes.get(candidate.id)?.basedOn;
    const parent =
      parentId && storedByExperiment.get(parentId)?.row != null
        ? occupied.find((card) => card.id === parentId)
        : undefined;
    if (stored?.row == null && parent) {
      automatic.column = parent.column + parent.width + TREE_COLUMN_GAP;
      automatic.row = parent.row;
    }
    automatic.column = stored?.column ?? automatic.column;
    if (stored?.row == null) {
      automatic.row = firstAvailableRow(resolvePlacement(stored, automatic), occupied);
      occupied.push(resolvePlacement(stored, automatic));
    }
    result.set(candidate.id, automatic);
  }
  return result;
}

export function resolveBoardPlacements(
  experiments: BoardNode[],
  sizes: Map<string, BoardSize>,
  storedPlacements: BoardPlacement[],
): Map<string, ResolvedPlacement> {
  const automatic = buildAutomaticLayout(experiments, sizes, storedPlacements);
  const storedByExperiment = new Map(
    storedPlacements.map((placement) => [placement.id, placement]),
  );
  return new Map(
    experiments.map((experiment, index) => {
      const fallback = automatic.get(experiment.id) ?? fallbackPlacement(experiment.id, index);
      return [experiment.id, resolvePlacement(storedByExperiment.get(experiment.id), fallback)];
    }),
  );
}

// A forest has one source per node. Cut only the layout traversal of malformed cycles;
// the actual relationship remains visible to the edge renderer.
export function arrangeLineageTrees(
  nodes: BoardNode[],
  placements: Map<string, ResolvedPlacement>,
): ResolvedPlacement[] {
  const chronological = [...nodes].sort(compareExperiments);
  const byId = new Map(chronological.map((node) => [node.id, node]));
  const children = new Map<string, BoardNode[]>();
  for (const node of chronological) {
    if (!node.basedOn || !byId.has(node.basedOn)) continue;
    const siblings = children.get(node.basedOn) ?? [];
    siblings.push(node);
    children.set(node.basedOn, siblings);
  }
  const roots = chronological.filter((node) => !node.basedOn || !byId.has(node.basedOn));
  const visited = new Set<string>();
  interface Branch {
    card: ResolvedPlacement;
    children: Branch[];
    height: number;
    depth: number;
  }
  const trees: {
    cards: ResolvedPlacement[];
    width: number;
    height: number;
    goal: string | null;
  }[] = [];
  for (const root of [...roots, ...chronological]) {
    if (visited.has(root.id)) continue;
    const widths: number[] = [];
    const visit = (node: BoardNode, depth: number): Branch => {
      visited.add(node.id);
      const card = placements.get(node.id);
      if (!card) throw new Error(`Missing canvas placement for ${node.id}`);
      widths[depth] = Math.max(widths[depth] ?? 0, card.width);
      const branches: Branch[] = [];
      for (const child of children.get(node.id) ?? []) {
        if (!visited.has(child.id)) branches.push(visit(child, depth + 1));
      }
      const childrenHeight =
        branches.reduce((sum, branch) => sum + branch.height, 0) +
        Math.max(0, branches.length - 1) * TREE_ROW_GAP;
      return { card, children: branches, height: Math.max(card.height, childrenHeight), depth };
    };
    const tree = visit(root, 0);
    const columns: number[] = [];
    widths.forEach((width, depth) => {
      columns[depth] = depth === 0 ? 0 : columns[depth - 1]! + widths[depth - 1]! + TREE_COLUMN_GAP;
    });
    const cards: ResolvedPlacement[] = [];
    const place = (branch: Branch, top: number) => {
      cards.push({
        ...branch.card,
        column: columns[branch.depth]!,
        row: top + Math.floor((branch.height - branch.card.height) / 2),
      });
      let childTop =
        top +
        Math.floor(
          (branch.height -
            branch.children.reduce((sum, child) => sum + child.height, 0) -
            Math.max(0, branch.children.length - 1) * TREE_ROW_GAP) /
            2,
        );
      for (const child of branch.children) {
        place(child, childTop);
        childTop += child.height + TREE_ROW_GAP;
      }
    };
    place(tree, 0);
    const linear =
      cards.length >= 4 && cards.every((card) => (children.get(card.id)?.length ?? 0) <= 1);
    if (linear) {
      const compact = compactChain(cards);
      trees.push({
        cards: compact,
        width: Math.max(...compact.map((card) => card.column + card.width)),
        height: Math.max(...compact.map((card) => card.row + card.height)),
        goal: root.goal,
      });
      continue;
    }
    trees.push({
      cards,
      width: columns.at(-1)! + widths.at(-1)!,
      height: tree.height,
      goal: root.goal,
    });
  }
  // Pack connected components together. A linear history may fold, but branches
  // retain separate bands so a wrap never implies a different parent.
  const targetWidth = Math.max(
    MIN_COLUMNS,
    Math.ceil(
      Math.sqrt(
        trees.reduce(
          (area, tree) => area + (tree.width + TREE_BLOCK_GAP) * (tree.height + TREE_BLOCK_GAP),
          0,
        ),
      ) * 1.35,
    ),
  );
  const arranged: ResolvedPlacement[] = [];
  const groups = new Map<string | null, typeof trees>();
  for (const tree of trees) groups.set(tree.goal, [...(groups.get(tree.goal) ?? []), tree]);
  let row = 1;
  for (const group of groups.values()) {
    let column = 1;
    let shelfHeight = 0;
    for (const tree of group) {
      if (column > 1 && column + tree.width > targetWidth) {
        row += shelfHeight + TREE_BLOCK_GAP;
        column = 1;
        shelfHeight = 0;
      }
      for (const card of tree.cards)
        arranged.push({ ...card, column: card.column + column, row: card.row + row });
      column += tree.width + TREE_BLOCK_GAP;
      shelfHeight = Math.max(shelfHeight, tree.height);
    }
    row += shelfHeight + TREE_BLOCK_GAP;
  }
  return arranged;
}

function compactChain(chain: ResolvedPlacement[]): ResolvedPlacement[] {
  const rows: ResolvedPlacement[][] = [];
  let row: ResolvedPlacement[] = [];
  let width = 0;
  for (const card of chain) {
    if (row.length && width + TREE_COLUMN_GAP + card.width > MIN_COLUMNS) {
      rows.push(row);
      row = [];
      width = 0;
    }
    width += (row.length ? TREE_COLUMN_GAP : 0) + card.width;
    row.push(card);
  }
  rows.push(row);
  const widest = Math.max(
    ...rows.map(
      (cards) =>
        cards.reduce((sum, card) => sum + card.width, 0) + (cards.length - 1) * TREE_COLUMN_GAP,
    ),
  );
  const result: ResolvedPlacement[] = [];
  let top = 0;
  rows.forEach((cards, index) => {
    const reverse = index % 2 === 1;
    let column = reverse ? widest : 0;
    for (const card of cards) {
      if (reverse) column -= card.width;
      result.push({ ...card, column, row: top });
      column += reverse ? -TREE_COLUMN_GAP : card.width + TREE_COLUMN_GAP;
    }
    top += Math.max(...cards.map((card) => card.height)) + TREE_ROW_GAP;
  });
  return result;
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
  stored: BoardPlacement | undefined,
  automatic: ResolvedPlacement,
): ResolvedPlacement {
  return {
    id: automatic.id,
    column: stored?.column ?? automatic.column,
    row: stored?.row ?? automatic.row,
    width: stored?.width ?? automatic.width,
    height: stored?.height ?? automatic.height,
  };
}

export function fallbackPlacement(experiment: string, index: number): ResolvedPlacement {
  return {
    id: experiment,
    column: 1 + (index % 3) * 14,
    row: 1 + Math.floor(index / 3) * 10,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
}

export function canvasDimensions(placements: Map<string, ResolvedPlacement>) {
  let columns = MIN_COLUMNS;
  let rows = BOARD_CANVAS_MIN_ROWS;
  for (const placement of placements.values()) {
    columns = Math.max(columns, placement.column + placement.width + 3);
    rows = Math.max(rows, placement.row + placement.height + 3);
  }
  return {
    width: columns * BOARD_CANVAS_GRID_SIZE,
    height: rows * BOARD_CANVAS_GRID_SIZE,
  };
}

function automaticCardSize(node: BoardNode, size: BoardSize | null): BoardSize {
  return size ?? { width: node.title.length > 48 ? 14 : DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}

function compareExperiments(left: BoardNode, right: BoardNode): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}
