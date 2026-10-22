import type { ResolvedPlacement } from "./layout";

interface Point {
  x: number;
  y: number;
}
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface BoardRoute {
  points: Point[];
  end: Point;
  direction: "right" | "left" | "up" | "down";
}

const GRID = 24;
const CLEARANCE = 8;
const STUB = 12;

function box(card: ResolvedPlacement, padding = 0): Box {
  return {
    left: card.column * GRID - padding,
    right: (card.column + card.width) * GRID + padding,
    top: card.row * GRID - padding,
    bottom: (card.row + card.height) * GRID + padding,
  };
}

function clearSegment(a: Point, b: Point, obstacles: Box[]): boolean {
  return !obstacles.some((rect) =>
    a.x === b.x
      ? a.x > rect.left &&
        a.x < rect.right &&
        Math.max(a.y, b.y) > rect.top &&
        Math.min(a.y, b.y) < rect.bottom
      : a.y > rect.top &&
        a.y < rect.bottom &&
        Math.max(a.x, b.x) > rect.left &&
        Math.min(a.x, b.x) < rect.right,
  );
}

function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last?.x === point.x && last.y === point.y) continue;
    const previous = result.at(-2);
    if (
      previous &&
      last &&
      ((previous.x === last.x && last.x === point.x) ||
        (previous.y === last.y && last.y === point.y))
    )
      result.pop();
    result.push(point);
  }
  return result;
}

function connectionPorts(source: ResolvedPlacement, target: ResolvedPlacement) {
  const a = box(source),
    b = box(target);
  let start: Point, end: Point, escape: Point, approach: Point;
  let direction: BoardRoute["direction"];
  if (a.right <= b.left || b.right <= a.left) {
    const right = a.right <= b.left;
    const gap = right ? b.left - a.right : a.left - b.right;
    const stub = Math.min(STUB, gap / 2);
    start = { x: right ? a.right : a.left, y: (a.top + a.bottom) / 2 };
    end = { x: right ? b.left : b.right, y: (b.top + b.bottom) / 2 };
    escape = { x: start.x + (right ? stub : -stub), y: start.y };
    approach = { x: end.x + (right ? -stub : stub), y: end.y };
    direction = right ? "right" : "left";
  } else {
    const down = b.top + b.bottom >= a.top + a.bottom;
    const gap = down ? b.top - a.bottom : a.top - b.bottom;
    const stub = Math.min(STUB, Math.max(0, gap / 2));
    start = { x: (a.left + a.right) / 2, y: down ? a.bottom : a.top };
    end = { x: (b.left + b.right) / 2, y: down ? b.top : b.bottom };
    escape = { x: start.x, y: start.y + (down ? stub : -stub) };
    approach = { x: end.x, y: end.y + (down ? -stub : stub) };
    direction = down ? "down" : "up";
  }
  return { start, end, escape, approach, direction };
}

export function orthogonalRoute(
  source: ResolvedPlacement,
  target: ResolvedPlacement,
  cards: Iterable<ResolvedPlacement> = [source, target],
): BoardRoute {
  const { start, end, escape, approach, direction } = connectionPorts(source, target);
  const horizontal = direction === "left" || direction === "right";
  // Keep the lane inside the gap. Snapping this midpoint to the 24px card grid
  // puts a narrow-gap branch directly on the next card's border.
  const middle = horizontal ? (escape.x + approach.x) / 2 : (escape.y + approach.y) / 2;
  const direct = horizontal
    ? [escape, { x: middle, y: escape.y }, { x: middle, y: approach.y }, approach]
    : [escape, { x: escape.x, y: middle }, { x: approach.x, y: middle }, approach];
  const allCards = [...cards];
  const obstacles = allCards.map((card) => box(card, CLEARANCE));
  const isClear = (points: Point[], bounds: Box[]) =>
    points.slice(1).every((point, index) => clearSegment(points[index]!, point, bounds));
  let inner = direct;
  if (!isClear(direct, obstacles)) {
    inner = findRoute(escape, approach, obstacles, horizontal ? 0 : 1) ?? direct;
    // Touching / overlapping manual cards may leave no padded corridor.
    // Still prefer a path around real card interiors whenever one exists.
    if (
      !isClear(
        inner,
        allCards.map((card) => box(card)),
      )
    ) {
      inner =
        findRoute(
          escape,
          approach,
          allCards.map((card) => box(card)),
          horizontal ? 0 : 1,
        ) ?? direct;
    }
  }
  return { points: simplify([start, ...inner, end]), end, direction };
}

