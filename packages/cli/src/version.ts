import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface CliPackageJson {
  version?: unknown;
}

export function resolveCliVersion(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (dirname(directory) !== directory) {
    const metadataPath = join(directory, "packages/desktop/src/features/fork-build-info.json");
    if (existsSync(metadataPath)) {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as CliPackageJson;
      if (typeof metadata.version === "string" && metadata.version.trim())
        return metadata.version.trim();
    }
    directory = dirname(directory);
  }
  const packageJson = require("../package.json") as CliPackageJson;
  if (typeof packageJson.version === "string" && packageJson.version.trim().length > 0) {
    return packageJson.version.trim();
  }
  throw new Error("Unable to resolve @getpaseo/cli version from package.json.");
}
