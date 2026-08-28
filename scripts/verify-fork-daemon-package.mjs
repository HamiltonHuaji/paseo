import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tarballPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!tarballPath)
  throw new Error("Usage: node scripts/verify-fork-daemon-package.mjs <package.tgz>");

const testRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-fork-package-"));
const prefix = path.join(testRoot, "prefix");

function runNpm(args) {
  return execFileAsync("npm", args, { maxBuffer: 20 * 1024 * 1024 });
}

async function createFixturePackage(relativeDirectory, manifest, executable) {
  const packageDirectory = path.join(testRoot, relativeDirectory);
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(path.join(packageDirectory, "package.json"), `${JSON.stringify(manifest)}\n`);
  if (executable) {
    const executablePath = path.join(packageDirectory, executable.path);
    await writeFile(executablePath, executable.contents);
    await chmod(executablePath, 0o755);
  }
  return packageDirectory;
}

try {
  const officialCli = await createFixturePackage(
    "official-cli",
    { name: "@getpaseo/cli", version: "999.0.0", bin: { paseo: "paseo.js" } },
    { path: "paseo.js", contents: "#!/usr/bin/env node\nconsole.log('official fixture')\n" },
  );
  const poisonServer = await createFixturePackage(
    "official-server",
    { name: "@getpaseo/server", version: "999.0.0", type: "module", main: "index.js" },
    { path: "index.js", contents: "throw new Error('loaded official server fixture')\n" },
  );

  await runNpm(["install", "-g", "--prefix", prefix, officialCli, poisonServer]);
  await runNpm(["install", "-g", "--prefix", prefix, "--force", "--ignore-scripts", tarballPath]);

  const binPath =
    process.platform === "win32"
      ? path.join(prefix, "paseo.cmd")
      : path.join(prefix, "bin", "paseo");
  const { stdout: versionOutput } = await execFileAsync(binPath, ["--version"], {
    cwd: testRoot,
    maxBuffer: 10 * 1024 * 1024,
  });
  const { stdout: installedJson } = await runNpm([
    "ls",
    "-g",
    "--prefix",
    prefix,
    "--depth=0",
    "--json",
  ]);
  const installed = JSON.parse(installedJson).dependencies;
  const forkVersion = installed?.["@hamiltonhuaji/paseo-fork"]?.version;
  if (!forkVersion || versionOutput.trim() !== forkVersion) {
    throw new Error(
      `Expected paseo --version to report installed fork ${forkVersion}, got ${versionOutput.trim()}`,
    );
  }
  if (installed?.["@getpaseo/cli"]?.version !== "999.0.0") {
    throw new Error("The official CLI fixture did not remain installed beside the fork");
  }

  const { stdout: globalRootOutput } = await runNpm(["root", "-g", "--prefix", prefix]);
  const forkPackageRoot = path.join(globalRootOutput.trim(), "@hamiltonhuaji", "paseo-fork");
  const terminalModulePath = path.join(
    forkPackageRoot,
    "node_modules",
    "@getpaseo",
    "server",
    "dist",
    "server",
    "terminal",
    "terminal.js",
  );
  const probeEnvironment = { ...process.env };
  delete probeEnvironment.PASEO_CLI;
  const { stdout: resolvedCliOutput } = await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      'const { pathToFileURL } = await import("node:url"); const module = await import(pathToFileURL(process.argv[1]).href); console.log(module.resolvePaseoCliExecutablePath());',
      terminalModulePath,
    ],
    { cwd: testRoot, env: probeEnvironment, maxBuffer: 10 * 1024 * 1024 },
  );
  const expectedBundledCli = path.join(forkPackageRoot, "bin", "paseo");
  if (resolvedCliOutput.trim() !== expectedBundledCli) {
    throw new Error(
      `Expected bundled daemon to resolve ${expectedBundledCli}, got ${resolvedCliOutput.trim()}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      verified: true,
      version: forkVersion,
      officialCliStillInstalled: true,
      bundledCli: resolvedCliOutput.trim(),
    })}\n`,
  );
} finally {
  await rm(testRoot, { recursive: true, force: true });
}