interface QueueEntry {
  state: number;
  cost: number;
  priority: number;
}
class RouteQueue {
  private entries: QueueEntry[] = [];
  push(entry: QueueEntry) {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.entries[parent]!.priority <= entry.priority) break;
      this.entries[index] = this.entries[parent]!;
      index = parent;
    }
    this.entries[index] = entry;
  }
  pop(): QueueEntry | undefined {
    const first = this.entries[0],
      last = this.entries.pop();
    if (!first || !last || this.entries.length === 0) return first;
    let index = 0;
    while (index * 2 + 1 < this.entries.length) {
      let child = index * 2 + 1;
      if (
        child + 1 < this.entries.length &&
        this.entries[child + 1]!.priority < this.entries[child]!.priority
      )
        child++;
      if (this.entries[child]!.priority >= last.priority) break;
      this.entries[index] = this.entries[child]!;
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}

// Orthogonal visibility grid: coordinates come from card boundaries, not world
// pixels, so a very distant manual card does not increase the search resolution.
function findRoute(
  start: Point,
  end: Point,
  obstacles: Box[],
  initialAxis: number,
): Point[] | null {
  const xs = [
    ...new Set([start.x, end.x, ...obstacles.flatMap((rect) => [rect.left, rect.right])]),
  ].sort((a, b) => a - b);
  const ys = [
    ...new Set([start.y, end.y, ...obstacles.flatMap((rect) => [rect.top, rect.bottom])]),
  ].sort((a, b) => a - b);
  const columns = xs.length;
  const pointAt = (index: number): Point => ({
    x: xs[index % columns]!,
    y: ys[Math.floor(index / columns)]!,
  });
  const first = (ys.indexOf(start.y) * columns + xs.indexOf(start.x)) * 2 + initialAxis;
  const destination = ys.indexOf(end.y) * columns + xs.indexOf(end.x);
  const distance = new Map<number, number>([[first, 0]]);
  const previous = new Map<number, number>();
  const queue = new RouteQueue();
  queue.push({ state: first, cost: 0, priority: 0 });
  for (let entry = queue.pop(); entry; entry = queue.pop()) {
    if (entry.cost !== distance.get(entry.state)) continue;
    const index = Math.floor(entry.state / 2),
      axis = entry.state % 2;
    if (index === destination) {
      const points = [];
      for (
        let state: number | undefined = entry.state;
        state !== undefined;
        state = previous.get(state)
      )
        points.push(pointAt(Math.floor(state / 2)));
      return points.toReversed();
    }
    const x = index % columns,
      y = Math.floor(index / columns),
      point = pointAt(index);
    for (const [nx, ny, nextAxis] of [
      [x - 1, y, 0],
      [x + 1, y, 0],
      [x, y - 1, 1],
      [x, y + 1, 1],
    ]) {
      if (nx! < 0 || nx! >= columns || ny! < 0 || ny! >= ys.length) continue;
      const nextIndex = ny! * columns + nx!,
        next = pointAt(nextIndex);
      if (!clearSegment(point, next, obstacles)) continue;
      const state = nextIndex * 2 + nextAxis!;
      const cost =
        entry.cost +
        Math.abs(point.x - next.x) +
        Math.abs(point.y - next.y) +
        (axis === nextAxis ? 0 : 24);
      if (cost >= (distance.get(state) ?? Infinity)) continue;
      distance.set(state, cost);
      previous.set(state, entry.state);
      queue.push({
        state,
        cost,
        priority: cost + Math.abs(next.x - end.x) + Math.abs(next.y - end.y),
      });
    }
  }
  return null;
}

export function roundedRoutePath(points: Point[], radius = 8): string {
  const first = points[0];
  if (!first) return "";
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1]!,
      corner = points[index]!,
      next = points[index + 1]!;
    const incoming = Math.abs(previous.x - corner.x) + Math.abs(previous.y - corner.y);
    const outgoing = Math.abs(next.x - corner.x) + Math.abs(next.y - corner.y);
    const r = Math.min(radius, incoming / 2, outgoing / 2);
    const before = {
      x: corner.x + Math.sign(previous.x - corner.x) * r,
      y: corner.y + Math.sign(previous.y - corner.y) * r,
    };
    const after = {
      x: corner.x + Math.sign(next.x - corner.x) * r,
      y: corner.y + Math.sign(next.y - corner.y) * r,
    };
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const last = points.at(-1)!;
  return path + ` L ${last.x} ${last.y}`;
}
