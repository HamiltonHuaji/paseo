import { describe, expect, it } from "vitest";
import { resolveOfficialInstallPlan } from "./official-release-install";

describe("resolveOfficialInstallPlan", () => {
  it("launches the Windows NSIS installer as an updater", () => {
    expect(resolveOfficialInstallPlan("win32", "C:\\Temp\\Paseo-Setup.exe")).toEqual({
      command: "C:\\Temp\\Paseo-Setup.exe",
      args: ["--updated", "--force-run"],
      waitForExit: false,
      relaunchApp: false,
    });
  });

  it("uses pkexec and dpkg so Linux can reinstall or downgrade the deb", () => {
    expect(resolveOfficialInstallPlan("linux", "/tmp/Paseo-amd64.deb")).toEqual({
      command: "pkexec",
      args: ["--disable-internal-agent", "/usr/bin/dpkg", "--install", "/tmp/Paseo-amd64.deb"],
      waitForExit: true,
      relaunchApp: true,
    });
  });

  it("rejects unsupported platforms", () => {
    expect(() => resolveOfficialInstallPlan("darwin", "/tmp/Paseo.dmg")).toThrow(
      "not supported on darwin",
    );
  });
});
