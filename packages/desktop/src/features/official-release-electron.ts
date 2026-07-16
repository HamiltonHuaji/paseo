import { spawn } from "node:child_process";
import path from "node:path";
import { Readable } from "node:stream";
import { app, net } from "electron";
import {
  createOfficialReleaseService,
  type OfficialReleaseAsset,
  type OfficialReleaseRuntime,
} from "./official-release-service.js";
import { writeVerifiedOfficialAsset } from "./official-release-download.js";
import { resolveOfficialInstallPlan } from "./official-release-install.js";
import { FORK_UPSTREAM_BASE_VERSION } from "./fork-build-info.js";

const RELEASE_DOWNLOAD_DIRECTORY = "paseo-release-installer";

async function getJson(url: string): Promise<unknown> {
  const response = await net.fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} while checking official Paseo releases.`);
  }
  return response.json();
}

async function downloadAsset(asset: OfficialReleaseAsset): Promise<string> {
  const response = await net.fetch(asset.downloadUrl, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`GitHub returned ${response.status} while downloading ${asset.name}.`);
  }

  const chunks = Readable.fromWeb(response.body as never);
  return writeVerifiedOfficialAsset({
    directory: path.join(app.getPath("temp"), RELEASE_DOWNLOAD_DIRECTORY),
    asset,
    chunks,
  });
}

function waitForSpawn(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

function waitForSuccessfulExit(child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `The official Paseo installer exited with ${
            signal ? `signal ${signal}` : `code ${code ?? "unknown"}`
          }.`,
        ),
      );
    });
  });
}

async function installAsset(filePath: string): Promise<void> {
  const plan = resolveOfficialInstallPlan(process.platform, filePath);
  const child = spawn(plan.command, plan.args, {
    detached: !plan.waitForExit,
    stdio: "ignore",
    windowsHide: true,
  });

  if (plan.waitForExit) {
    await waitForSuccessfulExit(child);
  } else {
    await waitForSpawn(child);
    child.unref();
  }

  if (plan.relaunchApp) app.relaunch();
  app.quit();
}

export const electronReleaseRuntime: OfficialReleaseRuntime = {
  getJson,
  downloadAsset,
  installAsset,
};

export const officialReleaseService = createOfficialReleaseService({
  runtime: electronReleaseRuntime,
  platform: process.platform,
  arch: process.arch,
  upstreamBaseVersion: FORK_UPSTREAM_BASE_VERSION,
  canInstall: app.isPackaged,
});
