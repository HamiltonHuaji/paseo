import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBundledInternalPackageManifest,
  buildDistributionManifest,
  buildForkDaemonPackageManifest,
} from "./pack-fork-daemon.mjs";

const forkMetadata = { upstreamBaseVersion: "0.1.110", revision: 2 };
const rootManifest = { license: "AGPL-3.0-or-later" };
const cliManifest = {
  name: "@getpaseo/cli",
  version: "0.1.110",
  dependencies: {
    "@getpaseo/client": "0.1.110",
    "@getpaseo/server": "0.1.110",
    commander: "^12.0.0",
  },
};
const internalManifests = [
  {
    name: "@getpaseo/client",
    version: "0.1.110",
    dependencies: { "@getpaseo/protocol": "0.1.110", zod: "^4.4.3" },
  },
  {
    name: "@getpaseo/protocol",
    version: "0.1.110",
    dependencies: { zod: "^4.4.3" },
  },
  {
    name: "@getpaseo/server",
    version: "0.1.110",
    dependencies: { "@getpaseo/client": "0.1.110", ws: "^8.14.2" },
  },
];

test("builds one fork package with bundled internals and normal external dependencies", () => {
  const manifest = buildForkDaemonPackageManifest({
    rootManifest,
    cliManifest,
    internalManifests,
    forkMetadata,
  });

  assert.equal(manifest.name, "@hamiltonhuaji/paseo-fork");
  assert.equal(manifest.version, "0.1.110-fork.2");
  assert.deepEqual(manifest.bundleDependencies, [
    "@getpaseo/client",
    "@getpaseo/protocol",
    "@getpaseo/server",
  ]);
  assert.deepEqual(manifest.dependencies, {
    "@getpaseo/client": "0.1.110",
    "@getpaseo/protocol": "0.1.110",
    "@getpaseo/server": "0.1.110",
    commander: "^12.0.0",
    ws: "^8.14.2",
    zod: "^4.4.3",
  });

  assert.deepEqual(buildDistributionManifest(manifest, internalManifests), {
    schemaVersion: 1,
    packageName: "@hamiltonhuaji/paseo-fork",
    version: "0.1.110-fork.2",
    serverVersion: "0.1.110",
    installSpec: "https://github.com/HamiltonHuaji/paseo/releases/latest/download/paseo-fork.tgz",
    internalPackages: {
      "@getpaseo/client": "0.1.110",
      "@getpaseo/protocol": "0.1.110",
      "@getpaseo/server": "0.1.110",
    },
  });
});

test("rejects a workspace version that is not the declared upstream baseline", () => {
  assert.throws(
    () =>
      buildForkDaemonPackageManifest({
        rootManifest,
        cliManifest,
        internalManifests: [
          ...internalManifests.slice(0, 2),
          { ...internalManifests[2], version: "0.1.111" },
        ],
        forkMetadata,
      }),
    /expected upstream baseline 0\.1\.110/,
  );
});

test("rejects conflicting external dependency ranges", () => {
  assert.throws(
    () =>
      buildForkDaemonPackageManifest({
        rootManifest,
        cliManifest,
        internalManifests: [
          internalManifests[0],
          { ...internalManifests[1], dependencies: { zod: "^5.0.0" } },
          internalManifests[2],
        ],
        forkMetadata,
      }),
    /Conflicting dependency ranges for zod/,
  );
});

test("moves internal dependency ownership to the outer distribution", () => {
  const manifest = buildBundledInternalPackageManifest(internalManifests[2], {
    packageName: "@hamiltonhuaji/paseo-fork",
    version: "0.1.110-fork.2",
  });

  assert.equal(manifest.dependencies, undefined);
  assert.deepEqual(manifest.paseoDistribution, {
    packageName: "@hamiltonhuaji/paseo-fork",
    version: "0.1.110-fork.2",
  });
});
