export interface WorkspaceTabTreeItem {
  tabId: string;
  label: string;
  /** Set only for tab kinds whose labels are allowed to participate in path grouping. */
  pathLabel?: string | null;
}

interface ParsedWorkspaceTabTreeItem extends WorkspaceTabTreeItem {
  pathSegments: string[] | null;
  sourceRank: number;
}

export interface WorkspaceTabTreeLeaf {
  kind: "leaf";
  tabId: string;
  label: string;
  parentGroupId: string | null;
  displaySuffix: string;
  sourceRank: number;
}

export interface WorkspaceTabTreeGroup {
  kind: "group";
  /** The shallowest logical group represented by this possibly compacted row. */
  id: string;
  /** Includes logical groups compacted into this visible row. */
  groupIds: readonly string[];
  parentGroupId: string | null;
  label: string;
  path: string;
  sourceRank: number;
  descendantTabIds: readonly string[];
  children: readonly WorkspaceTabTreeNode[];
}

export type WorkspaceTabTreeNode = WorkspaceTabTreeGroup | WorkspaceTabTreeLeaf;

export interface WorkspaceTabTreeModel {
  roots: readonly WorkspaceTabTreeNode[];
  groupIds: readonly string[];
  groupsById: ReadonlyMap<string, WorkspaceTabTreeGroup>;
  leavesByTabId: ReadonlyMap<string, WorkspaceTabTreeLeaf>;
}

export type WorkspaceTabTreeRow =
  | {
      kind: "group";
      depth: number;
      collapsed: boolean;
      group: WorkspaceTabTreeGroup;
    }
  | {
      kind: "leaf";
      depth: number;
      leaf: WorkspaceTabTreeLeaf;
    };

interface RawGroup {
  id: string;
  pathSegments: string[];
  parent: RawGroup | null;
  childGroups: RawGroup[];
  childItems: ParsedWorkspaceTabTreeItem[];
  sourceRank: number;
  descendantTabIds: string[];
}

const GROUP_ID_PREFIX = "workspace-tab-group:";

function parsePathLabel(pathLabel: string | null | undefined): string[] | null {
  if (pathLabel == null) return null;
  const segments = pathLabel.split("/");
  if (segments.length < 2 || segments.some((segment) => segment.length === 0)) return null;
  return segments;
}

function pathKey(segments: readonly string[]): string {
  return JSON.stringify(segments);
}

