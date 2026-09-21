import metadata from "./fork-build-info.json";

export const FORK_REPOSITORY = {
  owner: "HamiltonHuaji",
  repo: "paseo",
} as const;

export const UPSTREAM_REPOSITORY = {
  owner: "getpaseo",
  repo: "paseo",
} as const;

// Reset the revision when the exact upstream baseline advances. The installable
// version uses the baseline's numeric core so npm/Electron can compare it.
export const FORK_VERSION = metadata.version;
export const FORK_UPSTREAM_BASE_VERSION = metadata.upstreamBaseVersion;
export const FORK_REVISION = metadata.forkRevision;
