import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import * as vscode from "vscode";
import type { PaseoConnection } from "../daemon/connection";
import { getOpenPaseoWorkspaceUri, parsePaseoWorkspaceUri } from "../fs/uri";
import {
  buildSessionTree,
  type SessionTreeGroup,
  type SessionTreeLeaf,
  type SessionTreeNode,
  type SessionTreeSourceItem,
} from "./session-tree-model";

export interface PaseoTerminalInfo {
  id: string;
  name: string;
  workspaceId?: string;
  title?: string;
  activity?: unknown;
}

export type SessionValue =
  | { kind: "agent"; agent: AgentSnapshotPayload }
  | { kind: "terminal"; terminal: PaseoTerminalInfo };

export type PaseoSessionTreeNode = SessionTreeNode<SessionValue>;
export type PaseoSessionLeaf = SessionTreeLeaf<SessionValue>;

export class PaseoSessionTreeProvider
  implements vscode.TreeDataProvider<PaseoSessionTreeNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<PaseoSessionTreeNode | undefined>();
  private nodes: PaseoSessionTreeNode[] = [];
  private agents = new Map<string, AgentSnapshotPayload>();
  private terminals = new Map<string, PaseoTerminalInfo>();
  private observedClient: Awaited<ReturnType<PaseoConnection["ensureConnected"]>> | null = null;
  private clientCleanup: Array<() => void> = [];
  private refreshPromise: Promise<void> | null = null;

  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly connection: PaseoConnection) {}

  getTreeItem(element: PaseoSessionTreeNode): vscode.TreeItem {
    if (element.kind === "group") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = element.id;
      item.contextValue = "paseo.group";
      item.iconPath = new vscode.ThemeIcon("folder");
      item.tooltip = element.path;
      return item;
    }

    const item = new vscode.TreeItem(element.displayLabel, vscode.TreeItemCollapsibleState.None);
    item.id = element.id;
    if (element.value.kind === "terminal") {
      item.contextValue = "paseo.terminal";
      item.description = "terminal";
      item.iconPath = new vscode.ThemeIcon("terminal");
      item.command = {
        command: "paseo.terminal.open",
        title: "Open Terminal",
        arguments: [element],
      };
      item.tooltip = element.value.terminal.title ?? element.value.terminal.name;
      return item;
    }

    const agent = element.value.agent;
    item.contextValue = "paseo.agent";
    if (agent.status === "closed") {
      item.contextValue = agent.persistence ? "paseo.agent.closed.resumable" : "paseo.agent.closed";
    }
    item.description = `${agent.provider} · ${agent.status}`;
    item.iconPath = getAgentIcon(agent);
    item.command = {
      command: "paseo.agent.open",
      title: "Open Agent Chat",
      arguments: [element],
    };
    item.tooltip = new vscode.MarkdownString(
      `**${element.label}**\n\nProvider: ${agent.provider}\n\nStatus: ${agent.status}${agent.status === "closed" ? "\n\nThe runtime is closed, but the saved session can be resumed." : ""}`,
    );
    return item;
  }

  getChildren(element?: PaseoSessionTreeNode): PaseoSessionTreeNode[] {
    if (!element) {
      return this.nodes;
    }
    return element.kind === "group" ? element.children : [];
  }

  getParent(target: PaseoSessionTreeNode): PaseoSessionTreeNode | undefined {
    const findParent = (
      nodes: readonly PaseoSessionTreeNode[],
      parent?: SessionTreeGroup<SessionValue>,
    ): PaseoSessionTreeNode | undefined => {
      for (const node of nodes) {
        if (node.id === target.id) {
          return parent;
        }
        if (node.kind === "group") {
          const found = findParent(node.children, node);
          if (found) {
            return found;
          }
        }
      }
      return undefined;
    };
    return findParent(this.nodes);
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this.load().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  dispose(): void {
    this.detachClient();
    this.changeEmitter.dispose();
  }

  private async load(): Promise<void> {
    const workspaceUri = getOpenPaseoWorkspaceUri();
    if (!workspaceUri) {
      this.nodes = [];
      this.changeEmitter.fire(undefined);
      return;
    }
    const { serverId, workspaceId } = parsePaseoWorkspaceUri(workspaceUri);
    await this.connection.assertServer(serverId);
    const workspace = await this.connection.getWorkspace(workspaceId);
    const client = await this.connection.ensureConnected();
    this.observeClient(client);

    const nextAgents = new Map<string, AgentSnapshotPayload>();
    let cursor: string | undefined;
    let firstPage = true;
    do {
      const payload = await client.fetchAgents({
        scope: "active",
        filter: { includeArchived: false },
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
        ...(firstPage ? { subscribe: { subscriptionId: "vscode-agents" } } : {}),
      });
      for (const entry of payload.entries) {
        if (belongsToWorkspace(entry.agent, workspaceId, workspace.workspaceDirectory)) {
          nextAgents.set(entry.agent.id, entry.agent);
        }
      }
      cursor = payload.pageInfo.nextCursor ?? undefined;
      firstPage = false;
    } while (cursor);

    const terminalPayload = await client.listTerminals(workspace.workspaceDirectory, undefined, {
      workspaceId,
    });
    client.subscribeTerminals({ cwd: workspace.workspaceDirectory, workspaceId });
    this.agents = nextAgents;
    this.terminals = new Map(terminalPayload.terminals.map((terminal) => [terminal.id, terminal]));
    this.rebuild();
  }

  private observeClient(client: Awaited<ReturnType<PaseoConnection["ensureConnected"]>>): void {
    if (this.observedClient === client) {
      return;
    }
    this.detachClient();
    this.observedClient = client;
    this.clientCleanup = [
      client.on("agent_update", (message) => {
        const workspaceUri = getOpenPaseoWorkspaceUri();
        if (!workspaceUri) {
          return;
        }
        const { workspaceId } = parsePaseoWorkspaceUri(workspaceUri);
        if (message.payload.kind === "remove") {
          this.agents.delete(message.payload.agentId);
        } else {
          const agent = message.payload.agent;
          const workspace = this.connection.getWorkspace(workspaceId);
          void workspace
            .then((descriptor) => {
              if (belongsToWorkspace(agent, workspaceId, descriptor.workspaceDirectory)) {
                this.agents.set(agent.id, agent);
              } else {
                this.agents.delete(agent.id);
              }
              this.rebuild();
              return undefined;
            })
            .catch(() => {});
          return;
        }
        this.rebuild();
      }),
      client.on("terminals_changed", (message) => {
        const workspaceUri = getOpenPaseoWorkspaceUri();
        if (!workspaceUri) {
          return;
        }
        const { workspaceId } = parsePaseoWorkspaceUri(workspaceUri);
        void this.connection
          .getWorkspace(workspaceId)
          .then((workspace) => {
            if (message.payload.cwd !== workspace.workspaceDirectory) {
              return;
            }
            this.terminals = new Map(
              message.payload.terminals.map((terminal) => [terminal.id, terminal]),
            );
            this.rebuild();
            return undefined;
          })
          .catch(() => {});
      }),
    ];
  }

  private rebuild(): void {
    const items: SessionTreeSourceItem<SessionValue>[] = [
      ...[...this.agents.values()].map((agent) => {
        const title = agent.title?.trim() || null;
        const label = title || `${agent.provider} ${agent.id.slice(0, 8)}`;
        return {
          id: `agent:${agent.id}`,
          label,
          pathLabel: title,
          value: { kind: "agent" as const, agent },
        };
      }),
      ...[...this.terminals.values()].map((terminal) => {
        const label = terminal.title?.trim() || terminal.name;
        return {
          id: `terminal:${terminal.id}`,
          label,
          pathLabel: label,
          value: { kind: "terminal" as const, terminal },
        };
      }),
    ];
    this.nodes = buildSessionTree(items);
    this.changeEmitter.fire(undefined);
  }

  private detachClient(): void {
    for (const cleanup of this.clientCleanup.splice(0)) {
      cleanup();
    }
    this.observedClient = null;
  }
}

function belongsToWorkspace(
  agent: AgentSnapshotPayload,
  workspaceId: string,
  workspaceDirectory: string,
): boolean {
  return (
    agent.archivedAt == null &&
    (agent.workspaceId ? agent.workspaceId === workspaceId : agent.cwd === workspaceDirectory)
  );
}

function getAgentIcon(agent: AgentSnapshotPayload): vscode.ThemeIcon {
  if (agent.requiresAttention || agent.status === "error") {
    return new vscode.ThemeIcon("warning", new vscode.ThemeColor("list.warningForeground"));
  }
  if (agent.status === "running" || agent.status === "initializing") {
    return new vscode.ThemeIcon("sync~spin");
  }
  if (agent.status === "closed") {
    return new vscode.ThemeIcon("circle-slash");
  }
  return new vscode.ThemeIcon("hubot");
}