function buildGroupId(segments: readonly string[]): string {
  return `${GROUP_ID_PREFIX}${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function compareBySourceRank(
  left: Pick<WorkspaceTabTreeNode, "sourceRank">,
  right: Pick<WorkspaceTabTreeNode, "sourceRank">,
): number {
  return left.sourceRank - right.sourceRank;
}

function isGroupCollapsed(
  group: WorkspaceTabTreeGroup,
  collapsedGroupIds: ReadonlySet<string>,
): boolean {
  return group.groupIds.some((groupId) => collapsedGroupIds.has(groupId));
}

/**
 * Groups only prefixes shared by at least two eligible tabs. A one-off slash in a title stays a
 * title instead of creating a folder with a single child.
 */
export function buildWorkspaceTabTree(
  items: readonly WorkspaceTabTreeItem[],
): WorkspaceTabTreeModel {
  const parsedItems: ParsedWorkspaceTabTreeItem[] = items.map((item, sourceRank) => ({
    ...item,
    pathSegments: parsePathLabel(item.pathLabel),
    sourceRank,
  }));

  const prefixCounts = new Map<string, number>();
  const prefixSegments = new Map<string, string[]>();
  for (const item of parsedItems) {
    if (!item.pathSegments) continue;
    for (let depth = 1; depth < item.pathSegments.length; depth += 1) {
      const prefix = item.pathSegments.slice(0, depth);
      const key = pathKey(prefix);
      prefixCounts.set(key, (prefixCounts.get(key) ?? 0) + 1);
      prefixSegments.set(key, prefix);
    }
  }

  const rawGroupsByKey = new Map<string, RawGroup>();
  for (const [key, count] of prefixCounts) {
    const segments = prefixSegments.get(key);
    if (count < 2 || !segments) continue;
    rawGroupsByKey.set(key, {
      id: buildGroupId(segments),
      pathSegments: segments,
      parent: null,
      childGroups: [],
      childItems: [],
      sourceRank: Number.POSITIVE_INFINITY,
      descendantTabIds: [],
    });
  }

  const rawGroups = [...rawGroupsByKey.values()].sort(
    (left, right) => left.pathSegments.length - right.pathSegments.length,
  );
  const rawRootGroups: RawGroup[] = [];
  for (const group of rawGroups) {
    let parent: RawGroup | null = null;
    for (let depth = group.pathSegments.length - 1; depth > 0; depth -= 1) {
      const candidate = rawGroupsByKey.get(pathKey(group.pathSegments.slice(0, depth)));
      if (candidate) {
        parent = candidate;
        break;
      }
    }
    group.parent = parent;
    if (parent) parent.childGroups.push(group);
    else rawRootGroups.push(group);
  }

  const rawRootItems: ParsedWorkspaceTabTreeItem[] = [];
  for (const item of parsedItems) {
    let parent: RawGroup | null = null;
    if (item.pathSegments) {
      for (let depth = item.pathSegments.length - 1; depth > 0; depth -= 1) {
        const candidate = rawGroupsByKey.get(pathKey(item.pathSegments.slice(0, depth)));
        if (candidate) {
          parent = candidate;
          break;
        }
      }
    }
    if (parent) parent.childItems.push(item);
    else rawRootItems.push(item);
  }

  function populateRawGroup(group: RawGroup): void {
    for (const child of group.childGroups) populateRawGroup(child);
    const descendants = [
      ...group.childItems.map((item) => ({ tabId: item.tabId, rank: item.sourceRank })),
      ...group.childGroups.flatMap((child) =>
        child.descendantTabIds.map((tabId) => ({ tabId, rank: child.sourceRank })),
      ),
    ].sort((left, right) => left.rank - right.rank);
    group.descendantTabIds = descendants.map((item) => item.tabId);
    group.sourceRank = descendants[0]?.rank ?? Number.POSITIVE_INFINITY;
    group.childGroups.sort(compareBySourceRank);
    group.childItems.sort(compareBySourceRank);
  }
  for (const group of rawRootGroups) populateRawGroup(group);
  rawRootGroups.sort(compareBySourceRank);

  const groupsById = new Map<string, WorkspaceTabTreeGroup>();
  const leavesByTabId = new Map<string, WorkspaceTabTreeLeaf>();
  const visibleGroupIds: string[] = [];

  function buildLeaf(
    item: ParsedWorkspaceTabTreeItem,
    parentGroupId: string | null,
    parentPathDepth: number,
  ): WorkspaceTabTreeLeaf {
    const leaf: WorkspaceTabTreeLeaf = {
      kind: "leaf",
      tabId: item.tabId,
      label: item.label,
      parentGroupId,
      displaySuffix: item.pathSegments
        ? item.pathSegments.slice(parentPathDepth).join("/")
        : item.label,
      sourceRank: item.sourceRank,
    };
    leavesByTabId.set(leaf.tabId, leaf);
    return leaf;
  }

  function buildGroup(rawGroup: RawGroup, parentGroupId: string | null): WorkspaceTabTreeGroup {
    const chain = [rawGroup];
    let deepestGroup = rawGroup;
    while (deepestGroup.childItems.length === 0 && deepestGroup.childGroups.length === 1) {
      deepestGroup = deepestGroup.childGroups[0]!;
      chain.push(deepestGroup);
    }

    const groupId = rawGroup.id;
    visibleGroupIds.push(groupId);
    const children: WorkspaceTabTreeNode[] = [
      ...deepestGroup.childGroups.map((child) => buildGroup(child, groupId)),
      ...deepestGroup.childItems.map((item) =>
        buildLeaf(item, groupId, deepestGroup.pathSegments.length),
      ),
    ].sort(compareBySourceRank);
    const parentPathDepth = rawGroup.parent?.pathSegments.length ?? 0;
    const group: WorkspaceTabTreeGroup = {
      kind: "group",
      id: groupId,
      groupIds: chain.map((item) => item.id),
      parentGroupId,
      label: deepestGroup.pathSegments.slice(parentPathDepth).join("/"),
      path: deepestGroup.pathSegments.join("/"),
      sourceRank: rawGroup.sourceRank,
      descendantTabIds: rawGroup.descendantTabIds,
      children,
    };
    for (const alias of group.groupIds) groupsById.set(alias, group);
    return group;
  }

  const roots: WorkspaceTabTreeNode[] = [
    ...rawRootGroups.map((group) => buildGroup(group, null)),
    ...rawRootItems.map((item) => buildLeaf(item, null, 0)),
  ].sort(compareBySourceRank);

  return { roots, groupIds: visibleGroupIds, groupsById, leavesByTabId };
}

export function projectWorkspaceTabTree(
  model: WorkspaceTabTreeModel,
  collapsedGroupIds: ReadonlySet<string>,
): WorkspaceTabTreeRow[] {
  const rows: WorkspaceTabTreeRow[] = [];

  function visit(node: WorkspaceTabTreeNode, depth: number): void {
    if (node.kind === "leaf") {
      rows.push({ kind: "leaf", depth, leaf: node });
      return;
    }
    const collapsed = isGroupCollapsed(node, collapsedGroupIds);
    rows.push({ kind: "group", depth, collapsed, group: node });
    if (!collapsed) {
      for (const child of node.children) visit(child, depth + 1);
    }
  }

  for (const root of model.roots) visit(root, 0);
  return rows;
}

export function getWorkspaceTabTreeAncestorGroupIds(
  model: WorkspaceTabTreeModel,
  tabId: string,
): string[] {
  const ancestors: string[] = [];
  let groupId = model.leavesByTabId.get(tabId)?.parentGroupId ?? null;
  while (groupId) {
    const group = model.groupsById.get(groupId);
    if (!group) break;
    ancestors.push(...group.groupIds.toReversed());
    groupId = group.parentGroupId;
  }
  return ancestors.toReversed();
}
