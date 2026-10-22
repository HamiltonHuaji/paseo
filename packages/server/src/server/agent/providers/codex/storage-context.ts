import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SHARED_RESOURCES = {
  auth: "auth.json",
  config: "config.toml",
  skills: "skills",
  prompts: "prompts",
} as const;

export function codexUserHome(environment: Record<string, string>): string {
  return path.resolve(
    environment.CODEX_HOME ?? path.join(environment.HOME ?? os.homedir(), ".codex"),
  );
}

/** Persist this home with the native handle: cwd is execution placement, not storage ownership. */
export async function resolveCodexStorageEnvironment(
  environment: Record<string, string>,
  cwd: string | undefined,
  persistedHome?: string,
  legacy = false,
): Promise<Record<string, string>> {
  const userHome = codexUserHome(environment);
  if (persistedHome) {
    const home = path.resolve(persistedHome);
    const marker = await fs
      .readFile(path.join(home, ".paseo-storage.json"), "utf8")
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (marker) {
      const stored: unknown = JSON.parse(marker);
      if (
        stored &&
        typeof stored === "object" &&
        "userHome" in stored &&
        typeof stored.userHome === "string"
      ) {
        await reconcileSharedResources(
          home,
          stored.userHome,
          environment.PASEO_CODEX_SHARED_RESOURCES,
        );
      }
    }
    return { ...environment, CODEX_HOME: home };
  }
  const mode = environment.PASEO_CODEX_STORAGE ?? "global";
  if (mode !== "global" && mode !== "project") {
    throw new Error("PASEO_CODEX_STORAGE must be global or project");
  }
  // Existing handles without a storage marker continue to use their original user home.
  if (legacy || mode === "global" || !cwd) return { ...environment, CODEX_HOME: userHome };

  const root = await fs.realpath(environment.PASEO_CODEX_PROJECT_ROOT ?? cwd);
  let owner: string;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", maxBuffer: 64 * 1024 },
    );
    owner = path.join(await fs.realpath(stdout.trim()), "paseo", "codex");
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (failure.code !== "ENOENT" && !failure.stderr?.includes("not a git repository")) throw error;
    owner = path.join(root, ".paseo", "provider-data", "codex");
  }
  // Separate custom CODEX_HOME profiles, including their config and credentials.
  const profile = createHash("sha256").update(userHome).digest("hex").slice(0, 16);
  const home = path.join(owner, profile);
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  await fs
    .writeFile(path.join(home, ".gitignore"), "*\n", { flag: "wx", mode: 0o600 })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  await fs
    .writeFile(path.join(home, ".paseo-storage.json"), JSON.stringify({ userHome }), {
      flag: "wx",
      mode: 0o600,
    })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  await reconcileSharedResources(home, userHome, environment.PASEO_CODEX_SHARED_RESOURCES);
  return { ...environment, CODEX_HOME: home };
}

async function reconcileSharedResources(
  home: string,
  userHome: string,
  selection: string | undefined,
): Promise<void> {
  const resources = new Set(
    (selection ?? "auth,config,skills,prompts")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const resource of resources) {
    if (!Object.hasOwn(SHARED_RESOURCES, resource))
      throw new Error(`Unknown shared Codex resource: ${resource}`);
  }
  for (const [resource, name] of Object.entries(SHARED_RESOURCES)) {
    const source = path.join(userHome, name);
    const target = path.join(home, name);
    if (!resources.has(resource)) {
      const linked = await fs.readlink(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "EINVAL") return undefined;
        throw error;
      });
      if (linked === source) await fs.unlink(target);
      continue;
    }
    try {
      await fs.symlink(
        source,
        target,
        resource === "skills" || resource === "prompts" ? "dir" : "file",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Existing local content belongs to the user, regardless of this setting.
    }
  }
}

/** Locate native history without resuming a writer or moving the source rollout. */
export async function findCodexRollout(
  home: string,
  sessionId: string,
): Promise<string | undefined> {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) throw new Error("Invalid Codex session identifier");
  const directories = [path.join(home, "sessions"), path.join(home, "archived_sessions")];
  while (directories.length) {
    const directory = directories.pop()!;
    const entries = await fs
      .readdir(directory, { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
    for (const entry of entries) {
      if (entry.isDirectory()) directories.push(path.join(directory, entry.name));
      else if (entry.isFile() && entry.name.endsWith(`${sessionId}.jsonl`))
        return path.join(directory, entry.name);
    }
  }
  return undefined;
}
