import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface CliPackageJson {
  name?: unknown;
  version?: unknown;
}

export function resolveCliVersion(): string {
  const packageJson = require("../package.json") as CliPackageJson;
  // A packaged fork owns its version even when installed beneath a checkout.
  // Source metadata applies only to the workspace CLI, never across node_modules.
  if (packageJson.name === "@getpaseo/cli") {
    let directory = dirname(fileURLToPath(import.meta.url));
    while (dirname(directory) !== directory && basename(directory) !== "node_modules") {
      const metadataPath = join(directory, "packages/desktop/src/features/fork-build-info.json");
      if (existsSync(metadataPath)) {
        const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as CliPackageJson;
        if (typeof metadata.version === "string" && metadata.version.trim())
          return metadata.version.trim();
      }
      directory = dirname(directory);
    }
  }
  if (typeof packageJson.version === "string" && packageJson.version.trim().length > 0) {
    return packageJson.version.trim();
  }
  throw new Error("Unable to resolve @getpaseo/cli version from package.json.");
}
