import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import stripAnsi from "strip-ansi";
import { z } from "zod";
import { execCommand, spawnProcess } from "../../../utils/spawn.js";
import { currentDaemonDistribution, type PaseoDaemonDistribution } from "./distribution.js";

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
    link: z.boolean().optional(),
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
  inspect(): Promise<NpmGlobalPaseoInstall>;
  installLatest(onOutput?: (output: string) => void): Promise<CommandResult>;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

async function runExternalCommand(
  command: string,
  args: string[],
  options?: CommandOptions,
): Promise<CommandResult> {
  if (options?.onOutput) {
    return new Promise((resolve) => {
      const child = spawnProcess(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const maxBuffer = options.maxBuffer ?? NPM_MAX_BUFFER_BYTES;
      let settled = false;

      const append = (stream: "stdout" | "stderr", chunk: Buffer): void => {
        const text = chunk.toString("utf8");
        options.onOutput?.(text);
        if (stream === "stdout") {
          stdout = `${stdout}${text}`.slice(-maxBuffer);
        } else {
          stderr = `${stderr}${text}`.slice(-maxBuffer);
        }
      };
      child.stdout?.on("data", (chunk: Buffer) => append("stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => append("stderr", chunk));
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        resolve({ exitCode: 1, stdout, stderr: stderr || getErrorMessage(error) });
      });
      child.once("close", (code, signal) => {
        if (settled) return;
        settled = true;
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
    isLinked: cliPackage.data.link === true,
  };
}

export class DefaultNpmGlobalPaseoCli implements NpmGlobalPaseoCli {
  constructor(
    private readonly runCommand: CommandRunner = runExternalCommand,
    private readonly distribution: PaseoDaemonDistribution = currentDaemonDistribution,
  ) {}

  async inspect(): Promise<NpmGlobalPaseoInstall> {
    const result = await this.runCommand(
      "npm",
      ["-g", "ls", this.distribution.packageName, "--json", "--depth=0", "--long"],
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

  async installLatest(onOutput?: (output: string) => void): Promise<CommandResult> {
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
        this.distribution.installSpec,
      ],
      {
        maxBuffer: NPM_MAX_BUFFER_BYTES,
        ...(onOutput ? { onOutput: queueOutput } : {}),
      },
    ).finally(flushOutput);
  }
}

export const npmGlobalPaseoCli = new DefaultNpmGlobalPaseoCli();
