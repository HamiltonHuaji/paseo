import Constants from "expo-constants";
import appPackage from "../../package.json";

function toVersionOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

export function resolveAppVersion(): string | null {
  const packageVersion = toVersionOrNull(appPackage?.version);
  if (packageVersion) {
    return packageVersion;
  }

  const expoVersion = toVersionOrNull(Constants.expoConfig?.version);
  if (expoVersion) {
    return expoVersion;
  }

  const manifestVersion = toVersionOrNull(
    (Constants as unknown as { manifest?: { version?: unknown } }).manifest?.version,
  );
  if (manifestVersion) {
    return manifestVersion;
  }

  return null;
}

export function resolveForkVersion(): string | null {
  const extra = Constants.expoConfig?.extra as { forkBuild?: { version?: unknown } } | undefined;
  return toVersionOrNull(extra?.forkBuild?.version);
}

export function compareNumericVersions(
  leftVersion: string | null | undefined,
  rightVersion: string | null | undefined,
): number | null {
  const parse = (value: string | null | undefined) => {
    const match = value
      ?.trim()
      .replace(/^v/i, "")
      .match(/^(\d+)\.(\d+)\.(\d+)$/);
    return match ? match.slice(1).map((part) => Number.parseInt(part, 10)) : null;
  };
  const left = parse(leftVersion);
  const right = parse(rightVersion);
  if (!left || !right) return null;

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  }
  return 0;
}
