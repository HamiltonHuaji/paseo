import { cpSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const build = spawnSync(npmExecutable, ["run", "build:web", "--workspace=@getpaseo/app"], {
  cwd: repositoryRoot,
  env: { ...process.env, PASEO_WEB_PLATFORM: "vscode" },
  stdio: "inherit",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const source = resolve(repositoryRoot, "packages/app/dist");
const destination = resolve(repositoryRoot, "packages/vscode/webview-app");
rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });

for (const filePath of walkFiles(destination)) {
  if (!filePath.endsWith(".js")) {
    continue;
  }
  const sourceCode = readFileSync(filePath, "utf8");
  const rewritten = sourceCode
    .replaceAll('uri:"/assets/', 'uri:globalThis.__PASEO_VSCODE_RESOURCE_ROOT__+"/assets/')
    .replaceAll("uri:'/assets/", "uri:globalThis.__PASEO_VSCODE_RESOURCE_ROOT__+'/assets/");
  if (/["']\/_expo\/static\/js\//.test(rewritten)) {
    throw new Error(
      `The VS Code web bundle contains a root-relative dynamic chunk in ${filePath}. Add a vscode platform implementation that avoids this split point.`,
    );
  }
  if (/uri:["']\.?\/assets\//.test(rewritten)) {
    throw new Error(`The VS Code web bundle contains an unscoped asset URI in ${filePath}.`);
  }
  if (rewritten !== sourceCode) {
    writeFileSync(filePath, rewritten);
  }
}

function walkFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? walkFiles(path) : [path];
  });
}
