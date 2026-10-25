import { nodeFileTrace, resolve } from "@vercel/nft";
import { transform } from "esbuild";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import semver from "semver";
import { x as extract } from "tar";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const inside = (root, file) => file === root || file.startsWith(`${root}${path.sep}`);

// The fork owns peers of private bundled packages. Preserve the original peer
// requirements while checking the outer declaration, before removing them.
export function checkBundledPeers(manifest, dependencies) {
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
    const provided = dependencies[name];
    if (!provided && manifest.peerDependenciesMeta?.[name]?.optional) continue;
    if (!provided || !semver.validRange(provided) || !semver.subset(provided, range)) {
      throw new Error(
        `${manifest.name}: required peer ${name}@${range} is not covered by distribution dependency ${provided ?? "<missing>"}`,
      );
    }
  }
}

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? filesIn(file) : [file];
    }),
  );
  return files.flat();
}

function packageName(specifier) {
  return specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");
}

async function packageDirectory(entry, name) {
  let directory = path.dirname(entry);
  while (directory !== path.dirname(directory)) {
    try {
      if ((await readJson(path.join(directory, "package.json"))).name === name) return directory;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Cannot locate package ${name} from ${entry}`);
}

async function readPackages(root, files) {
  const manifests = files.filter((file) => {
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    return (
      relative === "package.json" ||
      /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(relative)
    );
  });
  const packages = await Promise.all(
    manifests.map(async (file) => ({
      directory: path.dirname(file),
      manifest: await readJson(file),
    })),
  );
  return packages.sort((a, b) => b.directory.length - a.directory.length);
}

function ownerOf(packages, file) {
  return packages.find((pkg) => inside(pkg.directory, file));
}

function dependencyFor(packages, owner, name) {
  for (const pkg of packages) {
    if (!inside(pkg.directory, owner.directory)) continue;
    const range = pkg.manifest.dependencies?.[name] ?? pkg.manifest.optionalDependencies?.[name];
    if (range) return { range, owner: pkg };
  }
  return null;
}

function checkManifests(packages, root) {
  const distribution = ownerOf(packages, root);
  for (const pkg of packages) {
    if (pkg === distribution) continue;
    if (Object.keys(pkg.manifest.peerDependencies ?? {}).length > 0) {
      throw new Error(
        `${pkg.manifest.name}: bundled peerDependencies must be owned by the distribution`,
      );
    }
    const parent = ownerOf(packages, path.dirname(pkg.directory));
    const requirement = dependencyFor(packages, parent, pkg.manifest.name);
    if (!requirement || !semver.satisfies(pkg.manifest.version, requirement.range)) {
      throw new Error(
        `${pkg.manifest.name}@${pkg.manifest.version}: bundled version does not satisfy ${requirement?.range ?? "<missing dependency>"}`,
      );
    }
  }
  for (const name of distribution.manifest.bundleDependencies ?? []) {
    if (!packages.some((pkg) => pkg.directory === path.join(root, "node_modules", name))) {
      throw new Error(`${name}: declared bundled dependency is missing from the tarball`);
    }
  }
}

async function tracePackage(root, files, packages) {
  const sources = new Map([[root, path.join(REPO_ROOT, "packages", "cli")]]);
  const workspaces = new Map();
  for (const directory of (await readJson(path.join(REPO_ROOT, "package.json"))).workspaces) {
    const source = path.join(REPO_ROOT, directory);
    workspaces.set((await readJson(path.join(source, "package.json"))).name, source);
  }
  const external = new Set();
  const failures = new Set();
  async function sourceDirectory(owner) {
    if (!sources.has(owner.directory)) {
      if (workspaces.has(owner.manifest.name)) {
        sources.set(owner.directory, workspaces.get(owner.manifest.name));
      } else {
        const parent = ownerOf(packages, path.dirname(owner.directory));
        const from = createRequire(path.join(await sourceDirectory(parent), "package.json"));
        sources.set(
          owner.directory,
          await packageDirectory(from.resolve(owner.manifest.name), owner.manifest.name),
        );
      }
    }
    return sources.get(owner.directory);
  }
  // Process boundaries and runtime-loaded plugins are independent graph roots.
  // Browser plugin exports are consumed by the app build, not by the daemon.
  const entries = [
    "bin/paseo",
    "dist/index.js",
    "node_modules/@getpaseo/client/dist/node/index.js",
    "node_modules/@getpaseo/server/dist/scripts/supervisor-entrypoint.js",
    "node_modules/@getpaseo/server/dist/server/server/daemon-worker.js",
    "node_modules/@getpaseo/server/dist/server/terminal/terminal-worker-process.js",
    "node_modules/@getpaseo/server/dist/server/server/plugins/plugin-process.js",
    "node_modules/@getpaseo/server/dist/server/server/speech/providers/local/worker-process.js",
  ].map((file) => path.join(root, file));
  entries.push(
    ...files.filter(
      (file) =>
        file.endsWith("index.server.ts") || file.endsWith("mcp-stdio-socket-bridge-cli.mjs"),
    ),
  );
  const { warnings, fileList } = await nodeFileTrace(entries, {
    base: root,
    exportsOnly: true,
    analysis: { emitGlobs: false, computeFileReferences: false, evaluatePureExpressions: true },
    async readFile(file) {
      // External packages are installed by npm. Inspect their exports during
      // resolution, but do not turn this into a lint of third-party source.
      if (!inside(root, file) && !file.endsWith("package.json")) return "";
      try {
        const source = await readFile(file, "utf8");
        return file.endsWith(".ts")
          ? (await transform(source, { loader: "ts", format: "esm" })).code
          : source;
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "EISDIR") return null;
        throw error;
      }
    },
    async resolve(id, parent, job, cjs) {
      if (isBuiltin(id)) return `node:${id.replace(/^node:/, "")}`;
      async function resolvePacked() {
        const resolved = await resolve(id, parent, job, cjs);
        for (const file of [resolved].flat()) {
          if (!inside(root, file)) {
            throw new Error(`${path.relative(root, parent)}: ${id} resolves outside the tarball`);
          }
        }
        return resolved;
      }
      const owner = ownerOf(packages, parent);
      if (id.startsWith(".") || id.startsWith("/") || id.startsWith("#")) {
        return resolvePacked();
      }
      const name = packageName(id);
      const requirement = dependencyFor(packages, owner, name);
      if (!requirement && name !== owner.manifest.name) {
        const original = await readJson(path.join(await sourceDirectory(owner), "package.json"));
        if (original.peerDependenciesMeta?.[name]?.optional) return `node:${id}`;
        failures.add(`${path.relative(root, parent)}: undeclared runtime dependency ${name}`);
        return `node:${id}`;
      }
      const bundled =
        name === owner.manifest.name ||
        packages.some(
          (pkg) =>
            inside(pkg.directory, owner.directory) &&
            packages.some(
              (candidate) => candidate.directory === path.join(pkg.directory, "node_modules", name),
            ),
        );
      if (bundled) return resolvePacked();
      const source = path.join(
        await sourceDirectory(owner),
        path.relative(owner.directory, parent),
      );
      const resolved = await resolve(id, source, job, cjs);
      const entry = Array.isArray(resolved) ? resolved[0] : resolved;
      const manifest = await readJson(
        path.join(await packageDirectory(entry, name), "package.json"),
      );
      if (!semver.satisfies(manifest.version, requirement.range)) {
        failures.add(
          `${path.relative(root, parent)}: ${name}@${manifest.version} does not satisfy ${requirement.range}`,
        );
      }
      external.add(name);
      return resolved;
    },
  });
  for (const warning of warnings) failures.add(warning.message);
  if (failures.size) throw new Error([...failures].sort().join("\n"));
  return { entrypoints: entries.length, files: fileList.size, externalDependencies: external.size };
}

export async function checkForkDaemonDependencies(tarball) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "paseo-dependencies-"));
  try {
    await extract({ file: tarball, cwd: temporary, strict: true });
    const root = path.join(temporary, "package");
    const files = await filesIn(root);
    const packages = await readPackages(root, files);
    checkManifests(packages, root);
    const result = await tracePackage(root, files, packages);
    return { packages: packages.length, ...result };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const tarball = path.resolve(process.argv[2] ?? "artifacts/fork-daemon/paseo-fork.tgz");
  checkForkDaemonDependencies(tarball).then(
    (result) => process.stdout.write(`${JSON.stringify(result)}\n`),
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
