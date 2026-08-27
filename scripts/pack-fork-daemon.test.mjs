import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBundledInternalPackageManifest,
  buildDistributionManifest,
  buildForkDaemonPackageManifest,
} from "./pack-fork-daemon.mjs";

const forkMetadata = { upstreamBaseVersion: "0.6.1", revision: 1 };
const rootManifest = { license: "AGPL-3.0-or-later" };
const cliManifest = {
  name: "@getpaseo/cli",
  version: "0.6.1",
  dependencies: {
    "@getpaseo/client": "0.6.1",
    "@getpaseo/server": "0.6.1",
    commander: "^12.0.0",
  },
};
const internalManifests = [
  {
    name: "@getpaseo/client",
    version: "0.6.1",
    dependencies: { "@getpaseo/protocol": "0.6.1", zod: "^4.4.3" },
  },
  {
    name: "@getpaseo/protocol",
    version: "0.6.1",
    dependencies: { zod: "^4.4.3" },
  },
  {
    name: "@getpaseo/plugin",
    version: "0.6.1",
    dependencies: { "use-sync-external-store": "^1.6.0" },
    peerDependencies: { react: "19.1.0", zod: "^4.4.3" },
    peerDependenciesMeta: { react: { optional: true } },
  },
  {
    name: "@getpaseo/server",
    version: "0.6.1",
    dependencies: {
      "@getpaseo/client": "0.6.1",
      "@getpaseo/plugin": "0.6.1",
      ws: "^8.14.2",
    },
  },
];

test("builds one fork package with current internal workspaces", () => {
  const manifest = buildForkDaemonPackageManifest({
    rootManifest,
    cliManifest,
    internalManifests,
    forkMetadata,
  });

  assert.equal(manifest.name, "@hamiltonhuaji/paseo-fork");
  assert.equal(manifest.version, "0.6.1-fork.1");
  assert.deepEqual(manifest.bundleDependencies, [
    "@getpaseo/client",
    "@getpaseo/plugin",
    "@getpaseo/protocol",
    "@getpaseo/server",
  ]);
  assert.deepEqual(manifest.dependencies, {
    "@getpaseo/client": "0.6.1",
    "@getpaseo/plugin": "0.6.1",
    "@getpaseo/protocol": "0.6.1",
    "@getpaseo/server": "0.6.1",
    commander: "^12.0.0",
    "use-sync-external-store": "^1.6.0",
    ws: "^8.14.2",
    zod: "^4.4.3",
  });

  assert.deepEqual(buildDistributionManifest(manifest, internalManifests), {
    schemaVersion: 1,
    packageName: "@hamiltonhuaji/paseo-fork",
    version: "0.6.1-fork.1",
    serverVersion: "0.6.1",
    installSpec: "https://github.com/HamiltonHuaji/paseo/releases/latest/download/paseo-fork.tgz",
    internalPackages: {
      "@getpaseo/client": "0.6.1",
      "@getpaseo/plugin": "0.6.1",
      "@getpaseo/protocol": "0.6.1",
      "@getpaseo/server": "0.6.1",
    },
  });
});

test("rejects a workspace version outside the current upstream baseline", () => {
  assert.throws(
    () =>
      buildForkDaemonPackageManifest({
        rootManifest,
        cliManifest,
        internalManifests: [
          ...internalManifests.slice(0, -1),
          { ...internalManifests.at(-1), version: "0.6.2" },
        ],
        forkMetadata,
      }),
    /expected upstream baseline 0\.6\.1/,
  );
});

test("rejects conflicting external dependency ranges", () => {
  assert.throws(
    () =>
      buildForkDaemonPackageManifest({
        rootManifest,
        cliManifest,
        internalManifests: [
          { ...internalManifests[0], dependencies: { zod: "^5.0.0" } },
          ...internalManifests.slice(1),
        ],
        forkMetadata,
      }),
    /Conflicting dependency ranges for zod/,
  );
});

test("moves internal dependency ownership to the outer distribution", () => {
  const manifest = buildBundledInternalPackageManifest(internalManifests[2], {
    packageName: "@hamiltonhuaji/paseo-fork",
    version: "0.6.1-fork.1",
  });
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.peerDependencies, undefined);
  assert.equal(manifest.peerDependenciesMeta, undefined);
  assert.deepEqual(manifest.paseoDistribution, {
    packageName: "@hamiltonhuaji/paseo-fork",
    version: "0.6.1-fork.1",
  });
});
