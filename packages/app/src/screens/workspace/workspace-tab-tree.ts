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
  pathLabel: string | null;
  pathSegments: readonly string[] | null;
  parentGroupId: string | null;
  displaySuffix: string;
  sourceRank: number;
}

export interface WorkspaceTabTreeGroup {
  kind: "group";
  /** The shallowest logical group in this visible, possibly compacted, group row. */
  id: string;
  /** IDs of every logical group represented by this compacted group row. */
  groupIds: readonly string[];
  parentGroupId: string | null;
  label: string;
  path: string;
  pathSegments: readonly string[];
  sourceRank: number;
  descendantTabIds: readonly string[];
  children: readonly WorkspaceTabTreeNode[];
}

export type WorkspaceTabTreeNode = WorkspaceTabTreeGroup | WorkspaceTabTreeLeaf;

export interface WorkspaceTabTreeModel {
  roots: readonly WorkspaceTabTreeNode[];
  /** Visible group-row IDs in tree order. */
  groupIds: readonly string[];
  /** Includes aliases for logical groups hidden inside compact group rows. */
  groupsById: ReadonlyMap<string, WorkspaceTabTreeGroup>;
  leavesByTabId: ReadonlyMap<string, WorkspaceTabTreeLeaf>;
}

export interface WorkspaceTabTreeSiblingNodeOrderItem {
  id: string;
  descendantTabIds: readonly string[];
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

export function getWorkspaceTabTreeRowSortableId(
  row: WorkspaceTabTreeRow,
  paneId: string | undefined,
): string {
  return row.kind === "group"
    ? `workspace-tab-tree-row:${paneId ?? "none"}:${row.group.id}`
    : getWorkspaceTabTreeLeafNodeId(row.leaf.tabId);
}

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
const LEAF_ID_PREFIX = "workspace-tab-tree-leaf:";

export function getWorkspaceTabTreeLeafNodeId(tabId: string): string {
  return `${LEAF_ID_PREFIX}${tabId}`;
}

function parsePathLabel(pathLabel: string | null | undefined): string[] | null {
  if (pathLabel == null) return null;
  const segments = pathLabel.split("/");
  if (segments.length < 2 || segments.some((segment) => segment.length === 0)) {
    return null;
  }
  return segments;
}

function pathKey(segments: readonly string[]): string {
  return JSON.stringify(segments);
}

function buildGroupId(segments: readonly string[]): string {
  return `${GROUP_ID_PREFIX}${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function compareTreeNodesBySourceRank(
  left: Pick<WorkspaceTabTreeNode, "sourceRank">,
  right: Pick<WorkspaceTabTreeNode, "sourceRank">,
): number {
  return left.sourceRank - right.sourceRank;
}

function compareRawChildrenBySourceRank(
  left: RawGroup | ParsedWorkspaceTabTreeItem,
  right: RawGroup | ParsedWorkspaceTabTreeItem,
): number {
  return left.sourceRank - right.sourceRank;
}

function isGroupCollapsed(
  group: WorkspaceTabTreeGroup,
  collapsedGroupIds: ReadonlySet<string>,
): boolean {
  return group.groupIds.some((groupId) => collapsedGroupIds.has(groupId));
}

export function buildWorkspaceTabTree(
  items: readonly WorkspaceTabTreeItem[],
): WorkspaceTabTreeModel {
  const seenTabIds = new Set<string>();
  const parsedItems: ParsedWorkspaceTabTreeItem[] = items.map((item, sourceRank) => {
    if (seenTabIds.has(item.tabId)) {
      throw new Error(`Duplicate workspace tab id: ${item.tabId}`);
    }
    seenTabIds.add(item.tabId);
    return {
      ...item,
      pathLabel: item.pathLabel ?? null,
      pathSegments: parsePathLabel(item.pathLabel),
      sourceRank,
    };
  });

  const prefixCounts = new Map<string, number>();
  const prefixSegments = new Map<string, string[]>();
  for (const item of parsedItems) {
    const segments = item.pathSegments;
    if (!segments) continue;
    // Only proper prefixes may become groups. This keeps every leaf suffix non-empty
    // when one label is itself a prefix of another label.
    for (let depth = 1; depth < segments.length; depth += 1) {
      const prefix = segments.slice(0, depth);
      const key = pathKey(prefix);
      prefixCounts.set(key, (prefixCounts.get(key) ?? 0) + 1);
      prefixSegments.set(key, prefix);
    }
  }

  const rawGroupsByKey = new Map<string, RawGroup>();
  const sourceRanksByTabId = new Map(parsedItems.map((item) => [item.tabId, item.sourceRank]));
  for (const [key, count] of prefixCounts) {
    if (count < 2) continue;
    const segments = prefixSegments.get(key);
    if (!segments) continue;
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
    if (parent) {
      parent.childGroups.push(group);
    } else {
      rawRootGroups.push(group);
    }
  }

  const rawRootItems: ParsedWorkspaceTabTreeItem[] = [];
  for (const item of parsedItems) {
    let parent: RawGroup | null = null;
    const segments = item.pathSegments;
    if (segments) {
      for (let depth = segments.length - 1; depth > 0; depth -= 1) {
        const candidate = rawGroupsByKey.get(pathKey(segments.slice(0, depth)));
        if (candidate) {
          parent = candidate;
          break;
        }
      }
    }
    if (parent) {
      parent.childItems.push(item);
    } else {
      rawRootItems.push(item);
    }
  }

  function populateRawGroupRank(group: RawGroup): void {
    for (const child of group.childGroups) populateRawGroupRank(child);
    const descendants = [
      ...group.childItems.map((item) => ({ tabId: item.tabId, rank: item.sourceRank })),
      ...group.childGroups.flatMap((child) =>
        child.descendantTabIds.map((tabId) => ({
          tabId,
          rank: sourceRanksByTabId.get(tabId) ?? Number.MAX_VALUE,
        })),
      ),
    ].sort((left, right) => left.rank - right.rank);
    group.descendantTabIds = descendants.map((item) => item.tabId);
    group.sourceRank = descendants[0]?.rank ?? Number.POSITIVE_INFINITY;
    group.childGroups.sort(compareRawChildrenBySourceRank);
    group.childItems.sort(compareRawChildrenBySourceRank);
  }
  for (const group of rawRootGroups) populateRawGroupRank(group);
  rawRootGroups.sort(compareRawChildrenBySourceRank);

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
      pathLabel: item.pathLabel ?? null,
      pathSegments: item.pathSegments,
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
    const childNodes: WorkspaceTabTreeNode[] = [
      ...deepestGroup.childGroups.map((child) => buildGroup(child, groupId)),
      ...deepestGroup.childItems.map((item) =>
        buildLeaf(item, groupId, deepestGroup.pathSegments.length),
      ),
    ].sort(compareTreeNodesBySourceRank);
    const parentPathDepth = rawGroup.parent?.pathSegments.length ?? 0;
    const group: WorkspaceTabTreeGroup = {
      kind: "group",
      id: groupId,
      groupIds: chain.map((item) => item.id),
      parentGroupId,
      label: deepestGroup.pathSegments.slice(parentPathDepth).join("/"),
      path: deepestGroup.pathSegments.join("/"),
      pathSegments: deepestGroup.pathSegments,
      sourceRank: rawGroup.sourceRank,
      descendantTabIds: rawGroup.descendantTabIds,
      children: childNodes,
    };
    for (const alias of group.groupIds) groupsById.set(alias, group);
    return group;
  }

  const roots: WorkspaceTabTreeNode[] = [
    ...rawRootGroups.map((group) => buildGroup(group, null)),
    ...rawRootItems.map((item) => buildLeaf(item, null, 0)),
  ].sort(compareTreeNodesBySourceRank);

  return {
    roots,
    groupIds: visibleGroupIds,
    groupsById,
    leavesByTabId,
  };
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
    if (collapsed) return;
    for (const child of node.children) visit(child, depth + 1);
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

export function getWorkspaceTabTreeSiblingLeafIds(
  model: WorkspaceTabTreeModel,
  tabId: string,
): string[] {
  const leaf = model.leavesByTabId.get(tabId);
  if (!leaf) return [];
  const nodes = leaf.parentGroupId
    ? (model.groupsById.get(leaf.parentGroupId)?.children ?? [])
    : model.roots;
  return nodes
    .filter((node): node is WorkspaceTabTreeLeaf => node.kind === "leaf")
    .map((node) => node.tabId);
}

export function getWorkspaceTabTreeSiblingNodeOrder(
  model: WorkspaceTabTreeModel,
  tabId: string,
): WorkspaceTabTreeSiblingNodeOrderItem[] {
  const leaf = model.leavesByTabId.get(tabId);
  if (!leaf) return [];
  return getWorkspaceTabTreeNodeOrderForParent(model, leaf.parentGroupId);
}

export function getWorkspaceTabTreeGroupSiblingNodeOrder(
  model: WorkspaceTabTreeModel,
  groupId: string,
): WorkspaceTabTreeSiblingNodeOrderItem[] {
  const group = model.groupsById.get(groupId);
  if (!group) return [];
  return getWorkspaceTabTreeNodeOrderForParent(model, group.parentGroupId);
}

function getWorkspaceTabTreeNodeOrderForParent(
  model: WorkspaceTabTreeModel,
  parentGroupId: string | null,
): WorkspaceTabTreeSiblingNodeOrderItem[] {
  const nodes = parentGroupId ? (model.groupsById.get(parentGroupId)?.children ?? []) : model.roots;
  return nodes.map((node) =>
    node.kind === "leaf"
      ? { id: getWorkspaceTabTreeLeafNodeId(node.tabId), descendantTabIds: [node.tabId] }
      : { id: node.id, descendantTabIds: node.descendantTabIds },
  );
}

export function reorderWorkspaceTabTreeSiblingNodes(
  sourceTabIds: string[],
  siblingNodes: readonly WorkspaceTabTreeSiblingNodeOrderItem[],
  activeNodeId: string,
  overNodeId: string,
  edge: "before" | "after",
): string[] {
  const activeIndex = siblingNodes.findIndex((node) => node.id === activeNodeId);
  const overIndex = siblingNodes.findIndex((node) => node.id === overNodeId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) return sourceTabIds;

  const nextNodes = [...siblingNodes];
  const [activeNode] = nextNodes.splice(activeIndex, 1);
  const overIndexAfterRemoval = nextNodes.findIndex((node) => node.id === overNodeId);
  const insertionIndex = edge === "before" ? overIndexAfterRemoval : overIndexAfterRemoval + 1;
  nextNodes.splice(insertionIndex, 0, activeNode!);
  if (nextNodes.every((node, index) => node.id === siblingNodes[index]?.id)) return sourceTabIds;

  const siblingTabIds = siblingNodes.flatMap((node) => node.descendantTabIds);
  const siblingSet = new Set(siblingTabIds);
  if (siblingSet.size !== siblingTabIds.length) return sourceTabIds;
  const sourceSlots = sourceTabIds
    .map((tabId, index) => (siblingSet.has(tabId) ? index : -1))
    .filter((index) => index >= 0);
  if (sourceSlots.length !== siblingTabIds.length) return sourceTabIds;

  const nextSiblingTabIds = nextNodes.flatMap((node) => node.descendantTabIds);
  const nextTabIds = [...sourceTabIds];
  let changed = false;
  for (let index = 0; index < sourceSlots.length; index += 1) {
    const sourceIndex = sourceSlots[index]!;
    const nextTabId = nextSiblingTabIds[index]!;
    if (nextTabIds[sourceIndex] !== nextTabId) changed = true;
    nextTabIds[sourceIndex] = nextTabId;
  }
  return changed ? nextTabIds : sourceTabIds;
}

export function reorderWorkspaceTabTreeSiblingLeaves(
  sourceTabIds: string[],
  model: WorkspaceTabTreeModel,
  activeTabId: string,
  overTabId: string,
  edge: "before" | "after",
): string[] {
  const active = model.leavesByTabId.get(activeTabId);
  const over = model.leavesByTabId.get(overTabId);
  if (!active || !over || active.parentGroupId !== over.parentGroupId) return sourceTabIds;

  return reorderWorkspaceTabTreeSiblingNodes(
    sourceTabIds,
    getWorkspaceTabTreeSiblingNodeOrder(model, activeTabId),
    getWorkspaceTabTreeLeafNodeId(activeTabId),
    getWorkspaceTabTreeLeafNodeId(overTabId),
    edge,
  );
}

export function reorderWorkspaceTabTreeLeafAroundSiblingGroup(
  sourceTabIds: string[],
  model: WorkspaceTabTreeModel,
  activeTabId: string,
  groupId: string,
  edge: "before" | "after",
): string[] {
  const active = model.leavesByTabId.get(activeTabId);
  const group = model.groupsById.get(groupId);
  if (!active || !group || active.parentGroupId !== group.parentGroupId) return sourceTabIds;
  return reorderWorkspaceTabTreeSiblingNodes(
    sourceTabIds,
    getWorkspaceTabTreeSiblingNodeOrder(model, activeTabId),
    getWorkspaceTabTreeLeafNodeId(activeTabId),
    group.id,
    edge,
  );
}

export function moveWorkspaceTabTreeLeafToSiblingEdge(
  sourceTabIds: string[],
  model: WorkspaceTabTreeModel,
  tabId: string,
  edge: "start" | "end",
): string[] {
  const siblingNodes = getWorkspaceTabTreeSiblingNodeOrder(model, tabId);
  const activeNodeId = getWorkspaceTabTreeLeafNodeId(tabId);
  const targetNode = edge === "start" ? siblingNodes[0] : siblingNodes.at(-1);
  if (!targetNode) return sourceTabIds;
  return reorderWorkspaceTabTreeSiblingNodes(
    sourceTabIds,
    siblingNodes,
    activeNodeId,
    targetNode.id,
    edge === "start" ? "before" : "after",
  );
}

export function moveWorkspaceTabTreeGroupToSiblingEdge(
  sourceTabIds: string[],
  model: WorkspaceTabTreeModel,
  groupId: string,
  edge: "start" | "end",
): string[] {
  const group = model.groupsById.get(groupId);
  if (!group || group.id !== groupId) return sourceTabIds;
  const siblingNodes = getWorkspaceTabTreeGroupSiblingNodeOrder(model, groupId);
  const targetNode = edge === "start" ? siblingNodes[0] : siblingNodes.at(-1);
  if (!targetNode) return sourceTabIds;
  return reorderWorkspaceTabTreeSiblingNodes(
    sourceTabIds,
    siblingNodes,
    groupId,
    targetNode.id,
    edge === "start" ? "before" : "after",
  );
}

export function getWorkspaceTabTreeSiblingLeafIdsBefore(
  model: WorkspaceTabTreeModel,
  tabId: string,
): string[] {
  const siblings = getWorkspaceTabTreeSiblingLeafIds(model, tabId);
  const index = siblings.indexOf(tabId);
  return index < 0 ? [] : siblings.slice(0, index);
}

export function getWorkspaceTabTreeSiblingLeafIdsAfter(
  model: WorkspaceTabTreeModel,
  tabId: string,
): string[] {
  const siblings = getWorkspaceTabTreeSiblingLeafIds(model, tabId);
  const index = siblings.indexOf(tabId);
  return index < 0 ? [] : siblings.slice(index + 1);
}
