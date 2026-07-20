import { execFile } from "node:child_process";
import { copyFile, cp, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT_DIRECTORY = path.join(REPO_ROOT, "artifacts", "fork-daemon");
const STAGE_DIRECTORY = path.join(OUTPUT_DIRECTORY, "package");
const OUTPUT_TARBALL = path.join(OUTPUT_DIRECTORY, "paseo-fork.tgz");
const PACKAGE_NAME = "@hamiltonhuaji/paseo-fork";
const INSTALL_SPEC =
  "https://github.com/HamiltonHuaji/paseo/releases/latest/download/paseo-fork.tgz";
const INTERNAL_PACKAGE_DIRECTORIES = [
  "packages/highlight",
  "packages/protocol",
  "packages/client",
  "packages/relay",
  "packages/server",
];
const INTERNAL_PACKAGE_NAMES = INTERNAL_PACKAGE_DIRECTORIES.map(
  (directory) => `@getpaseo/${path.basename(directory)}`,
);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function sortedObject(entries) {
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
}

function mergeExternalDependencies(packageManifests, internalPackageNames) {
  const dependencies = new Map();
  for (const manifest of packageManifests) {
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      if (internalPackageNames.has(name)) continue;
      const existing = dependencies.get(name);
      if (existing && existing !== version) {
        throw new Error(`Conflicting dependency ranges for ${name}: ${existing} and ${version}`);
      }
      dependencies.set(name, version);
    }
  }
  return dependencies;
}

export function buildBundledInternalPackageManifest(packageManifest, distributionIdentity) {
  const bundledManifest = structuredClone(packageManifest);
  delete bundledManifest.dependencies;
  bundledManifest.paseoDistribution = distributionIdentity;
  return bundledManifest;
}

export function buildForkDaemonPackageManifest({
  rootManifest,
  cliManifest,
  internalManifests,
  forkMetadata,
}) {
  const version = `${forkMetadata.upstreamBaseVersion}-fork.${forkMetadata.revision}`;
  const internalPackageNames = new Set(internalManifests.map((manifest) => manifest.name));
  for (const manifest of [cliManifest, ...internalManifests]) {
    if (manifest.version !== forkMetadata.upstreamBaseVersion) {
      throw new Error(
        `${manifest.name} is ${manifest.version}, expected upstream baseline ${forkMetadata.upstreamBaseVersion}`,
      );
    }
  }

  const dependencies = mergeExternalDependencies(
    [cliManifest, ...internalManifests],
    internalPackageNames,
  );
  for (const manifest of internalManifests) {
    dependencies.set(manifest.name, manifest.version);
  }

  return {
    name: PACKAGE_NAME,
    version,
    description: "Paseo fork CLI and daemon in one globally installable npm package",
    type: "module",
    bin: { paseo: "bin/paseo" },
    files: ["bin", "dist", "paseo-distribution.json", "README.md", "LICENSE"],
    bundleDependencies: internalManifests.map((manifest) => manifest.name).sort(),
    dependencies: sortedObject(dependencies.entries()),
    license: rootManifest.license,
    repository: {
      type: "git",
      url: "https://github.com/HamiltonHuaji/paseo.git",
    },
  };
}

export function buildDistributionManifest(packageManifest, internalManifests) {
  const serverManifest = internalManifests.find((manifest) => manifest.name === "@getpaseo/server");
  if (!serverManifest) {
    throw new Error("The fork daemon package requires @getpaseo/server");
  }
  return {
    schemaVersion: 1,
    packageName: packageManifest.name,
    version: packageManifest.version,
    serverVersion: serverManifest.version,
    installSpec: INSTALL_SPEC,
    internalPackages: sortedObject(
      internalManifests.map((manifest) => [manifest.name, manifest.version]),
    ),
  };
}

async function listPackedFiles(packageDirectory) {
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", packageDirectory, "--dry-run", "--ignore-scripts", "--json"],
    { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 },
  );
  const result = JSON.parse(stdout)[0];
  if (!result?.files) {
    throw new Error(`npm pack did not report files for ${packageDirectory}`);
  }
  return result.files.map((entry) => entry.path);
}

