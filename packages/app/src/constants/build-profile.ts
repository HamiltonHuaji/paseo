import Constants from "expo-constants";

interface ForkBuildInfo {
  upstreamBaseVersion: string;
  revision: number;
  displayVersion: string;
}

function parseForkBuildInfo(value: unknown): ForkBuildInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.upstreamBaseVersion !== "string" ||
    typeof record.revision !== "number" ||
    !Number.isInteger(record.revision) ||
    record.revision < 1 ||
    typeof record.displayVersion !== "string"
  ) {
    return null;
  }
  return {
    upstreamBaseVersion: record.upstreamBaseVersion,
    revision: record.revision,
    displayVersion: record.displayVersion,
  };
}

/** F-Droid build without proprietary camera, notification, or OTA dependencies. */
export const isFdroidBuild = Constants.expoConfig?.extra?.fdroidBuild === true;

/** Independently signed fork build distributed outside the official stores. */
export const isForkBuild = Constants.expoConfig?.extra?.distribution === "fork";

/** User-facing fork lineage; independent from the monotonically increasing installer version. */
export const forkBuildInfo = parseForkBuildInfo(Constants.expoConfig?.extra?.forkBuild);
