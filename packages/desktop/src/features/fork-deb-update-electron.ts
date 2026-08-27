import { app } from "electron";
import { createForkDebUpdateService } from "./fork-deb-update-service.js";
import { FORK_REPOSITORY } from "./fork-build-info.js";
import { electronReleaseRuntime } from "./official-release-electron.js";

export const forkDebUpdateService = createForkDebUpdateService({
  runtime: electronReleaseRuntime,
  repository: FORK_REPOSITORY,
  arch: process.arch,
  canInstall: app.isPackaged,
});
