import { describe, expect, it } from "vitest";
import {
  buildWorkspaceTabTree,
  getWorkspaceTabTreeAncestorGroupIds,
  projectWorkspaceTabTree,
} from "@/screens/workspace/workspace-tab-tree";

const groupId = (path: string) =>
  `workspace-tab-group:${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;

describe("workspace tab tree", () => {
  it("groups non-adjacent tabs by shared title paths", () => {
    const model = buildWorkspaceTabTree([
      { tabId: "b", label: "experiments/b", pathLabel: "experiments/b" },
      { tabId: "notes", label: "notes" },
      { tabId: "a", label: "experiments/a", pathLabel: "experiments/a" },
    ]);

    expect(model.roots.map((node) => (node.kind === "group" ? node.path : node.tabId))).toEqual([
      "experiments",
      "notes",
    ]);
    expect(model.leavesByTabId.get("a")).toMatchObject({
      parentGroupId: groupId("experiments"),
      displaySuffix: "a",
    });
  });

  it("leaves one-off, invalid, and ineligible paths as ordinary labels", () => {
    const model = buildWorkspaceTabTree([
      { tabId: "solo", label: "solo/path", pathLabel: "solo/path" },
      { tabId: "plain", label: "src/file" },
      { tabId: "invalid-a", label: "bad//a", pathLabel: "bad//a" },
      { tabId: "invalid-b", label: "bad//b", pathLabel: "bad//b" },
    ]);

    expect(model.groupIds).toEqual([]);
    expect(model.roots.every((node) => node.kind === "leaf")).toBe(true);
    expect(model.leavesByTabId.get("solo")?.displaySuffix).toBe("solo/path");
    expect(model.leavesByTabId.get("plain")?.displaySuffix).toBe("src/file");
  });

  it("compacts a single-child group chain but retains its logical ancestors", () => {
    const model = buildWorkspaceTabTree([
      { tabId: "c", label: "experiments/fa4/c", pathLabel: "experiments/fa4/c" },
      { tabId: "d", label: "experiments/fa4/d", pathLabel: "experiments/fa4/d" },
    ]);
    const group = model.roots[0];

    expect(group).toMatchObject({
      kind: "group",
      label: "experiments/fa4",
      path: "experiments/fa4",
      groupIds: [groupId("experiments"), groupId("experiments/fa4")],
    });
    expect(getWorkspaceTabTreeAncestorGroupIds(model, "c")).toEqual([
      groupId("experiments"),
      groupId("experiments/fa4"),
    ]);
  });

  it("projects nested rows with explicit depth and honors collapsed aliases", () => {
    const model = buildWorkspaceTabTree([
      { tabId: "c", label: "a/b/c", pathLabel: "a/b/c" },
      { tabId: "x", label: "a/x", pathLabel: "a/x" },
      { tabId: "d", label: "a/b/d", pathLabel: "a/b/d" },
      { tabId: "plain", label: "plain" },
    ]);

    expect(
      projectWorkspaceTabTree(model, new Set()).map((row) =>
        row.kind === "group"
          ? `group:${row.group.label}:${row.depth}`
          : `leaf:${row.leaf.displaySuffix}:${row.depth}`,
      ),
    ).toEqual(["group:a:0", "group:b:1", "leaf:c:2", "leaf:d:2", "leaf:x:1", "leaf:plain:0"]);

    expect(
      projectWorkspaceTabTree(model, new Set([groupId("a/b")])).map((row) =>
        row.kind === "group" ? row.group.path : row.leaf.tabId,
      ),
    ).toEqual(["a", "a/b", "x", "plain"]);
  });
});
