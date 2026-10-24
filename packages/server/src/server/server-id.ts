import path from "node:path";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";

interface LoggerLike {
  child(bindings: Record<string, unknown>): LoggerLike;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

const SERVER_ID_FILENAME = "server-id";

function getLogger(logger: LoggerLike | undefined): LoggerLike | undefined {
  return logger?.child({ module: "server-id" });
}

function getServerIdPath(paseoHome: string): string {
  return path.join(paseoHome, SERVER_ID_FILENAME);
}

function generateServerId(): string {
  // 9 bytes -> 12 base64url chars; keep it short + URL-safe.
  const rand = randomBytes(9).toString("base64url");
  return `srv_${rand}`;
}

/**
 * Stable daemon identifier scoped to a given $PASEO_HOME.
 *
 * - Persisted to `$PASEO_HOME/server-id`
 * - Can be overridden via `PASEO_SERVER_ID` (useful for tests)
 */
export function getOrCreateServerId(
  paseoHome: string,
  options?: { env?: NodeJS.ProcessEnv; logger?: LoggerLike },
): string {
  const env = options?.env ?? process.env;
  const log = getLogger(options?.logger);
  const serverIdPath = getServerIdPath(paseoHome);

  const envOverride =
    typeof env.PASEO_SERVER_ID === "string" && env.PASEO_SERVER_ID.trim().length > 0
      ? env.PASEO_SERVER_ID.trim()
      : null;

  let stored: string | null;
  try {
    ensurePrivateFile(serverIdPath);
    stored = readFileSync(serverIdPath, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    stored = null;
  }

  if (stored !== null) {
    if (!stored) throw new Error(`Server ID file is empty: ${serverIdPath}`);
    return envOverride ?? stored;
  }

  const created = envOverride ?? generateServerId();
  writePrivateFileAtomicSync(serverIdPath, `${created}\n`);
  log?.info({ serverId: created }, "Persisted server ID");
  return created;
}
