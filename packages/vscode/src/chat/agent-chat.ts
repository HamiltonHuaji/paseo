import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as vscode from "vscode";
import type { PaseoConnection } from "../daemon/connection";
import { getOpenPaseoWorkspaceUri, parsePaseoWorkspaceUri } from "../fs/uri";
import type { PaseoSessionLeaf } from "../tree/session-tree";
import {
  buildEmbeddedPageHtml,
  type EmbeddedConnectionConfig,
  type EmbeddedSessionTarget,
  embeddedSessionTargetKey,
  parseEmbeddedSessionTarget,
  resolveWorkspaceRelativePath,
} from "./webview-page";
import { WorkspaceTransportBroker } from "./transport-broker";

interface ChatEditor {
  panel: vscode.WebviewPanel;
  serverId: string;
  workspaceId: string;
  target: EmbeddedSessionTarget;
  title: string;
}

interface WorkspaceFileOpenRequest {
  location: {
    path: string;
    lineStart?: number;
    lineEnd?: number;
  };
  disposition: "main" | "side";
}

// VS Code's Webview.postMessage is not the browser Window.postMessage API.
/* oxlint-disable unicorn/require-post-message-target-origin */

export class PaseoAgentChatManager implements vscode.Disposable {
  private readonly editors = new Map<string, ChatEditor>();
  private readonly transportBroker: WorkspaceTransportBroker;

  constructor(
    private readonly connection: PaseoConnection,
    private readonly extensionUri: vscode.Uri,
    private readonly output: vscode.OutputChannel,
  ) {
    this.transportBroker = new WorkspaceTransportBroker(connection, (message) =>
      output.appendLine(message),
    );
  }

  async open(leaf: PaseoSessionLeaf): Promise<void> {
    if (leaf.value.kind !== "agent") {
      throw new Error("The selected session is not an agent.");
    }
    const workspaceUri = requireOpenWorkspaceUri();
    const { serverId, workspaceId } = parsePaseoWorkspaceUri(workspaceUri);
    await this.openTarget({
      serverId,
      workspaceId,
      target: { kind: "agent", agentId: leaf.value.agent.id },
      title: leaf.label,
    });
  }

  dispose(): void {
    this.transportBroker.dispose();
    for (const editor of this.editors.values()) {
      editor.panel.dispose();
    }
    this.editors.clear();
  }

