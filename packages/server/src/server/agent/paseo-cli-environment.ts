import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ExternalProcessEnv } from "../paseo-env.js";
import { resolvePaseoHome } from "../paseo-home.js";
import { writePrivateFileAtomicSync } from "../private-files.js";
import { resolvePaseoCliExecutablePath } from "../session/daemon/cli-path.js";

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Keep managed tool shells on this daemon's CLI after Bash login profiles rewrite PATH. */
export function withPaseoAgentCliEnvironment(env: ExternalProcessEnv): ExternalProcessEnv {
  const cli = resolvePaseoCliExecutablePath();
  if (!cli)
    throw new Error(
      "The running Paseo distribution has no built CLI. Build or reinstall it before starting an agent.",
    );
  const binDir = path.dirname(cli);
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const next = {
    ...env,
    PASEO_CLI: cli,
    [pathKey]: [
      binDir,
      ...(env[pathKey] ?? "").split(path.delimiter).filter((entry) => entry && entry !== binDir),
    ].join(path.delimiter),
  };
  if (process.platform === "win32") return next;

  // BASH_ENV runs after login startup for noninteractive Bash. Keep the caller's
  // hook, and keep this generated hook private to the daemon's own state directory.
  const originalBashEnv =
    env.BASH_ENV === env.PASEO_AGENT_BASH_ENV
      ? (env.PASEO_AGENT_ORIGINAL_BASH_ENV ?? "")
      : (env.BASH_ENV ?? "");
  const original = quoteShell(originalBashEnv);
  const sourceOriginal = originalBashEnv ? `if [ -r ${original} ]; then . ${original}; fi\n` : "";
  const hook = `${sourceOriginal}export PASEO_CLI=${quoteShell(cli)}\nexport PATH=${quoteShell(binDir)}\${PATH:+:"$PATH"}\n`;
  const fingerprint = createHash("sha256").update(hook).digest("hex").slice(0, 20);
  const hookPath = path.join(resolvePaseoHome(env), "agent-shell", fingerprint, "bash-env");
  if (!existsSync(hookPath)) {
    writePrivateFileAtomicSync(hookPath, hook);
  }
  return {
    ...next,
    BASH_ENV: hookPath,
    PASEO_AGENT_BASH_ENV: hookPath,
    PASEO_AGENT_ORIGINAL_BASH_ENV: originalBashEnv,
  };
}
