import fs from "node:fs";

const DEFAULT_METADATA_URL = new URL(
  "../packages/desktop/src/features/fork-build-info.json",
  import.meta.url,
);

export function deriveForkVersion(upstreamBaseVersion, forkRevision) {
  const match = upstreamBaseVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid fork upstream baseline: ${upstreamBaseVersion}`);
  }
  if (!Number.isInteger(forkRevision) || forkRevision < 1 || forkRevision > 999) {
    throw new Error(`Invalid fork revision: ${forkRevision}`);
  }

  const [, major, minor, upstreamPatchText] = match;
  const upstreamPatch = Number.parseInt(upstreamPatchText, 10);
  return `${major}.${minor}.${upstreamPatch * 1000 + forkRevision}`;
}

export function readForkBuildMetadata(metadataUrl = DEFAULT_METADATA_URL) {
  const metadata = JSON.parse(fs.readFileSync(metadataUrl, "utf8"));
  const { version, upstreamBaseVersion, forkRevision } = metadata;
  const derivedVersion = deriveForkVersion(upstreamBaseVersion, forkRevision);
  if (version !== derivedVersion) {
    throw new Error(
      `Invalid fork build metadata in ${metadataUrl.pathname}: expected ${derivedVersion}, got ${String(version)}`,
    );
  }
  return { version, upstreamBaseVersion, forkRevision };
}
