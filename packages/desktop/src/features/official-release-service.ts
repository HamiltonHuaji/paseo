import type { AppReleaseChannel } from "./app-update-rollout.js";
import { UPSTREAM_REPOSITORY } from "./fork-build-info.js";

const GITHUB_API_BASE_URL = "https://api.github.com";
const SHA256_DIGEST_PATTERN = /^sha256:(?<value>[0-9a-f]{64})$/i;

interface ParsedVersion {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  beta: number | null;
}

export interface OfficialReleaseAsset {
  name: string;
  downloadUrl: string;
  size: number;
  sha256: string;
}

export interface GitHubRepository {
  owner: string;
  repo: string;
}

export interface ResolvedDesktopRelease {
  version: string;
  releaseUrl: string;
  body: string | null;
  date: string | null;
  asset: OfficialReleaseAsset | null;
}

export interface OfficialReleaseCheckResult {
  upstreamBaseVersion: string;
  latestVersion: string | null;
  hasNewerUpstream: boolean;
  releaseUrl: string | null;
  body: string | null;
  date: string | null;
  canSwitch: boolean;
  assetName: string | null;
  errorMessage: string | null;
}

export interface OfficialSwitchResult {
  started: boolean;
  version: string | null;
  message: string;
}

export interface OfficialReleaseRuntime {
  getJson(url: string): Promise<unknown>;
  downloadAsset(asset: OfficialReleaseAsset): Promise<string>;
  installAsset(filePath: string): Promise<void>;
}

export interface OfficialReleaseService {
  check(input: { releaseChannel: AppReleaseChannel }): Promise<OfficialReleaseCheckResult>;
  switchToOfficial(
    input: { releaseChannel: AppReleaseChannel },
    onBeforeInstall?: () => Promise<void>,
  ): Promise<OfficialSwitchResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = value
    .trim()
    .replace(/^v/i, "")
    .match(/^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-beta\.(?<beta>\d+))?$/);
  if (!match?.groups) return null;

  return {
    raw: value.trim().replace(/^v/i, ""),
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    beta: match.groups.beta === undefined ? null : Number(match.groups.beta),
  };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }
  if (left.beta === right.beta) return 0;
  if (left.beta === null) return 1;
  if (right.beta === null) return -1;
  return left.beta - right.beta;
}

export function compareDesktopReleaseVersions(left: string, right: string): number | null {
  const parsedLeft = parseVersion(left);
  const parsedRight = parseVersion(right);
  return parsedLeft && parsedRight ? compareVersions(parsedLeft, parsedRight) : null;
}

function expectedAssetNames(
  version: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string[] {
  if (platform === "win32") {
    if (arch === "x64" || arch === "arm64") {
      return [`Paseo-Setup-${version}-${arch}.exe`, `Paseo-Setup-${version}.exe`];
    }
    return [`Paseo-Setup-${version}.exe`];
  }

  if (platform === "linux") {
    const debArch = arch === "x64" ? "amd64" : arch;
    return [`Paseo-${version}-${debArch}.deb`];
  }

  return [];
}

function parseAsset(value: unknown, repository: GitHubRepository): OfficialReleaseAsset | null {
  if (!isRecord(value)) return null;
  const name = toStringOrNull(value.name);
  const downloadUrl = toStringOrNull(value.browser_download_url);
  const digest = toStringOrNull(value.digest)?.match(SHA256_DIGEST_PATTERN)?.groups?.value;
  const size = typeof value.size === "number" && Number.isFinite(value.size) ? value.size : null;
  if (!name || !downloadUrl || !digest || size === null || size <= 0) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(downloadUrl);
  } catch {
    return null;
  }
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "github.com" ||
    !parsedUrl.pathname.startsWith(`/${repository.owner}/${repository.repo}/releases/download/`)
  ) {
    return null;
  }

  return { name, downloadUrl, size, sha256: digest.toLowerCase() };
}

function parseRelease(
  value: unknown,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
  repository: GitHubRepository,
): ResolvedDesktopRelease | null {
  if (!isRecord(value) || value.draft === true) return null;
  const parsedVersion = parseVersion(toStringOrNull(value.tag_name) ?? "");
  const releaseUrl = toStringOrNull(value.html_url);
  if (!parsedVersion || !releaseUrl) return null;

  const assets = Array.isArray(value.assets) ? value.assets : [];
  const parsedAssets = new Map(
    assets
      .map((asset) => parseAsset(asset, repository))
      .filter((asset): asset is OfficialReleaseAsset => asset !== null)
      .map((asset) => [asset.name, asset]),
  );
  const asset =
    expectedAssetNames(parsedVersion.raw, platform, arch)
      .map((name) => parsedAssets.get(name) ?? null)
      .find((candidate) => candidate !== null) ?? null;

  return {
    version: parsedVersion.raw,
    releaseUrl,
    body: toStringOrNull(value.body),
    date: toStringOrNull(value.published_at),
    asset,
  };
}

