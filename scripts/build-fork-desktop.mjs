import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readForkBuildMetadata } from "./fork-version-utils.mjs";

const requireFromDesktop = createRequire(
  new URL("../packages/desktop/package.json", import.meta.url),
);
const buildArgs = process.argv.slice(2);
// electron-builder parses duplicate --publish values as an array, which bypasses
// its "never" comparison. This wrapper owns the single non-publishing policy.
if (
  buildArgs.some(
    (arg) => arg === "--publish" || arg.startsWith("--publish=") || arg.startsWith("-p"),
  )
) {
  throw new Error(
    "Omit --publish/-p: fork builds never publish; the release workflow uploads artifacts.",
  );
}
const result = spawnSync(
  process.execPath,
  [
    requireFromDesktop.resolve("electron-builder/cli.js"),
    "--config",
    "electron-builder.yml",
    ...buildArgs,
    `-c.extraMetadata.version=${readForkBuildMetadata().version}`,
    "--publish",
    "never",
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