  private async openTarget(input: {
    serverId: string;
    workspaceId: string;
    target: EmbeddedSessionTarget;
    title?: string;
  }): Promise<void> {
    this.assertCurrentWorkspace(input.serverId, input.workspaceId);
    const key = editorKey(input.serverId, input.workspaceId, input.target);
    const existing = this.editors.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active, false);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "paseo.agentChat",
      input.title ?? targetTitle(input.target),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "webview-app")],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "paseo.svg");
    const editor: ChatEditor = {
      panel,
      serverId: input.serverId,
      workspaceId: input.workspaceId,
      target: input.target,
      title: input.title ?? targetTitle(input.target),
    };
    this.editors.set(key, editor);
    panel.onDidDispose(() => {
      this.transportBroker.detachSink(panel.webview);
      if (
        this.editors.get(editorKey(editor.serverId, editor.workspaceId, editor.target)) === editor
      ) {
        this.editors.delete(editorKey(editor.serverId, editor.workspaceId, editor.target));
      }
    });
    panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(editor, message).catch((error) => {
        this.logError(error);
        void vscode.window.showErrorMessage(`Paseo: ${getErrorMessage(error)}`);
      });
    });

    try {
      await this.loadEditor(editor);
    } catch (error) {
      panel.dispose();
      throw error;
    }
  }

  private async loadEditor(editor: ChatEditor): Promise<void> {
    this.transportBroker.detachSink(editor.panel.webview);
    const webRoot = vscode.Uri.joinPath(this.extensionUri, "webview-app");
    let sourceHtml: string;
    try {
      sourceHtml = await readFile(vscode.Uri.joinPath(webRoot, "index.html").fsPath, "utf8");
    } catch (error) {
      throw new Error(
        "The bundled Paseo conversation app is missing. Rebuild the extension with npm run package:vscode.",
        { cause: error },
      );
    }
    const connection = await this.connection.getWebEmbedConnection(editor.serverId);
    const config: EmbeddedConnectionConfig = {
      serverId: editor.serverId,
      workspaceId: editor.workspaceId,
      target: editor.target,
      connection,
    };
    editor.panel.webview.html = buildEmbeddedPageHtml({
      html: sourceHtml,
      config,
      nonce: randomBytes(16).toString("base64url"),
      cspSource: editor.panel.webview.cspSource,
      resourceRoot: editor.panel.webview.asWebviewUri(webRoot).toString(),
      resolveResource: (path) =>
        editor.panel.webview
          .asWebviewUri(vscode.Uri.joinPath(webRoot, ...path.split("/")))
          .toString(),
    });
  }

  private async handleMessage(editor: ChatEditor, value: unknown): Promise<void> {
    if (await this.transportBroker.handleMessage(editor.panel.webview, value)) {
      return;
    }
    if (!isRecord(value) || typeof value.type !== "string") {
      return;
    }
    switch (value.type) {
      case "closeEditor":
        editor.panel.dispose();
        return;
      case "openTarget": {
        const target = parseEmbeddedSessionTarget(value.target);
        if (target) {
          await this.openTarget({
            serverId: parseOptionalIdentity(value.serverId, editor.serverId),
            workspaceId: parseOptionalIdentity(value.workspaceId, editor.workspaceId),
            target,
          });
        }
        return;
      }
      case "retargetEditor": {
        const target = parseEmbeddedSessionTarget(value.target);
        if (target) {
          await this.retargetEditor(editor, target);
        }
        return;
      }
      case "openFile": {
        const request = parseFileOpenRequest(value.request);
        if (request) {
          await this.openFile(editor, request);
        }
        return;
      }
      case "openImport":
        await vscode.window.showInformationMessage(
          "Importing sessions is available in the full Paseo client.",
        );
        return;
      case "bootstrapError":
        if (typeof value.message === "string" && value.message.trim()) {
          this.logError(new Error(`Embedded app bootstrap failed: ${value.message}`));
          await vscode.window
            .showErrorMessage(`Paseo conversation failed to load: ${value.message}`, "Show Log")
            .then((choice) => {
              if (choice === "Show Log") {
                this.output.show(true);
              }
              return undefined;
            });
        }
    }
  }

  private async retargetEditor(editor: ChatEditor, target: EmbeddedSessionTarget): Promise<void> {
    const oldKey = editorKey(editor.serverId, editor.workspaceId, editor.target);
    const nextKey = editorKey(editor.serverId, editor.workspaceId, target);
    const existing = this.editors.get(nextKey);
    if (existing && existing !== editor) {
      existing.panel.reveal(vscode.ViewColumn.Active, false);
      editor.panel.dispose();
      return;
    }
    this.editors.delete(oldKey);
    editor.target = target;
    editor.title = targetTitle(target);
    editor.panel.title = editor.title;
    this.editors.set(nextKey, editor);
    await this.loadEditor(editor);
  }

  private async openFile(editor: ChatEditor, request: WorkspaceFileOpenRequest): Promise<void> {
    const workspaceUri = requireOpenWorkspaceUri();
    this.assertCurrentWorkspace(editor.serverId, editor.workspaceId);
    const workspace = await this.connection.getWorkspace(editor.workspaceId);
    const relativePath = resolveWorkspaceRelativePath({
      workspaceDirectory: workspace.workspaceDirectory,
      filePath: request.location.path,
    });
    if (!relativePath) {
      throw new Error(
        `The linked file is outside the open Paseo workspace: ${request.location.path}`,
      );
    }
    const uri = vscode.Uri.joinPath(workspaceUri, ...relativePath.split("/"));
    const lineStart = normalizeLine(request.location.lineStart);
    const lineEnd = normalizeLine(request.location.lineEnd) ?? lineStart;
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, {
        viewColumn:
          request.disposition === "side" ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
        selection:
          lineStart === null
            ? undefined
            : new vscode.Range(lineStart - 1, 0, Math.max(lineStart, lineEnd ?? lineStart) - 1, 0),
      });
    } catch {
      await vscode.commands.executeCommand(
        "vscode.open",
        uri,
        request.disposition === "side" ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      );
    }
  }

  private assertCurrentWorkspace(serverId: string, workspaceId: string): void {
    const current = parsePaseoWorkspaceUri(requireOpenWorkspaceUri());
    if (current.serverId !== serverId || current.workspaceId !== workspaceId) {
      throw new Error("The embedded Paseo session belongs to a different host or workspace.");
    }
  }

  private logError(error: unknown): void {
    this.output.appendLine(
      `[embedded-agent] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  }
}

function requireOpenWorkspaceUri(): vscode.Uri {
  const uri = getOpenPaseoWorkspaceUri();
  if (!uri) {
    throw new Error("Open a Paseo workspace first.");
  }
  return uri;
}

function editorKey(serverId: string, workspaceId: string, target: EmbeddedSessionTarget): string {
  return `${serverId}:${workspaceId}:${embeddedSessionTargetKey(target)}`;
}

function targetTitle(target: EmbeddedSessionTarget): string {
  return target.kind === "agent"
    ? `Paseo: ${target.agentId.slice(0, 12)}`
    : `Paseo subagent: ${target.subagentId.slice(0, 12)}`;
}

function parseOptionalIdentity(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function parseFileOpenRequest(value: unknown): WorkspaceFileOpenRequest | null {
  if (!isRecord(value) || !isRecord(value.location) || typeof value.location.path !== "string") {
    return null;
  }
  return {
    location: {
      path: value.location.path,
      ...(typeof value.location.lineStart === "number"
        ? { lineStart: value.location.lineStart }
        : {}),
      ...(typeof value.location.lineEnd === "number" ? { lineEnd: value.location.lineEnd } : {}),
    },
    disposition: value.disposition === "side" ? "side" : "main",
  };
}

function normalizeLine(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