function selectRelease(
  raw: unknown,
  releaseChannel: AppReleaseChannel,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
  repository: GitHubRepository,
): ResolvedDesktopRelease | null {
  if (releaseChannel === "stable") {
    return parseRelease(raw, platform, arch, repository);
  }
  if (!Array.isArray(raw)) return null;

  return (
    raw
      .filter((entry) => isRecord(entry) && entry.prerelease === true)
      .map((entry) => parseRelease(entry, platform, arch, repository))
      .filter((entry): entry is ResolvedDesktopRelease => entry !== null)
      .sort((left, right) => {
        const leftVersion = parseVersion(left.version);
        const rightVersion = parseVersion(right.version);
        if (!leftVersion || !rightVersion) return 0;
        return compareVersions(rightVersion, leftVersion);
      })[0] ?? null
  );
}

function releaseApiUrl(releaseChannel: AppReleaseChannel, repository: GitHubRepository): string {
  const repositoryPath = `/repos/${repository.owner}/${repository.repo}`;
  return releaseChannel === "stable"
    ? `${GITHUB_API_BASE_URL}${repositoryPath}/releases/latest`
    : `${GITHUB_API_BASE_URL}${repositoryPath}/releases?per_page=30`;
}

export function createGitHubDesktopReleaseResolver({
  getJson,
  repository,
  platform,
  arch,
}: {
  getJson(url: string): Promise<unknown>;
  repository: GitHubRepository;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
}): {
  resolve(releaseChannel: AppReleaseChannel): Promise<ResolvedDesktopRelease>;
} {
  return {
    async resolve(releaseChannel) {
      const raw = await getJson(releaseApiUrl(releaseChannel, repository));
      const release = selectRelease(raw, releaseChannel, platform, arch, repository);
      if (!release) throw new Error("The GitHub release response was invalid.");
      return release;
    },
  };
}

function emptyCheckResult(
  upstreamBaseVersion: string,
  errorMessage: string,
): OfficialReleaseCheckResult {
  return {
    upstreamBaseVersion,
    latestVersion: null,
    hasNewerUpstream: false,
    releaseUrl: null,
    body: null,
    date: null,
    canSwitch: false,
    assetName: null,
    errorMessage,
  };
}

export function createOfficialReleaseService({
  runtime,
  platform,
  arch,
  upstreamBaseVersion,
  canInstall = true,
}: {
  runtime: OfficialReleaseRuntime;
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  upstreamBaseVersion: string;
  canInstall?: boolean;
}): OfficialReleaseService {
  const resolver = createGitHubDesktopReleaseResolver({
    getJson: runtime.getJson,
    repository: UPSTREAM_REPOSITORY,
    platform,
    arch,
  });

  async function check({
    releaseChannel,
  }: {
    releaseChannel: AppReleaseChannel;
  }): Promise<OfficialReleaseCheckResult> {
    try {
      const release = await resolver.resolve(releaseChannel);
      const baseVersion = parseVersion(upstreamBaseVersion);
      const latestVersion = parseVersion(release.version);
      return {
        upstreamBaseVersion,
        latestVersion: release.version,
        hasNewerUpstream:
          baseVersion !== null &&
          latestVersion !== null &&
          compareVersions(latestVersion, baseVersion) > 0,
        releaseUrl: release.releaseUrl,
        body: release.body,
        date: release.date,
        canSwitch: canInstall && release.asset !== null,
        assetName: canInstall ? (release.asset?.name ?? null) : null,
        errorMessage: null,
      };
    } catch (error) {
      return emptyCheckResult(
        upstreamBaseVersion,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function switchToOfficial(
    { releaseChannel }: { releaseChannel: AppReleaseChannel },
    onBeforeInstall?: () => Promise<void>,
  ): Promise<OfficialSwitchResult> {
    const release = await resolver.resolve(releaseChannel);
    if (!canInstall) {
      return {
        started: false,
        version: release.version,
        message: "Switching to the official Paseo build is unavailable in development mode.",
      };
    }
    if (!release.asset) {
      return {
        started: false,
        version: release.version,
        message: "No verified official installer is available for this platform.",
      };
    }

    const filePath = await runtime.downloadAsset(release.asset);
    if (onBeforeInstall) await onBeforeInstall();
    await runtime.installAsset(filePath);
    return {
      started: true,
      version: release.version,
      message: "The official Paseo installer has started.",
    };
  }

  return { check, switchToOfficial };
}
