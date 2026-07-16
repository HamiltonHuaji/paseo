import type { AppUpdateCheckResult, AppUpdateInstallResult } from "./app-update-service.js";
import type { AppReleaseChannel, AppUpdateCheckIntent } from "./app-update-rollout.js";
import {
  compareDesktopReleaseVersions,
  createGitHubDesktopReleaseResolver,
  type GitHubRepository,
  type OfficialReleaseAsset,
  type ResolvedDesktopRelease,
} from "./official-release-service.js";

export interface ForkDebUpdateRuntime {
  getJson(url: string): Promise<unknown>;
  downloadAsset(asset: OfficialReleaseAsset): Promise<string>;
  installAsset(filePath: string): Promise<void>;
}

export interface ForkDebUpdateService {
  checkForAppUpdate(input: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
    intent: AppUpdateCheckIntent;
  }): Promise<AppUpdateCheckResult>;
  downloadAndInstallUpdate(
    input: { currentVersion: string; releaseChannel: AppReleaseChannel },
    onBeforeInstall?: () => Promise<void>,
  ): Promise<AppUpdateInstallResult>;
}

function noUpdate(
  currentVersion: string,
  errorMessage: string | null = null,
): AppUpdateCheckResult {
  return {
    hasUpdate: false,
    readyToInstall: false,
    currentVersion,
    latestVersion: currentVersion,
    body: null,
    date: null,
    errorMessage,
  };
}

export function createForkDebUpdateService({
  runtime,
  repository,
  arch,
  canInstall = true,
}: {
  runtime: ForkDebUpdateRuntime;
  repository: GitHubRepository;
  arch: NodeJS.Architecture;
  canInstall?: boolean;
}): ForkDebUpdateService {
  const resolver = createGitHubDesktopReleaseResolver({
    getJson: runtime.getJson,
    repository,
    platform: "linux",
    arch,
  });
  let cachedRelease: ResolvedDesktopRelease | null = null;
  let cachedChannel: AppReleaseChannel | null = null;

  async function checkForAppUpdate({
    currentVersion,
    releaseChannel,
  }: {
    currentVersion: string;
    releaseChannel: AppReleaseChannel;
    intent: AppUpdateCheckIntent;
  }): Promise<AppUpdateCheckResult> {
    if (!canInstall) return noUpdate(currentVersion);

    try {
      const release = await resolver.resolve(releaseChannel);
      const comparison = compareDesktopReleaseVersions(release.version, currentVersion);
      if (comparison === null) throw new Error("The desktop release version was invalid.");
      if (comparison <= 0) {
        cachedRelease = null;
        cachedChannel = null;
        return noUpdate(currentVersion);
      }

      cachedRelease = release;
      cachedChannel = releaseChannel;
      return {
        hasUpdate: true,
        readyToInstall: release.asset !== null,
        currentVersion,
        latestVersion: release.version,
        body: release.body,
        date: release.date,
        errorMessage: release.asset
          ? null
          : "No verified .deb installer is available for this update.",
      };
    } catch (error) {
      cachedRelease = null;
      cachedChannel = null;
      return noUpdate(currentVersion, error instanceof Error ? error.message : String(error));
    }
  }

  async function downloadAndInstallUpdate(
    {
      currentVersion,
      releaseChannel,
    }: { currentVersion: string; releaseChannel: AppReleaseChannel },
    onBeforeInstall?: () => Promise<void>,
  ): Promise<AppUpdateInstallResult> {
    if (!canInstall) {
      return {
        installed: false,
        version: currentVersion,
        message: "Auto-update is not available in development mode.",
      };
    }

    const release = cachedChannel === releaseChannel ? cachedRelease : null;
    if (!release?.asset) {
      return {
        installed: false,
        version: currentVersion,
        message: "No verified .deb update is ready. Check for updates first.",
      };
    }

    try {
      const filePath = await runtime.downloadAsset(release.asset);
      if (onBeforeInstall) await onBeforeInstall();
      await runtime.installAsset(filePath);
      return {
        installed: true,
        version: release.version,
        message: "Update downloaded. The app will restart shortly.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        installed: false,
        version: currentVersion,
        message: `Update failed: ${message}`,
      };
    }
  }

  return { checkForAppUpdate, downloadAndInstallUpdate };
}
