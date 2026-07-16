import { describe, expect, it } from "vitest";
import { checkForkAndroidRelease, compareForkAndroidVersions } from "./fork-android-release";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("compareForkAndroidVersions", () => {
  it("orders stable and beta versions", () => {
    expect(compareForkAndroidVersions("0.1.111", "0.1.110")).toBeGreaterThan(0);
    expect(compareForkAndroidVersions("0.1.111", "0.1.111-beta.2")).toBeGreaterThan(0);
    expect(compareForkAndroidVersions("0.1.111-beta.2", "0.1.111-beta.1")).toBeGreaterThan(0);
  });
});

describe("checkForkAndroidRelease", () => {
  it("finds a newer signed fork APK", async () => {
    const fetcher = async () =>
      response({
        tag_name: "v0.1.111",
        html_url: "https://github.com/HamiltonHuaji/paseo/releases/tag/v0.1.111",
        assets: [
          {
            name: "Paseo-Fork-0.1.111-android.apk",
            browser_download_url:
              "https://github.com/HamiltonHuaji/paseo/releases/download/v0.1.111/Paseo-Fork-0.1.111-android.apk",
          },
        ],
      });

    await expect(checkForkAndroidRelease("0.1.110", fetcher)).resolves.toEqual({
      latestVersion: "0.1.111",
      hasUpdate: true,
      releaseUrl: "https://github.com/HamiltonHuaji/paseo/releases/tag/v0.1.111",
      apkUrl:
        "https://github.com/HamiltonHuaji/paseo/releases/download/v0.1.111/Paseo-Fork-0.1.111-android.apk",
    });
  });

  it("does not trust an APK download outside the fork repository", async () => {
    const fetcher = async () =>
      response({
        tag_name: "v0.1.111",
        html_url: "https://github.com/HamiltonHuaji/paseo/releases/tag/v0.1.111",
        assets: [
          {
            name: "Paseo-Fork-0.1.111-android.apk",
            browser_download_url: "https://example.com/Paseo-Fork-0.1.111-android.apk",
          },
        ],
      });

    await expect(checkForkAndroidRelease("0.1.110", fetcher)).resolves.toMatchObject({
      hasUpdate: true,
      apkUrl: null,
    });
  });
});
