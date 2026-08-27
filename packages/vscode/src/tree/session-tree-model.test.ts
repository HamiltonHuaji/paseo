import { describe, expect, test } from "vitest";
import { buildSessionTree } from "./session-tree-model";

describe("buildSessionTree", () => {
  test("groups common multi-level path prefixes without inventing singleton folders", () => {
    const tree = buildSessionTree([
      { id: "a", label: "experiments/fa4/x", pathLabel: "experiments/fa4/x", value: "a" },
      { id: "b", label: "experiments/fa4/y", pathLabel: "experiments/fa4/y", value: "b" },
      { id: "c", label: "notes/one-off", pathLabel: "notes/one-off", value: "c" },
    ]);

    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({ kind: "group", label: "experiments" });
    if (tree[0]?.kind !== "group") {
      throw new Error("expected group");
    }
    expect(tree[0].children[0]).toMatchObject({ kind: "group", label: "fa4" });
    expect(tree[1]).toMatchObject({ kind: "leaf", displayLabel: "notes/one-off" });
  });

  test("preserves source order between sibling groups and leaves", () => {
    const tree = buildSessionTree([
      { id: "a", label: "plain", pathLabel: null, value: "a" },
      { id: "b", label: "dir/x", pathLabel: "dir/x", value: "b" },
      { id: "c", label: "dir/y", pathLabel: "dir/y", value: "c" },
    ]);
    expect(tree.map((node) => node.kind)).toEqual(["leaf", "group"]);
  });
});
