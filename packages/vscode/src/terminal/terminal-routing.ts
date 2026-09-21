export interface ShellTerminalCreation {
  cwd?: string | { scheme: string; path: string; fsPath?: string };
  hasExplicitLaunchConfiguration: boolean;
}

export interface PaseoWorkspaceLocation {
  scheme: string;
  path: string;
  fsPath: string;
}

export function shouldRouteShellTerminalToPaseo(
  creation: ShellTerminalCreation,
  workspace: PaseoWorkspaceLocation,
): boolean {
  const cwd = creation.cwd;
  if (typeof cwd === "string") {
    return pathsEqual(cwd, workspace.path) || pathsEqual(cwd, workspace.fsPath);
  }
  if (cwd) {
    return cwd.scheme === workspace.scheme && pathsEqual(cwd.path, workspace.path);
  }

  // VS Code's plain "New Terminal" action may leave cwd and profile options implicit.
  // Explicit local profiles and extension-created terminals remain untouched.
  return !creation.hasExplicitLaunchConfiguration;
}

function pathsEqual(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function normalizePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
