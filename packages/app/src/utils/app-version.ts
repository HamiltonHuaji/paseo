import Constants from "expo-constants";
import appPackage from "../../package.json";
import { forkBuildInfo } from "@/constants/build-profile";

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

export function selectDaemonCompatibilityVersion(input: {
  upstreamBaseVersion: string | null | undefined;
  appVersion: string | null | undefined;
}): string | null {
  return toVersionOrNull(input.upstreamBaseVersion) ?? toVersionOrNull(input.appVersion);
}

/**
 * Version of the official client code this build contains.
 *
 * Fork installer versions are intentionally independent and must never be sent
 * to an official daemon as the client compatibility version.
 */
export function resolveDaemonCompatibilityVersion(): string | null {
  return selectDaemonCompatibilityVersion({
    upstreamBaseVersion: forkBuildInfo?.upstreamBaseVersion,
    appVersion: resolveAppVersion(),
  });
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[] | null;
}

function parseVersion(value: string | null | undefined): ParsedVersion | null {
  const normalized = toVersionOrNull(value)?.replace(/^v/i, "");
  if (!normalized) return null;
  const match = normalized.match(
    /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match?.groups) return null;
  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    prerelease: match.groups.prerelease?.split(".") ?? null,
  };
}

function comparePrerelease(left: string[] | null, right: string[] | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function comparePaseoVersions(
  left: string | null | undefined,
  right: string | null | undefined,
): number | null {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return null;
  for (const key of ["major", "minor", "patch"] as const) {
    if (parsedLeft[key] !== parsedRight[key]) {
      return parsedLeft[key] - parsedRight[key];
    }
  }
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

export function isDaemonVersionBelowBaseline(
  baselineVersion: string | null | undefined,
  daemonVersion: string | null | undefined,
): boolean {
  const comparison = comparePaseoVersions(daemonVersion, baselineVersion);
  return comparison !== null && comparison < 0;
}
