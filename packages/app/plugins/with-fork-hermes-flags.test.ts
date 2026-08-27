import { describe, expect, it } from "vitest";

const { configureForkHermesFlags } = require("./with-fork-hermes-flags");

describe("withForkHermesFlags", () => {
  it("keeps source maps but removes release bytecode optimization", () => {
    const source = ["android {", "}", "", "react {", '    entryFile = file("index.js")', "}"].join(
      "\n",
    );
    const configured = configureForkHermesFlags(source);

    expect(configured).toContain('react {\n    hermesFlags = ["-O0", "-output-source-map"]');
    expect(configured).not.toContain('"-O",');
    expect(configureForkHermesFlags(configured)).toBe(configured);
  });

  it("fails when the React Native Gradle block is missing", () => {
    expect(() => configureForkHermesFlags("android {\n}")).toThrow(
      "Could not configure fork Hermes flags",
    );
  });
});
