import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isRealpathInsideRoot } from "../../../utils/path.js";
import type { PaseoDaemonDistribution } from "./distribution.js";
import type { NpmGlobalPaseoInstall } from "./npm-global-cli.js";

const PackageJsonSchema = z.object({ name: z.string().optional() }).passthrough();

export interface DaemonInstallOriginRuntime {
  resolveCurrentServerPackageRoot(): string | null;
}

export const daemonInstallOriginRuntime: DaemonInstallOriginRuntime = {
  resolveCurrentServerPackageRoot,
};

export function validateDaemonInstallOrigin(
  install: NpmGlobalPaseoInstall,
  daemonVersion: string | null,
  distribution: PaseoDaemonDistribution,
  runtime: DaemonInstallOriginRuntime = daemonInstallOriginRuntime,
): string | null {
  if (install.isLinked) {
    return `The global ${distribution.packageName} install is linked; self-update only supports normal npm global installs.`;
  }

  if (distribution.kind === "bundled" && install.version !== distribution.version) {
    return `This daemon distribution is ${distribution.version}, but the global ${distribution.packageName} install is ${install.version}.`;
  }

  const expectedServerVersion =
    distribution.kind === "bundled" ? distribution.serverVersion : install.version;
  if (daemonVersion && expectedServerVersion !== daemonVersion) {
    if (distribution.kind === "official") {
      return `This daemon is not running from the npm global ${distribution.packageName} install (global npm has ${install.version}, daemon is ${daemonVersion}).`;
    }
    return `This daemon is not running from the npm global ${distribution.packageName} install (expected daemon ${expectedServerVersion}, daemon is ${daemonVersion}).`;
  }

  const currentServerPackageRoot = runtime.resolveCurrentServerPackageRoot();
  if (!currentServerPackageRoot) {
    return "Unable to verify that this daemon is running from an npm global install.";
  }

  if (!isCurrentServerUnderNpmInstall(currentServerPackageRoot, install, distribution)) {
    return `This daemon is not running from the npm global ${distribution.packageName} install.`;
  }

  return null;
}

function isCurrentServerUnderNpmInstall(
  currentServerPackageRoot: string,
  install: NpmGlobalPaseoInstall,
  distribution: PaseoDaemonDistribution,
): boolean {
  if (distribution.kind === "bundled") {
    const manifestBelongsToInstall = isRealpathInsideRoot(
      install.packagePath,
      distribution.packageRoot,
    );
    return (
      manifestBelongsToInstall &&
      isRealpathInsideRoot(install.packagePath, currentServerPackageRoot)
    );
  }

  const roots = install.globalRootPath
    ? [install.packagePath, globalNodeModulesPath(install.globalRootPath)]
    : [install.packagePath];

  return roots.some((root) => isRealpathInsideRoot(root, currentServerPackageRoot));
}

function globalNodeModulesPath(globalRootPath: string): string {
  const normalized = path.normalize(globalRootPath);
  return path.basename(normalized) === "node_modules"
    ? normalized
    : path.join(normalized, "node_modules");
}

function resolveCurrentServerPackageRoot(): string | null {
  return resolvePackageRootFrom(fileURLToPath(import.meta.url), "@getpaseo/server");
}

function resolvePackageRootFrom(startPath: string, packageName: string): string | null {
  let currentDir = path.dirname(startPath);

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = PackageJsonSchema.parse(
          JSON.parse(readFileSync(packageJsonPath, "utf8")),
        );
        if (packageJson.name === packageName) {
          return currentDir;
        }
      } catch {
        return null;
      }
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}
