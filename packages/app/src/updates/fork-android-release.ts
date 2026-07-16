const FORK_RELEASE_API_URL = "https://api.github.com/repos/HamiltonHuaji/paseo/releases/latest";
const FORK_RELEASE_DOWNLOAD_PATH = "/HamiltonHuaji/paseo/releases/download/";

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  beta: number | null;
}

export interface ForkAndroidRelease {
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  apkUrl: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value
    .trim()
    .replace(/^v/i, "")
    .match(/^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-beta\.(?<beta>\d+))?$/);
  if (!match?.groups) return null;

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    beta: match.groups.beta === undefined ? null : Number(match.groups.beta),
  };
}

export function compareForkAndroidVersions(left: string, right: string): number | null {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  if (!parsedLeft || !parsedRight) return null;

  for (const key of ["major", "minor", "patch"] as const) {
    if (parsedLeft[key] !== parsedRight[key]) {
      return parsedLeft[key] - parsedRight[key];
    }
  }
  if (parsedLeft.beta === parsedRight.beta) return 0;
  if (parsedLeft.beta === null) return 1;
  if (parsedRight.beta === null) return -1;
  return parsedLeft.beta - parsedRight.beta;
}

function parseTrustedUrl(
  value: unknown,
  expectedHost: string,
  expectedPathPrefix: string,
): string | null {
  const text = toNonEmptyString(value);
  if (!text) return null;

  try {
    const url = new URL(text);
    if (
      url.protocol !== "https:" ||
      url.hostname !== expectedHost ||
      !url.pathname.startsWith(expectedPathPrefix)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function checkForkAndroidRelease(
  currentVersion: string,
  fetcher: typeof fetch = fetch,
): Promise<ForkAndroidRelease> {
  const response = await fetcher(FORK_RELEASE_API_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} while checking fork releases.`);
  }

  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error("GitHub returned an invalid fork release.");

  const tag = toNonEmptyString(value.tag_name);
  const latestVersion = tag?.replace(/^v/i, "") ?? null;
  const comparison = latestVersion
    ? compareForkAndroidVersions(latestVersion, currentVersion)
    : null;
  const releaseUrl = parseTrustedUrl(
    value.html_url,
    "github.com",
    "/HamiltonHuaji/paseo/releases/tag/",
  );
  if (!latestVersion || comparison === null || !releaseUrl) {
    throw new Error("GitHub returned an invalid fork release.");
  }

  const expectedAssetName = `Paseo-Fork-${latestVersion}-android.apk`;
  const asset = Array.isArray(value.assets)
    ? value.assets.find((candidate) => isRecord(candidate) && candidate.name === expectedAssetName)
    : null;
  const apkUrl = isRecord(asset)
    ? parseTrustedUrl(asset.browser_download_url, "github.com", FORK_RELEASE_DOWNLOAD_PATH)
    : null;

  return {
    latestVersion,
    hasUpdate: comparison > 0,
    releaseUrl,
    apkUrl,
  };
}
