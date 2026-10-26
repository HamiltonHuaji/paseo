import { terminateWithTreeKill } from "../../../utils/tree-kill.js";
import type { ChildProcess } from "node:child_process";
import { lstatSync } from "node:fs";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import stripAnsi from "strip-ansi";
import { z } from "zod";
import { execCommand, spawnProcess } from "../../../utils/spawn.js";
import {
  currentDaemonDistribution,
  OFFICIAL_PASEO_DISTRIBUTION,
  type PaseoDaemonDistribution,
} from "./distribution.js";

const NPM_PROBE_TIMEOUT_MS = 10_000;
const NPM_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const NPM_OUTPUT_FLUSH_INTERVAL_MS = 250;
const NPM_OUTPUT_CHUNK_LIMIT = 4096;

const NpmGlobalListSchema = z
  .object({
    path: z.string().optional(),
    dependencies: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const NpmGlobalCliPackageSchema = z
  .object({
    version: z.string(),
    path: z.string(),
  })
  .passthrough();

const CommandErrorSchema = z
  .object({
    code: z.union([z.number(), z.string()]).optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  })
  .passthrough();

export interface CommandOptions {
  timeout?: number;
  signal?: AbortSignal;
  maxBuffer?: number;
  onOutput?: (output: string) => void;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface NpmGlobalPaseoInstall {
  version: string;
  packagePath: string;
  globalRootPath: string | null;
  isLinked: boolean;
}

export interface NpmGlobalPaseoCli {
  inspect(options?: NpmGlobalOptions): Promise<NpmGlobalPaseoInstall>;
  installLatest(
    options?: NpmGlobalOptions,
    onOutput?: (output: string) => void,
  ): Promise<CommandResult>;
}

export interface NpmGlobalOptions {
  prefix?: string;
  signal?: AbortSignal;
  installSpec?: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

async function terminateNpmProcess(child: ChildProcess): Promise<void> {
  if (process.platform === "win32" || !child.pid) {
    await terminateWithTreeKill(child, { gracefulTimeoutMs: 3000 });
    return;
  }
  const pid = child.pid;
  const signalGroup = (signal: NodeJS.Signals): boolean => {
    try {
      process.kill(-pid, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  if (!signalGroup("SIGTERM")) return;
  // npm can exit before a lifecycle script. Keep ownership of the process group
  // through escalation even when the parent's stdio has already closed.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  signalGroup("SIGKILL");
}

async function runExternalCommand(
  command: string,
  args: string[],
  options?: CommandOptions,
): Promise<CommandResult> {
  if (options?.onOutput || options?.signal) {
    options.signal?.throwIfAborted();
    return new Promise((resolve) => {
      const child = spawnProcess(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      let stdout = "";
      let stderr = "";
      const maxBuffer = options.maxBuffer ?? NPM_MAX_BUFFER_BYTES;
      let settled = false;
      let termination: Promise<void> | null = null;

      const append = (stream: "stdout" | "stderr", chunk: Buffer): void => {
        const text = chunk.toString("utf8");
        options.onOutput?.(text);
        if (stream === "stdout") {
          stdout = `${stdout}${text}`.slice(-maxBuffer);
        } else {
          stderr = `${stderr}${text}`.slice(-maxBuffer);
        }
      };
      const abort = (): void => {
        termination ??= terminateNpmProcess(child);
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      child.once("close", () => options.signal?.removeEventListener("abort", abort));
      if (options.signal?.aborted) abort();
      child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        resolve({ exitCode: 1, stdout, stderr: stderr || getErrorMessage(error) });
      });
      child.once("close", async (code, signal) => {
        if (settled) return;
        settled = true;
        try {
          await termination;
        } catch (error) {
          stderr = getErrorMessage(error);
        }
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr: stderr || (signal ? `npm exited after signal ${signal}` : ""),
        });
      });
    });
  }

  try {
    const { stdout, stderr } = await execCommand(command, args, {
      timeout: options?.timeout,
      maxBuffer: options?.maxBuffer,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const parsed = CommandErrorSchema.safeParse(error);
    if (!parsed.success) {
      return { exitCode: 1, stdout: "", stderr: getErrorMessage(error) };
    }

    return {
      exitCode: typeof parsed.data.code === "number" ? parsed.data.code : 1,
      stdout: parsed.data.stdout ?? "",
      stderr: parsed.data.stderr || getErrorMessage(error),
    };
  }
}

function parseNpmGlobalPaseoInstall(
  stdout: string,
  packageName: string,
): NpmGlobalPaseoInstall | null {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stdout);
  } catch {
    return null;
  }

  const list = NpmGlobalListSchema.safeParse(parsedJson);
  if (!list.success) {
    return null;
  }

  const rawCliPackage = list.data.dependencies?.[packageName];
  const cliPackage = NpmGlobalCliPackageSchema.safeParse(rawCliPackage);
  if (!cliPackage.success) {
    return null;
  }

  return {
    version: cliPackage.data.version,
    packagePath: cliPackage.data.path,
    globalRootPath: list.data.path ?? null,
    // npm links an install by making its node_modules entry a symlink (a junction
    // on Windows), and `npm ls --json` reports no flag for it.
    isLinked: lstatSync(cliPackage.data.path).isSymbolicLink(),
  };
}

export class DefaultNpmGlobalPaseoCli implements NpmGlobalPaseoCli {
  constructor(
    private readonly runCommand: CommandRunner = runExternalCommand,
    private readonly distribution: PaseoDaemonDistribution = OFFICIAL_PASEO_DISTRIBUTION,
  ) {}

  async inspect(options: NpmGlobalOptions = {}): Promise<NpmGlobalPaseoInstall> {
    const prefixArgs = options.prefix ? ["--prefix", options.prefix] : [];
    const result = await this.runCommand(
      "npm",
      ["-g", "ls", this.distribution.packageName, "--json", "--depth=0", "--long", ...prefixArgs],
      {
        timeout: NPM_PROBE_TIMEOUT_MS,
        maxBuffer: NPM_MAX_BUFFER_BYTES,
      },
    );

    if (result.exitCode !== 0 && result.stdout.trim().length === 0) {
      throw new Error(result.stderr.trim() || "npm is not available on this host");
    }

    const install = parseNpmGlobalPaseoInstall(result.stdout, this.distribution.packageName);
    if (!install) {
      throw new Error(`${this.distribution.packageName} is not installed with npm -g on this host`);
    }
    return install;
  }

  async installLatest(
    options: NpmGlobalOptions = {},
    onOutput?: (output: string) => void,
  ): Promise<CommandResult> {
    if (this.distribution.kind === "source")
      throw new Error("Source checkouts do not support npm self-update.");
    // Official and fork distributions use different package names but both own the global
    // `paseo` executable. npm requires --force when switching distributions so it can replace
    // the existing command shim.
    let pendingOutput = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushOutput = (): void => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      if (!pendingOutput || !onOutput) return;
      const output = pendingOutput;
      pendingOutput = "";
      onOutput(output);
    };
    const queueOutput = (output: string): void => {
      const sanitized = stripAnsi(output);
      if (!sanitized) return;
      pendingOutput = `${pendingOutput}${sanitized}`.slice(-NPM_OUTPUT_CHUNK_LIMIT);
      flushTimer ??= setTimeout(flushOutput, NPM_OUTPUT_FLUSH_INTERVAL_MS);
    };

    return this.runCommand(
      "npm",
      [
        "install",
        "-g",
        "--force",
        "--no-audit",
        "--no-fund",
        "--prefer-offline",
        "--color=false",
        "--fetch-timeout=120000",
        "--fetch-retries=1",
        options.installSpec ?? this.distribution.installSpec,
        ...(options.prefix ? ["--prefix", options.prefix] : []),
      ],
      {
        maxBuffer: NPM_MAX_BUFFER_BYTES,
        signal: options.signal,
        ...(onOutput ? { onOutput: queueOutput } : {}),
      },
    ).finally(flushOutput);
  }
}

export const npmGlobalPaseoCli = new DefaultNpmGlobalPaseoCli(undefined, currentDaemonDistribution);
