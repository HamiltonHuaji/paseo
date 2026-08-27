import { describe, expect, it } from "vitest";
import {
  buildEmbeddedPageHtml,
  embeddedSessionTargetKey,
  parseEmbeddedSessionTarget,
  resolveWorkspaceRelativePath,
} from "./webview-page";

describe("buildEmbeddedPageHtml", () => {
  it("rewrites root assets and injects the focused app bootstrap", () => {
    const result = buildEmbeddedPageHtml({
      html: '<html><head><link href="/app.css"></head><body><script src="/app.js"></script></body></html>',
      config: {
        serverId: "srv_1",
        workspaceId: "ws_1",
        target: { kind: "agent", agentId: "agent_1" },
        connection: { kind: "vscode", label: "test-host" },
      },
      nonce: "nonce-value",
      cspSource: "vscode-webview-resource:",
      resourceRoot: "vscode-resource://root",
      resolveResource: (path) => `vscode-resource://${path}`,
    });

    expect(result).toContain('href="vscode-resource://app.css"');
    expect(result).toContain('src="vscode-resource://app.js"');
    expect(result).not.toContain("<base");
    expect(result).toContain('window.__PASEO_VSCODE_RESOURCE_ROOT__="vscode-resource://root"');
    expect(result).toContain("window.__PASEO_VSCODE_API__=acquireVsCodeApi()");
    expect(result).toContain('history.replaceState(null,"","/embedded-agent")');
    expect(result).toContain('"agentId":"agent_1"');
    expect(result).toContain("connect-src http: https: ws: wss:");
    expect(result.indexOf("Content-Security-Policy")).toBeLessThan(
      result.indexOf("vscode-resource://app.css"),
    );
    expect(result).toContain("base-uri 'none'");
  });

  it("escapes configuration values before embedding them in a script", () => {
    const result = buildEmbeddedPageHtml({
      html: "<html><head></head><body></body></html>",
      config: {
        serverId: "srv_</script>",
        workspaceId: "ws_1",
        target: { kind: "agent", agentId: "agent_1" },
        connection: { kind: "vscode" },
      },
      nonce: "safe",
      cspSource: "source",
      resourceRoot: "vscode-resource://root/",
      resolveResource: (path) => path,
    });

    expect(result).not.toContain("srv_</script>");
    expect(result).toContain("srv_\\u003c/script\\u003e");
  });
});

describe("embedded session targets", () => {
  it("accepts agents and provider subagents only", () => {
    expect(parseEmbeddedSessionTarget({ kind: "agent", agentId: "agent_1" })).toEqual({
      kind: "agent",
      agentId: "agent_1",
    });
    expect(
      parseEmbeddedSessionTarget({
        kind: "provider_subagent",
        parentAgentId: "parent",
        subagentId: "child",
      }),
    ).toEqual({ kind: "provider_subagent", parentAgentId: "parent", subagentId: "child" });
    expect(parseEmbeddedSessionTarget({ kind: "terminal", terminalId: "term" })).toBeNull();
    expect(embeddedSessionTargetKey({ kind: "agent", agentId: "a" })).toBe("agent:a");
  });
});

describe("resolveWorkspaceRelativePath", () => {
  it("maps absolute and relative paths without allowing workspace escape", () => {
    expect(
      resolveWorkspaceRelativePath({
        workspaceDirectory: "/data/project",
        filePath: "/data/project/src/index.ts",
      }),
    ).toBe("src/index.ts");
    expect(
      resolveWorkspaceRelativePath({
        workspaceDirectory: "C:\\work\\project",
        filePath: "c:\\work\\project\\src\\index.ts",
      }),
    ).toBe("src/index.ts");
    expect(
      resolveWorkspaceRelativePath({
        workspaceDirectory: "/data/project",
        filePath: "../outside.txt",
      }),
    ).toBeNull();
    expect(
      resolveWorkspaceRelativePath({
        workspaceDirectory: "/data/project",
        filePath: "/data/other/file.txt",
      }),
    ).toBeNull();
  });
});
