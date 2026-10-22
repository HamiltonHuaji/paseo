import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import { currentDaemonDistribution, type PaseoDaemonDistribution } from "./distribution.js";

const require = createRequire(import.meta.url);
const PASEO_CLI_BIN_ENTRY = "@getpaseo/cli/bin/paseo";

function resolveExternalProcessPath(filePath: string): string {
  return filePath.replace(/\.asar(?=[/\\]|$)/, ".asar.unpacked");
}

export function resolvePaseoCliBinDir(): string | null {
  const cliExecutable = resolvePaseoCliExecutablePath();
  return cliExecutable ? dirname(cliExecutable) : null;
}

export function resolvePaseoCliExecutablePath(): string | null {
  const configuredCli = process.env.PASEO_CLI?.trim();
  if (configuredCli) {
    return resolvePath(configuredCli);
  }

  if (currentDaemonDistribution.kind !== "official") {
    return resolveDistributionPaseoCliEntrypoint(currentDaemonDistribution);
  }

  const cliEntrypoint = resolvePaseoCliBinEntrypoint();
  if (!cliEntrypoint) {
    return null;
  }

  const externalCliEntrypoint = resolveExternalProcessPath(cliEntrypoint);
  const npmBinDir = findNpmBinDir(dirname(externalCliEntrypoint));
  if (npmBinDir) {
    const shim = resolvePaseoCliShim(npmBinDir);
    if (shim) {
      return shim;
    }
  }

  return externalCliEntrypoint;
}

export function resolveDistributionPaseoCliEntrypoint(
  distribution: PaseoDaemonDistribution,
): string | null {
  if (distribution.kind === "official") return null;
  const cliRoot =
    distribution.kind === "source"
      ? join(distribution.packageRoot, "packages", "cli")
      : distribution.packageRoot;
  const cliEntrypoint = join(cliRoot, "bin", "paseo");
  return existsSync(cliEntrypoint) && existsSync(join(cliRoot, "dist", "index.js"))
    ? resolvePath(cliEntrypoint)
    : null;
}

export function resolveBundledPaseoCliEntrypoint(
  distribution: PaseoDaemonDistribution,
): string | null {
  return distribution.kind === "bundled"
    ? resolveDistributionPaseoCliEntrypoint(distribution)
    : null;
}

function resolvePaseoCliBinEntrypoint(): string | null {
  try {
    return require.resolve(PASEO_CLI_BIN_ENTRY);
  } catch {
    return null;
  }
}

function findNpmBinDir(startPath: string): string | null {
  let current = startPath;
  while (true) {
    const candidate = join(current, "node_modules", ".bin");
    if (hasPaseoCliShim(candidate)) {
      return candidate;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function hasPaseoCliShim(binDir: string): boolean {
  return resolvePaseoCliShim(binDir) !== null;
}

function resolvePaseoCliShim(binDir: string): string | null {
  for (const name of paseoCliShimNames()) {
    const candidate = join(binDir, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function paseoCliShimNames(): string[] {
  return process.platform === "win32" ? ["paseo.cmd", "paseo.exe", "paseo"] : ["paseo"];
}
