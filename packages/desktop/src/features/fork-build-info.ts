import metadata from "./fork-build-info.json";

export const FORK_REPOSITORY = {
  owner: "HamiltonHuaji",
  repo: "paseo",
} as const;

export const UPSTREAM_REPOSITORY = {
  owner: "getpaseo",
  repo: "paseo",
} as const;

// Reset revision to 1 whenever upstreamBaseVersion advances. Increment it for
// each subsequent fork build on the same upstream base.
export const FORK_UPSTREAM_BASE_VERSION = metadata.upstreamBaseVersion;
export const FORK_REVISION = metadata.revision;
export const FORK_DISPLAY_VERSION = `${FORK_UPSTREAM_BASE_VERSION}-fork.${FORK_REVISION}`;
