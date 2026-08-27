import { describe, expect, it } from "vitest";
import {
  createOfficialReleaseService,
  type OfficialReleaseRuntime,
} from "./official-release-service";

function release(input: {
  version: string;
  prerelease?: boolean;
  assets?: Array<{ name: string; digest?: string | null }>;
}) {
  return {
    tag_name: `v${input.version}`,
    html_url: `https://github.com/getpaseo/paseo/releases/tag/v${input.version}`,
    body: `Changes in ${input.version}`,
    published_at: "2026-07-16T07:49:02Z",
    draft: false,
    prerelease: input.prerelease ?? false,
    assets: (input.assets ?? []).map((asset) => ({
      name: asset.name,
      browser_download_url: `https://github.com/getpaseo/paseo/releases/download/v${input.version}/${asset.name}`,
      size: 1234,
      digest: "digest" in asset ? asset.digest : `sha256:${"a".repeat(64)}`,
    })),
  };
}

function createRuntime(response: unknown): OfficialReleaseRuntime & {
  downloaded: string[];
  installed: string[];
} {
  const downloaded: string[] = [];
  const installed: string[] = [];
  return {
    downloaded,
    installed,
    async getJson() {
      return response;
    },
    async downloadAsset(asset) {
      downloaded.push(asset.name);
      return `/tmp/${asset.name}`;
    },
    async installAsset(filePath) {
      installed.push(filePath);
    },
  };
}

describe("official release service", () => {
  it("reports a newer stable upstream and selects the matching Windows installer", async () => {
    const runtime = createRuntime(
      release({
        version: "0.1.110",
        assets: [
          { name: "Paseo-Setup-0.1.110-arm64.exe" },
          { name: "Paseo-Setup-0.1.110-x64.exe" },
          { name: "Paseo-Setup-0.1.110.exe" },
        ],
      }),
    );
    const service = createOfficialReleaseService({
      runtime,
      platform: "win32",
      arch: "x64",
      upstreamBaseVersion: "0.1.109",
    });

    await expect(service.check({ releaseChannel: "stable" })).resolves.toEqual({
      upstreamBaseVersion: "0.1.109",
      latestVersion: "0.1.110",
      hasNewerUpstream: true,
      releaseUrl: "https://github.com/getpaseo/paseo/releases/tag/v0.1.110",
      body: "Changes in 0.1.110",
      date: "2026-07-16T07:49:02Z",
      canSwitch: true,
      assetName: "Paseo-Setup-0.1.110-x64.exe",
      errorMessage: null,
    });
  });

  it("selects the amd64 deb for an x64 Linux build", async () => {
    const runtime = createRuntime(
      release({
        version: "0.1.109",
        assets: [{ name: "Paseo-0.1.109-x86_64.rpm" }, { name: "Paseo-0.1.109-amd64.deb" }],
      }),
    );
    const service = createOfficialReleaseService({
      runtime,
      platform: "linux",
      arch: "x64",
      upstreamBaseVersion: "0.1.109",
    });

    const result = await service.check({ releaseChannel: "stable" });

    expect(result.hasNewerUpstream).toBe(false);
    expect(result.canSwitch).toBe(true);
    expect(result.assetName).toBe("Paseo-0.1.109-amd64.deb");
  });

  it("chooses the newest published beta from the release list", async () => {
    const runtime = createRuntime([
      release({ version: "0.1.110-beta.1", prerelease: true }),
      release({
        version: "0.1.110-beta.3",
        prerelease: true,
        assets: [{ name: "Paseo-Setup-0.1.110-beta.3-x64.exe" }],
      }),
      release({ version: "0.1.110-beta.2", prerelease: true }),
      release({ version: "0.1.109", prerelease: false }),
    ]);
    const service = createOfficialReleaseService({
      runtime,
      platform: "win32",
      arch: "x64",
      upstreamBaseVersion: "0.1.109",
    });

    const result = await service.check({ releaseChannel: "beta" });

    expect(result.latestVersion).toBe("0.1.110-beta.3");
    expect(result.assetName).toBe("Paseo-Setup-0.1.110-beta.3-x64.exe");
  });

  it("keeps release discovery available when no verifiable platform asset exists", async () => {
    const runtime = createRuntime(
      release({
        version: "0.1.110",
        assets: [{ name: "Paseo-Setup-0.1.110-x64.exe", digest: null }],
      }),
    );
    const service = createOfficialReleaseService({
      runtime,
      platform: "win32",
      arch: "x64",
      upstreamBaseVersion: "0.1.109",
    });

    const result = await service.check({ releaseChannel: "stable" });

    expect(result.latestVersion).toBe("0.1.110");
    expect(result.hasNewerUpstream).toBe(true);
    expect(result.canSwitch).toBe(false);
    expect(result.assetName).toBeNull();
  });

  it("downloads and installs the official asset even when its version matches the base", async () => {
    const runtime = createRuntime(
      release({
        version: "0.1.109",
        assets: [{ name: "Paseo-Setup-0.1.109-x64.exe" }],
      }),
    );
    const service = createOfficialReleaseService({
      runtime,
      platform: "win32",
      arch: "x64",
      upstreamBaseVersion: "0.1.109",
    });
    const events: string[] = [];

    const result = await service.switchToOfficial({ releaseChannel: "stable" }, async () =>
      events.push("before-install"),
    );

    expect(runtime.downloaded).toEqual(["Paseo-Setup-0.1.109-x64.exe"]);
    expect(events).toEqual(["before-install"]);
    expect(runtime.installed).toEqual(["/tmp/Paseo-Setup-0.1.109-x64.exe"]);
    expect(result).toEqual({
      started: true,
      version: "0.1.109",
      message: "The official Paseo installer has started.",
    });
  });

  it("returns a check error without offering a switch", async () => {
    const runtime = createRuntime(null);
    runtime.getJson = async () => {
      throw new Error("GitHub unavailable");
    };
    const service = createOfficialReleaseService({
      runtime,
      platform: "linux",
      arch: "x64",
      upstreamBaseVersion: "0.1.109",
    });

    await expect(service.check({ releaseChannel: "stable" })).resolves.toEqual({
      upstreamBaseVersion: "0.1.109",
      latestVersion: null,
      hasNewerUpstream: false,
      releaseUrl: null,
      body: null,
      date: null,
      canSwitch: false,
      assetName: null,
      errorMessage: "GitHub unavailable",
    });
  });
});
