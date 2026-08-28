import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { PaseoDaemonDistribution } from "../server/session/daemon/distribution.js";
import { resolveBundledPaseoCliEntrypoint } from "./terminal.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("resolves the CLI from the bundled fork instead of a sibling official package", () => {
  const packageRoot = mkdtempSync(join(tmpdir(), "paseo-bundled-cli-"));
  temporaryDirectories.push(packageRoot);
  const cliEntrypoint = join(packageRoot, "bin", "paseo");
  mkdirSync(join(packageRoot, "bin"));
  writeFileSync(cliEntrypoint, "#!/usr/bin/env node\n");

  const distribution: PaseoDaemonDistribution = {
    kind: "bundled",
    packageName: "@hamiltonhuaji/paseo-fork",
    version: "0.6.1-fork.6",
    serverVersion: "0.6.1",
    installSpec: "https://example.test/paseo-fork.tgz",
    packageRoot,
  };

  expect(resolveBundledPaseoCliEntrypoint(distribution)).toBe(cliEntrypoint);
});

test("does not fall through to another distribution when the bundled CLI is missing", () => {
  const packageRoot = mkdtempSync(join(tmpdir(), "paseo-bundled-cli-missing-"));
  temporaryDirectories.push(packageRoot);
  const distribution: PaseoDaemonDistribution = {
    kind: "bundled",
    packageName: "@hamiltonhuaji/paseo-fork",
    version: "0.6.1-fork.6",
    serverVersion: "0.6.1",
    installSpec: "https://example.test/paseo-fork.tgz",
    packageRoot,
  };

  expect(resolveBundledPaseoCliEntrypoint(distribution)).toBeNull();
});
