export interface OfficialInstallPlan {
  command: string;
  args: string[];
  waitForExit: boolean;
  relaunchApp: boolean;
}

export function resolveOfficialInstallPlan(
  platform: NodeJS.Platform,
  filePath: string,
): OfficialInstallPlan {
  if (platform === "win32") {
    return {
      command: filePath,
      args: ["--updated", "--force-run"],
      waitForExit: false,
      relaunchApp: false,
    };
  }

  if (platform === "linux") {
    return {
      command: "pkexec",
      args: ["--disable-internal-agent", "/usr/bin/dpkg", "--install", filePath],
      waitForExit: true,
      relaunchApp: true,
    };
  }

  throw new Error(`Switching to the official Paseo build is not supported on ${platform}.`);
}
