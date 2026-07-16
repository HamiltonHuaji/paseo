import fs from "node:fs";

const metadataPath = new URL(
  "../packages/desktop/src/features/fork-build-info.json",
  import.meta.url,
);
const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
const upstreamBaseVersion = metadata.upstreamBaseVersion;
const revision = metadata.revision;

if (
  typeof upstreamBaseVersion !== "string" ||
  !/^\d+\.\d+\.\d+$/.test(upstreamBaseVersion) ||
  !Number.isInteger(revision) ||
  revision < 1
) {
  throw new Error(`Invalid fork build metadata in ${metadataPath.pathname}`);
}

const entries = [
  ["FORK_UPSTREAM_BASE_VERSION", upstreamBaseVersion],
  ["FORK_REVISION", String(revision)],
  ["FORK_DISPLAY_VERSION", `${upstreamBaseVersion}-fork.${revision}`],
];

for (const [key, value] of entries) {
  process.stdout.write(`${key}=${value}\n`);
}
