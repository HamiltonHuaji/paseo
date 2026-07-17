import { describe, expect, it } from "vitest";
import {
  comparePaseoVersions,
  isDaemonVersionBelowBaseline,
  selectDaemonCompatibilityVersion,
} from "./app-version";

describe("daemon compatibility versions", () => {
  it("prefers the upstream base over the fork installer version", () => {
    expect(
      selectDaemonCompatibilityVersion({
        upstreamBaseVersion: "0.1.110",
        appVersion: "0.1.1",
      }),
    ).toBe("0.1.110");
  });

  it("falls back to the app version for builds without fork metadata", () => {
    expect(
      selectDaemonCompatibilityVersion({
        upstreamBaseVersion: null,
        appVersion: "0.1.110",
      }),
    ).toBe("0.1.110");
  });

  it("compares stable and prerelease versions", () => {
    expect(comparePaseoVersions("v0.1.111", "0.1.110")).toBeGreaterThan(0);
    expect(comparePaseoVersions("0.1.110-beta.2", "0.1.110-beta.1")).toBeGreaterThan(0);
    expect(comparePaseoVersions("0.1.110-beta.2", "0.1.110")).toBeLessThan(0);
    expect(comparePaseoVersions("invalid", "0.1.110")).toBeNull();
  });

  it("only flags daemons older than the official compatibility baseline", () => {
    expect(isDaemonVersionBelowBaseline("0.1.110", "0.1.109")).toBe(true);
    expect(isDaemonVersionBelowBaseline("0.1.110", "0.1.110")).toBe(false);
    expect(isDaemonVersionBelowBaseline("0.1.110", "0.1.111")).toBe(false);
    expect(isDaemonVersionBelowBaseline("0.1.110", null)).toBe(false);
  });
});
