import { describe, expect, it } from "vitest";
import { buildVerticalTabLabelPresentations } from "@/screens/workspace/workspace-vertical-tab-presentation";

describe("buildVerticalTabLabelPresentations", () => {
  it("compacts the deepest path prefix shared by agent and terminal titles", () => {
    const presentations = buildVerticalTabLabelPresentations([
      { key: "one", kind: "agent", label: "experiments/fa4/one", ready: true },
      { key: "notes", kind: "agent", label: "notes", ready: true },
      { key: "two", kind: "terminal", label: "experiments/fa4/two", ready: true },
      { key: "root", kind: "agent", label: "experiments/root", ready: true },
    ]);

    expect([...presentations.entries()]).toEqual([
      ["one", { pathPrefix: "experiments/fa4/", label: "one" }],
      ["two", { pathPrefix: "experiments/fa4/", label: "two" }],
      ["root", { pathPrefix: "experiments/", label: "root" }],
    ]);
  });

  it("uses parent paths to distinguish identical leaf titles", () => {
    const presentations = buildVerticalTabLabelPresentations([
      { key: "train", kind: "agent", label: "training/results", ready: true },
      { key: "eval", kind: "agent", label: "evaluation/results", ready: true },
    ]);

    expect([...presentations.entries()]).toEqual([
      ["train", { pathPrefix: "training/", label: "results" }],
      ["eval", { pathPrefix: "evaluation/", label: "results" }],
    ]);
  });

  it("leaves unrelated and ineligible labels unchanged", () => {
    const presentations = buildVerticalTabLabelPresentations([
      { key: "solo", kind: "agent", label: "solo/path", ready: true },
      { key: "file-one", kind: "file", label: "src/one", ready: true },
      { key: "file-two", kind: "file", label: "src/two", ready: true },
      { key: "loading-one", kind: "agent", label: "jobs/one", ready: false },
      { key: "loading-two", kind: "agent", label: "jobs/two", ready: true },
      { key: "invalid-one", kind: "agent", label: "bad//one", ready: true },
      { key: "invalid-two", kind: "agent", label: "bad//two", ready: true },
    ]);

    expect([...presentations.entries()]).toEqual([]);
  });
});
