import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readForkBuildMetadata } from "./fork-version-utils.mjs";

const requireFromDesktop = createRequire(
  new URL("../packages/desktop/package.json", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [
    requireFromDesktop.resolve("electron-builder/cli.js"),
    "--config",
    "electron-builder.yml",
    ...process.argv.slice(2),
    `-c.extraMetadata.version=${readForkBuildMetadata().version}`,
    "--publish",
    "never",
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
