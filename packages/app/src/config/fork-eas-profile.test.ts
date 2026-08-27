import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface EasAndroidProfile {
  buildType?: string;
  credentialsSource?: string;
  gradleCommand?: string;
  resourceClass?: string;
}

describe("fork EAS profile", () => {
  it("builds a remotely signed arm64 APK on standard resources", () => {
    const eas = JSON.parse(readFileSync(new URL("../../eas.json", import.meta.url), "utf8")) as {
      build: { "fork-apk": { android: EasAndroidProfile } };
    };
    const profile = eas.build["fork-apk"].android;

    expect(profile.buildType).toBe("apk");
    expect(profile.credentialsSource).toBe("remote");
    expect(profile.resourceClass).toBeUndefined();
    expect(profile.gradleCommand).toContain(":app:createBundleReleaseJsAndAssets");
    expect(profile.gradleCommand).toContain("-PreactNativeArchitectures=arm64-v8a");
    expect(profile.gradleCommand).toContain("--no-daemon");
    expect(profile.gradleCommand).toContain("--max-workers=1");
    expect(profile.gradleCommand).toContain("-Dorg.gradle.parallel=false");
    expect(profile.gradleCommand).toContain("-Dorg.gradle.jvmargs=-Xmx2048m");
  });
});
