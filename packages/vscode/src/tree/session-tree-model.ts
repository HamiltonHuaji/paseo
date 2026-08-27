export interface SessionTreeSourceItem<T> {
  id: string;
  label: string;
  pathLabel: string | null;
  value: T;
}

export interface SessionTreeLeaf<T> {
  kind: "leaf";
  id: string;
  label: string;
  displayLabel: string;
  sourceRank: number;
  value: T;
}

export interface SessionTreeGroup<T> {
  kind: "group";
  id: string;
  label: string;
  path: string;
  sourceRank: number;
  children: SessionTreeNode<T>[];
}

export type SessionTreeNode<T> = SessionTreeLeaf<T> | SessionTreeGroup<T>;

interface ParsedSourceItem<T> extends SessionTreeSourceItem<T> {
  segments: string[] | null;
  sourceRank: number;
}

interface RawGroup<T> {
  id: string;
  segments: string[];
  parent: RawGroup<T> | null;
  childGroups: RawGroup<T>[];
  childItems: ParsedSourceItem<T>[];
  sourceRank: number;
}

function parsePathLabel(label: string | null): string[] | null {
  if (!label) {
    return null;
  }
  const segments = label.split("/");
  if (segments.length < 2 || segments.some((segment) => segment.length === 0)) {
    return null;
  }
  return segments;
}

function pathKey(segments: readonly string[]): string {
  return JSON.stringify(segments);
}

function groupId(segments: readonly string[]): string {
  return `paseo-group:${segments.map(encodeURIComponent).join("/")}`;
}

export function buildSessionTree<T>(
  items: readonly SessionTreeSourceItem<T>[],
): SessionTreeNode<T>[] {
  const parsedItems: ParsedSourceItem<T>[] = items.map((item, sourceRank) => ({
    ...item,
    segments: parsePathLabel(item.pathLabel),
    sourceRank,
  }));

  const prefixCounts = new Map<string, number>();
  const prefixSegments = new Map<string, string[]>();
  for (const item of parsedItems) {
    if (!item.segments) {
      continue;
    }
    for (let depth = 1; depth < item.segments.length; depth += 1) {
      const prefix = item.segments.slice(0, depth);
      const key = pathKey(prefix);
      prefixCounts.set(key, (prefixCounts.get(key) ?? 0) + 1);
      prefixSegments.set(key, prefix);
    }
  }

  const groupsByKey = new Map<string, RawGroup<T>>();
  for (const [key, count] of prefixCounts) {
    const segments = prefixSegments.get(key);
    if (count >= 2 && segments) {
      groupsByKey.set(key, {
        id: groupId(segments),
        segments,
        parent: null,
        childGroups: [],
        childItems: [],
        sourceRank: Number.POSITIVE_INFINITY,
      });
    }
  }

  const rawGroups = [...groupsByKey.values()].sort(
    (left, right) => left.segments.length - right.segments.length,
  );
  const rootGroups: RawGroup<T>[] = [];
  for (const group of rawGroups) {
    for (let depth = group.segments.length - 1; depth > 0; depth -= 1) {
      const parent = groupsByKey.get(pathKey(group.segments.slice(0, depth)));
      if (parent) {
        group.parent = parent;
        parent.childGroups.push(group);
        break;
      }
    }
    if (!group.parent) {
      rootGroups.push(group);
    }
  }

  const rootItems: ParsedSourceItem<T>[] = [];
  for (const item of parsedItems) {
    let parent: RawGroup<T> | null = null;
    if (item.segments) {
      for (let depth = item.segments.length - 1; depth > 0; depth -= 1) {
        const candidate = groupsByKey.get(pathKey(item.segments.slice(0, depth)));
        if (candidate) {
          parent = candidate;
          break;
        }
      }
    }
    if (parent) {
      parent.childItems.push(item);
    } else {
      rootItems.push(item);
    }
  }

  const populateRanks = (group: RawGroup<T>): number => {
    const ranks = [
      ...group.childItems.map((item) => item.sourceRank),
      ...group.childGroups.map(populateRanks),
    ];
    group.sourceRank = Math.min(...ranks);
    group.childItems.sort((left, right) => left.sourceRank - right.sourceRank);
    group.childGroups.sort((left, right) => left.sourceRank - right.sourceRank);
    return group.sourceRank;
  };
  for (const group of rootGroups) {
    populateRanks(group);
  }

  const leaf = (item: ParsedSourceItem<T>, parentDepth: number): SessionTreeLeaf<T> => ({
    kind: "leaf",
    id: item.id,
    label: item.label,
    displayLabel: item.segments ? item.segments.slice(parentDepth).join("/") : item.label,
    sourceRank: item.sourceRank,
    value: item.value,
  });
  const buildGroup = (group: RawGroup<T>): SessionTreeGroup<T> => {
    const children: SessionTreeNode<T>[] = [
      ...group.childGroups.map(buildGroup),
      ...group.childItems.map((item) => leaf(item, group.segments.length)),
    ].sort((left, right) => left.sourceRank - right.sourceRank);
    return {
      kind: "group",
      id: group.id,
      label: group.segments.at(-1) ?? group.segments.join("/"),
      path: group.segments.join("/"),
      sourceRank: group.sourceRank,
      children,
    };
  };

  return [...rootGroups.map(buildGroup), ...rootItems.map((item) => leaf(item, 0))].sort(
    (left, right) => left.sourceRank - right.sourceRank,
  );
}
