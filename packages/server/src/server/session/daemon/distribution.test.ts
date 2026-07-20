import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { OFFICIAL_PASEO_DISTRIBUTION, resolveDaemonDistributionFrom } from "./distribution.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createPackageTree(): { packageRoot: string; serverModulePath: string } {
  const packageRoot = mkdtempSync(path.join(tmpdir(), "paseo-distribution-"));
  temporaryDirectories.push(packageRoot);
  const serverModulePath = path.join(
    packageRoot,
    "node_modules",
    "@getpaseo",
    "server",
    "dist",
    "server",
    "session",
    "daemon",
    "distribution.js",
  );
  mkdirSync(path.dirname(serverModulePath), { recursive: true });
  writeFileSync(serverModulePath, "");
  return { packageRoot, serverModulePath };
}

describe("resolveDaemonDistributionFrom", () => {
  test("uses the official npm package when no distribution manifest is present", () => {
    const { serverModulePath } = createPackageTree();

    expect(resolveDaemonDistributionFrom(serverModulePath)).toEqual(OFFICIAL_PASEO_DISTRIBUTION);
  });

  test("finds a fork distribution manifest above the bundled server", () => {
    const { packageRoot, serverModulePath } = createPackageTree();
    writeFileSync(
      path.join(packageRoot, "paseo-distribution.json"),
      JSON.stringify({
        schemaVersion: 1,
        packageName: "@hamiltonhuaji/paseo-fork",
        version: "0.1.110-fork.2",
        serverVersion: "0.1.110",
        installSpec:
          "https://github.com/HamiltonHuaji/paseo/releases/latest/download/paseo-fork.tgz",
      }),
    );

    expect(resolveDaemonDistributionFrom(serverModulePath)).toEqual({
      kind: "bundled",
      packageName: "@hamiltonhuaji/paseo-fork",
      version: "0.1.110-fork.2",
      serverVersion: "0.1.110",
      installSpec: "https://github.com/HamiltonHuaji/paseo/releases/latest/download/paseo-fork.tgz",
      packageRoot,
    });
  });

  test("rejects an invalid distribution manifest instead of falling back to official", () => {
    const { packageRoot, serverModulePath } = createPackageTree();
    writeFileSync(
      path.join(packageRoot, "paseo-distribution.json"),
      JSON.stringify({ schemaVersion: 1, packageName: "@hamiltonhuaji/paseo-fork" }),
    );

    expect(() => resolveDaemonDistributionFrom(serverModulePath)).toThrow(
      "Invalid Paseo distribution manifest",
    );
  });

  test("reports malformed JSON as an invalid distribution rather than a parser failure", () => {
    const { packageRoot, serverModulePath } = createPackageTree();
    writeFileSync(path.join(packageRoot, "paseo-distribution.json"), "{");

    expect(() => resolveDaemonDistributionFrom(serverModulePath)).toThrow(
      "Invalid Paseo distribution manifest",
    );
  });
});
