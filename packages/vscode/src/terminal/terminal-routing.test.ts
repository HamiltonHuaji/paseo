import { describe, expect, it } from "vitest";
import { shouldRouteShellTerminalToPaseo } from "./terminal-routing";

const workspace = {
  scheme: "paseo-fs",
  path: "/mnt/home/project",
  fsPath: "/mnt/home/project",
};

describe("shouldRouteShellTerminalToPaseo", () => {
  it("routes the implicit new-terminal action and the Paseo workspace cwd", () => {
    expect(
      shouldRouteShellTerminalToPaseo({ hasExplicitLaunchConfiguration: false }, workspace),
    ).toBe(true);
    expect(
      shouldRouteShellTerminalToPaseo(
        { cwd: "/mnt/home/project/", hasExplicitLaunchConfiguration: true },
        workspace,
      ),
    ).toBe(true);
    expect(
      shouldRouteShellTerminalToPaseo(
        {
          cwd: { scheme: "paseo-fs", path: "/mnt/home/project" },
          hasExplicitLaunchConfiguration: true,
        },
        workspace,
      ),
    ).toBe(true);
  });

  it("preserves explicitly configured local terminals", () => {
    expect(
      shouldRouteShellTerminalToPaseo(
        { cwd: "/tmp", hasExplicitLaunchConfiguration: true },
        workspace,
      ),
    ).toBe(false);
    expect(
      shouldRouteShellTerminalToPaseo({ hasExplicitLaunchConfiguration: true }, workspace),
    ).toBe(false);
  });
});
