export interface EmbeddedAgentTarget {
  kind: "agent";
  agentId: string;
}

export interface EmbeddedProviderSubagentTarget {
  kind: "provider_subagent";
  parentAgentId: string;
  subagentId: string;
}

export type EmbeddedSessionTarget = EmbeddedAgentTarget | EmbeddedProviderSubagentTarget;

export interface EmbeddedConnectionConfig {
  serverId: string;
  workspaceId: string;
  target: EmbeddedSessionTarget;
  connection:
    | {
        kind: "vscode";
        label?: string;
      }
    | {
        kind: "relay";
        relayEndpoint: string;
        useTls: boolean;
        daemonPublicKeyB64: string;
        label?: string;
      }
    | {
        kind: "direct";
        endpoint: string;
        useTls: boolean;
        password?: string;
        label?: string;
      };
}

interface BuildEmbeddedPageInput {
  html: string;
  config: EmbeddedConnectionConfig;
  nonce: string;
  cspSource: string;
  resourceRoot: string;
  resolveResource: (path: string) => string;
}

export function buildEmbeddedPageHtml(input: BuildEmbeddedPageInput): string {
  const htmlWithResources = input.html.replace(
    /\b(href|src)=(['"])\/(?!\/)([^'"]*)\2/g,
    (_match, attribute: string, quote: string, resourcePath: string) =>
      `${attribute}=${quote}${input.resolveResource(resourcePath)}${quote}`,
  );
  const csp = [
    "default-src 'none'",
    `script-src ${input.cspSource} 'nonce-${input.nonce}'`,
    `style-src ${input.cspSource} 'unsafe-inline'`,
    `font-src ${input.cspSource} data:`,
    `img-src ${input.cspSource} data: blob: http: https:`,
    `media-src ${input.cspSource} data: blob: http: https:`,
    "connect-src http: https: ws: wss:",
    "worker-src blob:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  const resourceRoot = input.resourceRoot.endsWith("/")
    ? input.resourceRoot.slice(0, -1)
    : input.resourceRoot;
  const bootstrap = [
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(csp)}" />`,
    `<script nonce="${escapeHtmlAttribute(input.nonce)}">`,
    `window.__PASEO_VSCODE_EMBED__=${serializeInlineJson(input.config)};`,
    `window.__PASEO_VSCODE_RESOURCE_ROOT__=${serializeInlineJson(resourceRoot)};`,
    "window.__PASEO_VSCODE_API__=acquireVsCodeApi();",
    "window.addEventListener('error',function(event){var target=event.target;var source=event.filename||(target&&target.src)||'';var location=source?(source+(event.lineno?':'+event.lineno+(event.colno?':'+event.colno:''):'')):'';var detail=event.error&&event.error.stack?event.error.stack:(event.message||'Failed to load the embedded Paseo app.');window.__PASEO_VSCODE_API__.postMessage({type:'bootstrapError',message:location?(detail+'\\n'+location):detail});},true);",
    "window.addEventListener('unhandledrejection',function(event){var reason=event.reason;window.__PASEO_VSCODE_API__.postMessage({type:'bootstrapError',message:reason&&reason.message?reason.message:String(reason||'The embedded Paseo app failed to start.')});});",
    'history.replaceState(null,"","/embedded-agent");',
    "</script>",
  ].join("");
  if (!/<head(?:\s[^>]*)?>/i.test(htmlWithResources)) {
    throw new Error("The bundled Paseo web app has no head element.");
  }
  return htmlWithResources.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${bootstrap}`);
}

export function parseEmbeddedSessionTarget(value: unknown): EmbeddedSessionTarget | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.kind === "agent" && isNonEmptyString(value.agentId)) {
    return { kind: "agent", agentId: value.agentId };
  }
  if (
    value.kind === "provider_subagent" &&
    isNonEmptyString(value.parentAgentId) &&
    isNonEmptyString(value.subagentId)
  ) {
    return {
      kind: "provider_subagent",
      parentAgentId: value.parentAgentId,
      subagentId: value.subagentId,
    };
  }
  return null;
}

export function embeddedSessionTargetKey(target: EmbeddedSessionTarget): string {
  return target.kind === "agent"
    ? `agent:${target.agentId}`
    : `provider_subagent:${target.parentAgentId}:${target.subagentId}`;
}

export function resolveWorkspaceRelativePath(input: {
  workspaceDirectory: string;
  filePath: string;
}): string | null {
  const workspaceDirectory = normalizePath(input.workspaceDirectory);
  const filePath = normalizePath(input.filePath);
  if (!workspaceDirectory || !filePath) {
    return null;
  }

  if (isAbsolutePath(filePath)) {
    const root = trimTrailingSlash(workspaceDirectory);
    const prefix = root.endsWith("/") ? root : `${root}/`;
    if (pathsEqual(filePath, root)) {
      return null;
    }
    if (!pathStartsWith(filePath, prefix)) {
      return null;
    }
    return normalizeRelativePath(filePath.slice(prefix.length));
  }
  return normalizeRelativePath(filePath);
}

function serializeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizePath(value: string): string {
  return trimTrailingSlash(
    value
      .trim()
      .replaceAll("\\", "/")
      .replace(/\/{2,}/g, "/"),
  );
}

function trimTrailingSlash(value: string): string {
  if (value === "/" || /^[A-Za-z]:\/$/.test(value)) {
    return value;
  }
  return value.replace(/\/+$/, "");
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value);
}

function pathsEqual(left: string, right: string): boolean {
  return isWindowsPath(left) || isWindowsPath(right)
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function pathStartsWith(value: string, prefix: string): boolean {
  return isWindowsPath(value) || isWindowsPath(prefix)
    ? value.toLowerCase().startsWith(prefix.toLowerCase())
    : value.startsWith(prefix);
}

function normalizeRelativePath(value: string): string | null {
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/") || null;
}
