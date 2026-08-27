import { describe, expect, it, vi } from "vitest";
import {
  createForkDebUpdateService,
  type ForkDebUpdateRuntime,
} from "./fork-deb-update-service.js";

const repository = { owner: "HamiltonHuaji", repo: "paseo" } as const;
const digest = `sha256:${"a".repeat(64)}`;

function release(version: string, asset = true) {
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/HamiltonHuaji/paseo/releases/tag/v${version}`,
    draft: false,
    prerelease: false,
    body: "Changes",
    published_at: "2026-07-16T00:00:00Z",
    assets: asset
      ? [
          {
            name: `Paseo-${version}-amd64.deb`,
            browser_download_url: `https://github.com/HamiltonHuaji/paseo/releases/download/v${version}/Paseo-${version}-amd64.deb`,
            digest,
            size: 100,
          },
        ]
      : [],
  };
}

function createRuntime(value: unknown): ForkDebUpdateRuntime {
  return {
    getJson: vi.fn().mockResolvedValue(value),
    downloadAsset: vi.fn().mockResolvedValue("/tmp/Paseo.deb"),
    installAsset: vi.fn().mockResolvedValue(undefined),
  };
}

describe("fork deb update service", () => {
  it("reports a newer verified deb as ready to install", async () => {
    const runtime = createRuntime(release("0.1.111"));
    const service = createForkDebUpdateService({ runtime, repository, arch: "x64" });

    await expect(
      service.checkForAppUpdate({
        currentVersion: "0.1.110",
        releaseChannel: "stable",
        intent: "automatic",
      }),
    ).resolves.toMatchObject({
      hasUpdate: true,
      readyToInstall: true,
      latestVersion: "0.1.111",
      errorMessage: null,
    });
  });

  it("does not offer a same-version release", async () => {
    const runtime = createRuntime(release("0.1.110"));
    const service = createForkDebUpdateService({ runtime, repository, arch: "x64" });

    await expect(
      service.checkForAppUpdate({
        currentVersion: "0.1.110",
        releaseChannel: "stable",
        intent: "manual",
      }),
    ).resolves.toMatchObject({ hasUpdate: false, readyToInstall: false });
  });

  it("downloads before stopping the daemon and installing", async () => {
    const events: string[] = [];
    const runtime = createRuntime(release("0.1.111"));
    vi.mocked(runtime.downloadAsset).mockImplementation(async () => {
      events.push("download");
      return "/tmp/Paseo.deb";
    });
    vi.mocked(runtime.installAsset).mockImplementation(async () => {
      events.push("install");
    });
    const service = createForkDebUpdateService({ runtime, repository, arch: "x64" });
    await service.checkForAppUpdate({
      currentVersion: "0.1.110",
      releaseChannel: "stable",
      intent: "manual",
    });

    await expect(
      service.downloadAndInstallUpdate(
        { currentVersion: "0.1.110", releaseChannel: "stable" },
        async () => {
          events.push("stop");
        },
      ),
    ).resolves.toMatchObject({ installed: true, version: "0.1.111" });
    expect(events).toEqual(["download", "stop", "install"]);
  });

  it("does not install an asset from another repository", async () => {
    const wrongRepositoryRelease = release("0.1.111");
    wrongRepositoryRelease.assets[0]!.browser_download_url =
      "https://github.com/getpaseo/paseo/releases/download/v0.1.111/Paseo-0.1.111-amd64.deb";
    const runtime = createRuntime(wrongRepositoryRelease);
    const service = createForkDebUpdateService({ runtime, repository, arch: "x64" });

    await expect(
      service.checkForAppUpdate({
        currentVersion: "0.1.110",
        releaseChannel: "stable",
        intent: "manual",
      }),
    ).resolves.toMatchObject({ hasUpdate: true, readyToInstall: false });
  });
});
