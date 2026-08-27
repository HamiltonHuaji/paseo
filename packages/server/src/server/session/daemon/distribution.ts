import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const DISTRIBUTION_MANIFEST_NAME = "paseo-distribution.json";

const DistributionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  packageName: z.string().min(1),
  version: z.string().min(1),
  serverVersion: z.string().min(1),
  installSpec: z.string().min(1),
});

export interface OfficialPaseoDistribution {
  kind: "official";
  packageName: "@getpaseo/cli";
  installSpec: "@getpaseo/cli@latest";
}

export interface BundledPaseoDistribution {
  kind: "bundled";
  packageName: string;
  version: string;
  serverVersion: string;
  installSpec: string;
  packageRoot: string;
}

export type PaseoDaemonDistribution = OfficialPaseoDistribution | BundledPaseoDistribution;

export const OFFICIAL_PASEO_DISTRIBUTION: OfficialPaseoDistribution = {
  kind: "official",
  packageName: "@getpaseo/cli",
  installSpec: "@getpaseo/cli@latest",
};

export function resolveDaemonDistributionFrom(startPath: string): PaseoDaemonDistribution {
  let currentDirectory = path.dirname(startPath);

  while (true) {
    const manifestPath = path.join(currentDirectory, DISTRIBUTION_MANIFEST_NAME);
    if (existsSync(manifestPath)) {
      let rawManifest: unknown;
      try {
        rawManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch {
        throw new Error(`Invalid Paseo distribution manifest at ${manifestPath}`);
      }
      const parsed = DistributionManifestSchema.safeParse(rawManifest);
      if (!parsed.success) {
        throw new Error(`Invalid Paseo distribution manifest at ${manifestPath}`);
      }
      return {
        kind: "bundled",
        packageName: parsed.data.packageName,
        version: parsed.data.version,
        serverVersion: parsed.data.serverVersion,
        installSpec: parsed.data.installSpec,
        packageRoot: currentDirectory,
      };
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return OFFICIAL_PASEO_DISTRIBUTION;
    }
    currentDirectory = parentDirectory;
  }
}

export const currentDaemonDistribution = resolveDaemonDistributionFrom(
  fileURLToPath(import.meta.url),
);