async function copyPackedPackage(packageDirectory, targetDirectory, distributionIdentity) {
  const files = await listPackedFiles(packageDirectory);
  for (const relativePath of files) {
    const sourcePath = path.join(packageDirectory, relativePath);
    const sourceInfo = await lstat(sourcePath);
    if (sourceInfo.isSymbolicLink()) {
      throw new Error(`Refusing to bundle symlink ${sourcePath}`);
    }
    const targetPath = path.join(targetDirectory, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }

  const packageJsonPath = path.join(targetDirectory, "package.json");
  const packageJson = await readJson(packageJsonPath);
  const bundledPackageJson = buildBundledInternalPackageManifest(packageJson, distributionIdentity);
  await writeFile(packageJsonPath, `${JSON.stringify(bundledPackageJson, null, 2)}\n`);
}

async function copyCliPayload() {
  const cliDirectory = path.join(REPO_ROOT, "packages", "cli");
  const files = await listPackedFiles(cliDirectory);
  for (const relativePath of files) {
    if (relativePath === "package.json" || relativePath === "bin/paseo") continue;
    const sourcePath = path.join(cliDirectory, relativePath);
    const targetPath = path.join(STAGE_DIRECTORY, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

async function packStage() {
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", STAGE_DIRECTORY, "--ignore-scripts", "--json", "--pack-destination", OUTPUT_DIRECTORY],
    { cwd: REPO_ROOT, maxBuffer: 20 * 1024 * 1024 },
  );
  const result = JSON.parse(stdout)[0];
  if (!result?.filename) {
    throw new Error("npm pack did not produce a tarball");
  }
  const bundled = new Set(result.bundled ?? []);
  const missingPackages = INTERNAL_PACKAGE_NAMES.filter((name) => !bundled.has(name));
  const unexpectedPackages = [...bundled].filter((name) => !INTERNAL_PACKAGE_NAMES.includes(name));
  if (missingPackages.length > 0 || unexpectedPackages.length > 0) {
    throw new Error(
      `npm packed the wrong internal packages (missing: ${missingPackages.join(", ") || "none"}; unexpected: ${unexpectedPackages.join(", ") || "none"})`,
    );
  }

  const packedPath = path.join(OUTPUT_DIRECTORY, result.filename);
  await rm(OUTPUT_TARBALL, { force: true });
  await rename(packedPath, OUTPUT_TARBALL);
  return {
    path: OUTPUT_TARBALL,
    size: result.size,
    bundled: [...bundled].sort(),
  };
}

export async function packForkDaemon() {
  const rootManifest = await readJson(path.join(REPO_ROOT, "package.json"));
  const cliManifest = await readJson(path.join(REPO_ROOT, "packages", "cli", "package.json"));
  const forkMetadata = await readJson(
    path.join(REPO_ROOT, "packages", "desktop", "src", "features", "fork-build-info.json"),
  );
  const internalManifests = await Promise.all(
    INTERNAL_PACKAGE_DIRECTORIES.map((directory) =>
      readJson(path.join(REPO_ROOT, directory, "package.json")),
    ),
  );
  const packageManifest = buildForkDaemonPackageManifest({
    rootManifest,
    cliManifest,
    internalManifests,
    forkMetadata,
  });
  const distributionManifest = buildDistributionManifest(packageManifest, internalManifests);
  const distributionIdentity = {
    packageName: packageManifest.name,
    version: packageManifest.version,
  };

  await rm(OUTPUT_DIRECTORY, { recursive: true, force: true });
  await mkdir(path.join(STAGE_DIRECTORY, "node_modules"), { recursive: true });
  await copyCliPayload();
  await cp(
    path.join(REPO_ROOT, "packaging", "fork-daemon", "bin"),
    path.join(STAGE_DIRECTORY, "bin"),
    { recursive: true },
  );
  await copyFile(
    path.join(REPO_ROOT, "packaging", "fork-daemon", "README.md"),
    path.join(STAGE_DIRECTORY, "README.md"),
  );
  await copyFile(path.join(REPO_ROOT, "LICENSE"), path.join(STAGE_DIRECTORY, "LICENSE"));

  for (const directory of INTERNAL_PACKAGE_DIRECTORIES) {
    const manifest = internalManifests.find(
      (candidate) => candidate.name === `@getpaseo/${path.basename(directory)}`,
    );
    if (!manifest) {
      throw new Error(`Missing package manifest for ${directory}`);
    }
    const targetDirectory = path.join(STAGE_DIRECTORY, "node_modules", ...manifest.name.split("/"));
    await copyPackedPackage(path.join(REPO_ROOT, directory), targetDirectory, distributionIdentity);
  }

  await writeFile(
    path.join(STAGE_DIRECTORY, "package.json"),
    `${JSON.stringify(packageManifest, null, 2)}\n`,
  );
  await writeFile(
    path.join(STAGE_DIRECTORY, "paseo-distribution.json"),
    `${JSON.stringify(distributionManifest, null, 2)}\n`,
  );

  const result = await packStage();
  await rm(STAGE_DIRECTORY, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  packForkDaemon().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
