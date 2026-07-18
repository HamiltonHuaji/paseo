import { describe, expect, it } from "vitest";
import {
  buildWorkspaceTabTree,
  getWorkspaceTabTreeAncestorGroupIds,
  getWorkspaceTabTreeGroupSiblingNodeOrder,
  getWorkspaceTabTreeSiblingLeafIds,
  getWorkspaceTabTreeSiblingLeafIdsAfter,
  getWorkspaceTabTreeSiblingLeafIdsBefore,
  getWorkspaceTabTreeRowSortableId,
  moveWorkspaceTabTreeLeafToSiblingEdge,
  moveWorkspaceTabTreeGroupToSiblingEdge,
  projectWorkspaceTabTree,
  reorderWorkspaceTabTreeLeafAroundSiblingGroup,
  reorderWorkspaceTabTreeSiblingNodes,
  reorderWorkspaceTabTreeSiblingLeaves,
  type WorkspaceTabTreeGroup,
} from "@/screens/workspace/workspace-tab-tree";

const groupId = (path: string) =>
  `workspace-tab-group:${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

function rootGroup(model: ReturnType<typeof buildWorkspaceTabTree>): WorkspaceTabTreeGroup {
  const group = model.roots.find((node) => node.kind === "group");
  if (!group || group.kind !== "group") throw new Error("Expected root group");
  return group;
}

describe("buildWorkspaceTabTree", () => {
  it("globally groups non-adjacent eligible paths while retaining source rank ordering", () => {
    const model = buildWorkspaceTabTree([
      { tabId: "exp-b", label: "experiments/b", pathLabel: "experiments/b" },
      { tabId: "notes", label: "notes" },
      { tabId: "exp-a", label: "experiments/a", pathLabel: "experiments/a" },
      { tabId: "other", label: "other" },
    ]);

    expect(model.roots.map((node) => (node.kind === "group" ? node.path : node.tabId))).toEqual([
      "experiments",
      "notes",
      "other",
    ]);
    const group = rootGroup(model);
    expect(group.sourceRank).toBe(0);
    expect(group.descendantTabIds).toEqual(["exp-b", "exp-a"]);
    expect(group.children.map((node) => (node.kind === "leaf" ? node.tabId : node.id))).toEqual([
      "exp-b",
      "exp-a",
    ]);
    expect(model.leavesByTabId.get("exp-a")).toMatchObject({
      parentGroupId: groupId("experiments"),
      displaySuffix: "a",
      sourceRank: 2,
    });
  });

  it("groups only explicitly eligible, valid path labels", () => {
    const model = buildWorkspaceTabTree([
      { tabId: "plain-path", label: "alpha/one" },
      { tabId: "empty-middle", label: "alpha//two", pathLabel: "alpha//two" },
      { tabId: "leading", label: "/alpha/three", pathLabel: "/alpha/three" },
      { tabId: "trailing", label: "alpha/four/", pathLabel: "alpha/four/" },
      { tabId: "valid", label: "alpha/five", pathLabel: "alpha/five" },
    ]);

    expect(model.groupIds).toEqual([]);
    expect(model.roots.every((node) => node.kind === "leaf")).toBe(true);
    expect(model.leavesByTabId.get("plain-path")?.displaySuffix).toBe("alpha/one");
    expect(model.leavesByTabId.get("empty-middle")?.pathSegments).toBeNull();
    expect(model.leavesByTabId.get("leading")?.pathSegments).toBeNull();
    expect(model.leavesByTabId.get("trailing")?.pathSegments).toBeNull();
  });

  it("requires two descendants and treats path segments as case-sensitive", () => {
    const model = buildWorkspaceTabTree([
      { tabId: "upper", label: "Experiments/a", pathLabel: "Experiments/a" },
      { tabId: "lower", label: "experiments/b", pathLabel: "experiments/b" },
      { tabId: "other-lower", label: "experiments/c", pathLabel: "experiments/c" },
      { tabId: "solo", label: "solo/path", pathLabel: "solo/path" },
    ]);

    expect(model.groupIds).toEqual([groupId("experiments")]);
    expect(model.leavesByTabId.get("upper")?.parentGroupId).toBeNull();
    expect(model.leavesByTabId.get("solo")?.parentGroupId).toBeNull();
  });

  it("compacts a chain of single-child groups and preserves every logical group id", () => {
    const model = buildWorkspaceTabTree([
      { tabId: "c", label: "experiments/fa4/c", pathLabel: "experiments/fa4/c" },
      { tabId: "d", label: "experiments/fa4/d", pathLabel: "experiments/fa4/d" },
    ]);

    const group = rootGroup(model);
    expect(group).toMatchObject({
      id: groupId("experiments"),
      groupIds: [groupId("experiments"), groupId("experiments/fa4")],
      label: "experiments/fa4",
      path: "experiments/fa4",
      parentGroupId: null,
    });
    expect(model.groupIds).toEqual([groupId("experiments")]);
    expect(model.groupsById.get(groupId("experiments/fa4"))).toBe(group);
    expect(getWorkspaceTabTreeAncestorGroupIds(model, "c")).toEqual([
      groupId("experiments"),
      groupId("experiments/fa4"),
    ]);
    expect(model.leavesByTabId.get("c")).toMatchObject({
      parentGroupId: group.id,
      displaySuffix: "c",
    });
  });

  it("retains nested groups when their parent has more than one child", () => {
    const model = buildWorkspaceTabTree([
      { tabId: "c", label: "experiments/fa4/c", pathLabel: "experiments/fa4/c" },
      { tabId: "x", label: "experiments/x", pathLabel: "experiments/x" },
      { tabId: "d", label: "experiments/fa4/d", pathLabel: "experiments/fa4/d" },
    ]);

    const experiments = rootGroup(model);
    const fa4 = experiments.children.find((node) => node.kind === "group");
    expect(experiments.label).toBe("experiments");
    expect(fa4).toMatchObject({
      kind: "group",
      id: groupId("experiments/fa4"),
      parentGroupId: experiments.id,
      label: "fa4",
    });
    expect(model.leavesByTabId.get("x")).toMatchObject({
      parentGroupId: experiments.id,
      displaySuffix: "x",
    });
    expect(getWorkspaceTabTreeAncestorGroupIds(model, "c")).toEqual([
      experiments.id,
      groupId("experiments/fa4"),
    ]);
  });

  it("does not create an empty leaf suffix when one label prefixes another", () => {
    const model = buildWorkspaceTabTree([
      { tabId: "parent", label: "a/b", pathLabel: "a/b" },
      { tabId: "child", label: "a/b/c", pathLabel: "a/b/c" },
    ]);

    expect(model.groupIds).toEqual([groupId("a")]);
    expect(model.leavesByTabId.get("parent")?.displaySuffix).toBe("b");
    expect(model.leavesByTabId.get("child")?.displaySuffix).toBe("b/c");
  });

  it("supports duplicate labels but rejects duplicate tab ids", () => {
    const model = buildWorkspaceTabTree([
      { tabId: "one", label: "a/b", pathLabel: "a/b" },
      { tabId: "two", label: "a/b", pathLabel: "a/b" },
    ]);
    expect(rootGroup(model).children).toHaveLength(2);
    expect(() =>
      buildWorkspaceTabTree([
        { tabId: "same", label: "a" },
        { tabId: "same", label: "b" },
      ]),
    ).toThrow("Duplicate workspace tab id: same");
  });
});

describe("projectWorkspaceTabTree", () => {
  const items = [
    { tabId: "c", label: "a/b/c", pathLabel: "a/b/c" },
    { tabId: "x", label: "a/x", pathLabel: "a/x" },
    { tabId: "d", label: "a/b/d", pathLabel: "a/b/d" },
    { tabId: "plain", label: "plain" },
  ];

  it("projects visible rows in preorder with explicit depths", () => {
    const rows = projectWorkspaceTabTree(buildWorkspaceTabTree(items), new Set());
    expect(
      rows.map((row) =>
        row.kind === "group"
          ? `group:${row.group.label}:${row.depth}`
          : `leaf:${row.leaf.displaySuffix}:${row.depth}`,
      ),
    ).toEqual(["group:a:0", "group:b:1", "leaf:c:2", "leaf:d:2", "leaf:x:1", "leaf:plain:0"]);
  });

  it("hides descendants of collapsed groups, including compact group aliases", () => {
    const compactModel = buildWorkspaceTabTree([
      { tabId: "c", label: "a/b/c", pathLabel: "a/b/c" },
      { tabId: "d", label: "a/b/d", pathLabel: "a/b/d" },
    ]);
    const rows = projectWorkspaceTabTree(compactModel, new Set([groupId("a/b")]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "group", collapsed: true });

    const nestedModel = buildWorkspaceTabTree(items);
    const nestedRows = projectWorkspaceTabTree(nestedModel, new Set([groupId("a/b")]));
    expect(
      nestedRows.map((row) => (row.kind === "group" ? row.group.path : row.leaf.tabId)),
    ).toEqual(["a", "a/b", "x", "plain"]);
  });

  it("names same-prefix group rows uniquely across split panes", () => {
    const groupRow = projectWorkspaceTabTree(buildWorkspaceTabTree(items), new Set()).find(
      (row) => row.kind === "group",
    );
    if (!groupRow) throw new Error("Expected group row");
    expect(getWorkspaceTabTreeRowSortableId(groupRow, "left")).not.toBe(
      getWorkspaceTabTreeRowSortableId(groupRow, "right"),
    );
  });
});

describe("workspace tab tree sibling operations", () => {
  const sourceTabIds = ["a", "plain", "b", "other-a", "c", "other-b"];
  const model = buildWorkspaceTabTree([
    { tabId: "a", label: "group/a", pathLabel: "group/a" },
    { tabId: "plain", label: "plain" },
    { tabId: "b", label: "group/b", pathLabel: "group/b" },
    { tabId: "other-a", label: "other/a", pathLabel: "other/a" },
    { tabId: "c", label: "group/c", pathLabel: "group/c" },
    { tabId: "other-b", label: "other/b", pathLabel: "other/b" },
  ]);

  it("reorders only sibling leaf rank slots without moving unrelated tabs", () => {
    expect(reorderWorkspaceTabTreeSiblingLeaves(sourceTabIds, model, "c", "a", "before")).toEqual([
      "c",
      "plain",
      "a",
      "other-a",
      "b",
      "other-b",
    ]);
    expect(reorderWorkspaceTabTreeSiblingLeaves(sourceTabIds, model, "a", "c", "after")).toEqual([
      "b",
      "plain",
      "c",
      "other-a",
      "a",
      "other-b",
    ]);
    expect(reorderWorkspaceTabTreeSiblingLeaves(sourceTabIds, model, "a", "b", "after")).toEqual([
      "b",
      "plain",
      "a",
      "other-a",
      "c",
      "other-b",
    ]);
  });

  it("reorders serialized sibling nodes for the outer drag-and-drop coordinator", () => {
    expect(
      reorderWorkspaceTabTreeSiblingNodes(
        sourceTabIds,
        [
          { id: "group", descendantTabIds: ["a", "b", "c"] },
          { id: "plain", descendantTabIds: ["plain"] },
          { id: "other", descendantTabIds: ["other-a", "other-b"] },
        ],
        "plain",
        "group",
        "before",
      ),
    ).toEqual(["plain", "a", "b", "c", "other-a", "other-b"]);
  });

  it("rejects cross-parent reorders and preserves input identity for no-ops", () => {
    expect(
      reorderWorkspaceTabTreeSiblingLeaves(sourceTabIds, model, "a", "other-a", "before"),
    ).toBe(sourceTabIds);
    expect(reorderWorkspaceTabTreeSiblingLeaves(sourceTabIds, model, "a", "a", "after")).toBe(
      sourceTabIds,
    );
    expect(
      reorderWorkspaceTabTreeSiblingLeaves(sourceTabIds, model, "missing", "a", "before"),
    ).toBe(sourceTabIds);
    expect(reorderWorkspaceTabTreeSiblingLeaves(sourceTabIds, model, "a", "b", "before")).toBe(
      sourceTabIds,
    );
  });

  it("moves a leaf to an edge of all sibling tree nodes", () => {
    expect(moveWorkspaceTabTreeLeafToSiblingEdge(sourceTabIds, model, "b", "start")).toEqual([
      "b",
      "plain",
      "a",
      "other-a",
      "c",
      "other-b",
    ]);
    expect(moveWorkspaceTabTreeLeafToSiblingEdge(sourceTabIds, model, "b", "end")).toEqual([
      "a",
      "plain",
      "c",
      "other-a",
      "b",
      "other-b",
    ]);
    expect(moveWorkspaceTabTreeLeafToSiblingEdge(sourceTabIds, model, "a", "start")).toBe(
      sourceTabIds,
    );
    expect(moveWorkspaceTabTreeLeafToSiblingEdge(sourceTabIds, model, "plain", "start")).toEqual([
      "plain",
      "a",
      "b",
      "c",
      "other-a",
      "other-b",
    ]);
    expect(moveWorkspaceTabTreeLeafToSiblingEdge(sourceTabIds, model, "plain", "end")).toEqual([
      "a",
      "b",
      "c",
      "other-a",
      "other-b",
      "plain",
    ]);
  });

  it("moves a same-parent leaf before or after a folder without changing membership", () => {
    expect(
      reorderWorkspaceTabTreeLeafAroundSiblingGroup(
        sourceTabIds,
        model,
        "plain",
        groupId("group"),
        "before",
      ),
    ).toEqual(["plain", "a", "b", "c", "other-a", "other-b"]);
    expect(
      reorderWorkspaceTabTreeLeafAroundSiblingGroup(
        ["plain", "a", "b", "other-a", "c", "other-b"],
        buildWorkspaceTabTree([
          { tabId: "plain", label: "plain" },
          { tabId: "a", label: "group/a", pathLabel: "group/a" },
          { tabId: "b", label: "group/b", pathLabel: "group/b" },
          { tabId: "other-a", label: "other/a", pathLabel: "other/a" },
          { tabId: "c", label: "group/c", pathLabel: "group/c" },
          { tabId: "other-b", label: "other/b", pathLabel: "other/b" },
        ]),
        "plain",
        groupId("group"),
        "after",
      ),
    ).toEqual(["a", "b", "c", "plain", "other-a", "other-b"]);
    expect(
      reorderWorkspaceTabTreeLeafAroundSiblingGroup(
        sourceTabIds,
        model,
        "a",
        groupId("other"),
        "before",
      ),
    ).toBe(sourceTabIds);
  });

  it("moves a derived folder as one same-parent block without changing hierarchy", () => {
    const siblingNodes = getWorkspaceTabTreeGroupSiblingNodeOrder(model, groupId("other"));
    expect(siblingNodes.map((node) => node.id)).toEqual([
      groupId("group"),
      "workspace-tab-tree-leaf:plain",
      groupId("other"),
    ]);
    const movedOtherToStart = moveWorkspaceTabTreeGroupToSiblingEdge(
      sourceTabIds,
      model,
      groupId("other"),
      "start",
    );
    expect(movedOtherToStart).toEqual(["other-a", "other-b", "a", "b", "c", "plain"]);
    expect(
      moveWorkspaceTabTreeGroupToSiblingEdge(sourceTabIds, model, groupId("group"), "end"),
    ).toEqual(["plain", "other-a", "other-b", "a", "b", "c"]);
    const pathLabels = new Map([
      ["a", "group/a"],
      ["b", "group/b"],
      ["c", "group/c"],
      ["other-a", "other/a"],
      ["other-b", "other/b"],
    ]);
    const movedModel = buildWorkspaceTabTree(
      movedOtherToStart.map((tabId) => ({
        tabId,
        label: pathLabels.get(tabId) ?? tabId,
        pathLabel: pathLabels.get(tabId),
      })),
    );
    expect(movedModel.leavesByTabId.get("a")?.parentGroupId).toBe(groupId("group"));
    expect(movedModel.leavesByTabId.get("other-a")?.parentGroupId).toBe(groupId("other"));
  });

  it("selects close-before and close-after siblings without recursing into folders", () => {
    expect(getWorkspaceTabTreeSiblingLeafIds(model, "b")).toEqual(["a", "b", "c"]);
    expect(getWorkspaceTabTreeSiblingLeafIdsBefore(model, "b")).toEqual(["a"]);
    expect(getWorkspaceTabTreeSiblingLeafIdsAfter(model, "b")).toEqual(["c"]);
    expect(getWorkspaceTabTreeSiblingLeafIds(model, "plain")).toEqual(["plain"]);
    expect(getWorkspaceTabTreeSiblingLeafIdsBefore(model, "plain")).toEqual([]);
    expect(getWorkspaceTabTreeSiblingLeafIdsAfter(model, "plain")).toEqual([]);
  });
});
