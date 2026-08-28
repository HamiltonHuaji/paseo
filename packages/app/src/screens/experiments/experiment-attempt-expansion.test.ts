import { describe, expect, it } from "vitest";
import { resolveAttemptExpanded } from "./experiment-attempt-expansion";

describe("resolveAttemptExpanded", () => {
  it("expands only the latest attempt by default", () => {
    expect(resolveAttemptExpanded("attempt-1", "attempt-2", {})).toBe(false);
    expect(resolveAttemptExpanded("attempt-2", "attempt-2", {})).toBe(true);
  });

  it("keeps temporary user overrides when the selected experiment changes", () => {
    const remembered = { "attempt-1": true, "attempt-2": false };

    expect(resolveAttemptExpanded("attempt-1", "attempt-2", remembered)).toBe(true);
    expect(resolveAttemptExpanded("attempt-2", "attempt-2", remembered)).toBe(false);
  });
});
