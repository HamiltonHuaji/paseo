import assert from "node:assert/strict";
import test from "node:test";
import {
  computeNextReleaseVersion,
  getReleaseInfoFromSourceTag,
  parseReleaseVersion,
} from "./release-version-utils.mjs";

test("computes the next beta patch from a stable version", () => {
  assert.equal(computeNextReleaseVersion("0.1.59", "beta-patch"), "0.1.60-beta.1");
});

test("advances beta versions", () => {
  assert.equal(computeNextReleaseVersion("0.1.60-beta.1", "beta-next"), "0.1.60-beta.2");
});

test("promotes beta versions to stable", () => {
  assert.equal(computeNextReleaseVersion("0.1.60-beta.2", "promote"), "0.1.60");
});

test("parses beta release metadata", () => {
  assert.deepEqual(parseReleaseVersion("0.1.60-beta.1"), {
    version: "0.1.60-beta.1",
    major: 0,
    minor: 1,
    patch: 60,
    prerelease: "beta.1",
    baseVersion: "0.1.60",
    isPrerelease: true,
    isBeta: true,
    betaNumber: 1,
  });
});

test("emits beta release info from tags", () => {
  assert.deepEqual(getReleaseInfoFromSourceTag("v0.1.60-beta.1"), {
    sourceTag: "v0.1.60-beta.1",
    releaseTag: "v0.1.60-beta.1",
    version: "0.1.60-beta.1",
    baseVersion: "0.1.60",
    prerelease: "beta.1",
    isPrerelease: true,
    isBeta: true,
    betaNumber: 1,
    releaseType: "prerelease",
    releaseChannel: "beta",
    isSmokeTag: false,
  });
});

test("rejects non-beta prerelease versions", () => {
  assert.throws(() => parseReleaseVersion("0.1.60-canary.1"), /Expected beta prerelease versions/);
});

test("fork baseline metadata derives one installable version", async () => {
  const { deriveForkVersion, readForkBuildMetadata } = await import("./fork-version-utils.mjs");
  assert.equal(deriveForkVersion("0.13.0-beta.1", 1), "0.13.1");
  assert.equal(deriveForkVersion("0.13.2", 4), "0.13.2004");
  assert.throws(() => deriveForkVersion("0.13.0", 0));
  assert.throws(() => deriveForkVersion("0.13.0", 1000));
  const metadata = readForkBuildMetadata();
  assert.equal(
    metadata.version,
    deriveForkVersion(metadata.upstreamBaseVersion, metadata.forkRevision),
  );
});

test("fork daemon packaging retains internal packages and rejects a mismatched baseline", async () => {
  const { buildForkDaemonPackageManifest } = await import("./pack-fork-daemon.mjs");
  const input = {
    rootManifest: { license: "Apache-2.0" },
    cliManifest: {
      name: "@getpaseo/cli",
      version: "0.13.0-beta.1",
      dependencies: { "@getpaseo/server": "0.13.0-beta.1", commander: "14.0.0" },
    },
    internalManifests: [
      { name: "@getpaseo/server", version: "0.13.0-beta.1", dependencies: { zod: "4.0.0" } },
    ],
    forkMetadata: { version: "0.13.1", upstreamBaseVersion: "0.13.0-beta.1", forkRevision: 1 },
  };
  const manifest = buildForkDaemonPackageManifest(input);
  assert.equal(manifest.name, "@hamiltonhuaji/paseo-fork");
  assert.equal(manifest.version, "0.13.1");
  assert.deepEqual(manifest.bundleDependencies, ["@getpaseo/server"]);
  assert.equal(manifest.dependencies["@getpaseo/server"], "0.13.0-beta.1");
  assert.equal(manifest.dependencies.zod, "4.0.0");
  assert.throws(
    () =>
      buildForkDaemonPackageManifest({
        ...input,
        cliManifest: { ...input.cliManifest, version: "0.9.0-beta.2" },
      }),
    /expected upstream baseline/,
  );
});
