import { randomUUID } from "node:crypto";
import {
  type ConnectionState,
  DaemonClient,
  type DaemonTransportFrame,
  type Logger,
} from "@getpaseo/client/internal/daemon-client";
import type { WebSocketLike } from "@getpaseo/client/internal/daemon-client-transport-types";
import { buildRelayWebSocketUrl } from "@getpaseo/protocol/daemon-endpoints";
import type {
  ServerInfoStatusPayload,
  WorkspaceDescriptorPayload,
} from "@getpaseo/protocol/messages";
import * as vscode from "vscode";
import { WebSocket as NodeWebSocket } from "ws";
import { clearPassword, getPassword, promptForDaemonPassword } from "../auth/secret-store";
import { readDaemonListen } from "./config-reader";
import {
  discoverDaemonEndpoint,
  type ResolvedDaemonEndpoint,
  validateDaemonPassword,
} from "./discovery";
import {
  getSavedRelayConnections,
  parseRelayPairingLink,
  saveRelayConnection,
  type SavedRelayConnection,
  updateRelayConnectionLabel,
} from "./relay-connections";

type ConnectionTarget =
  | { kind: "direct"; endpoint: ResolvedDaemonEndpoint }
  | { kind: "relay"; connection: SavedRelayConnection };

export type HostConnectionChoice = { kind: "direct" } | { kind: "relay"; serverId: string };

interface PaseoConnectionOptions {
  clientId?: string;
  pinnedServerId?: string | null;
}

export type WebEmbedConnection =
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

export class PaseoConnection implements vscode.Disposable {
  private client: DaemonClient | null = null;
  private target: ConnectionTarget | null = null;
  private connectPromise: Promise<DaemonClient> | null = null;
  private state: ConnectionState = { status: "idle" };
  private connectedHostLabel: string | null = null;
  private readonly clientId: string;
  private readonly workspaces = new Map<string, WorkspaceDescriptorPayload>();
  private readonly cleanup: Array<() => void> = [];
  private readonly statusChangedEmitter = new vscode.EventEmitter<ConnectionState>();
  private readonly workspaceChangedEmitter = new vscode.EventEmitter<void>();
  private readonly transportFrameEmitter = new vscode.EventEmitter<DaemonTransportFrame>();

  readonly onDidChangeStatus = this.statusChangedEmitter.event;
  readonly onDidChangeWorkspaces = this.workspaceChangedEmitter.event;
  readonly onDidReceiveTransportFrame = this.transportFrameEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly statusBar: vscode.StatusBarItem | null,
    private preferredServerId: string | null,
    private readonly options: PaseoConnectionOptions = {},
  ) {
    this.clientId = options.clientId ?? `vscode-${randomUUID()}`;
    this.renderStatus({ status: "idle" });
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  get currentEndpoint(): string | null {
    if (this.target?.kind === "relay") {
      return this.target.connection.relayEndpoint;
    }
    return this.target?.endpoint.endpoint ?? null;
  }

  get savedRelayConnections(): SavedRelayConnection[] {
    return getSavedRelayConnections(this.context);
  }

  async ensureConnected(options?: { promptForPassword?: boolean }): Promise<DaemonClient> {
    if (this.client && this.state.status === "connected") {
      return this.client;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }
    const existingClient = this.client;
    const pending = existingClient
      ? existingClient.connect().then(() => existingClient)
      : this.connect(options?.promptForPassword ?? true);
    const attempt = pending.finally(() => {
      if (this.connectPromise === attempt) {
        this.connectPromise = null;
      }
    });
    this.connectPromise = attempt;
    return attempt;
  }

  async reconnect(): Promise<void> {
    this.connectPromise = null;
    this.disposeClient();
    await this.ensureConnected({ promptForPassword: true });
    await this.listWorkspaces({ force: true });
  }

  selectDirectConnection(): void {
    this.assertConnectionCanChangeHosts();
    this.preferredServerId = null;
    this.target = null;
    this.connectPromise = null;
    this.disposeClient();
  }

  selectRelayConnection(serverId: string): void {
    this.assertConnectionCanChangeHosts();
    const connection = this.savedRelayConnections.find(
      (candidate) => candidate.serverId === serverId,
    );
    if (!connection) {
      throw new Error(`No relay pairing link is saved for Paseo host ${serverId}.`);
    }
    this.preferredServerId = serverId;
    this.target = { kind: "relay", connection };
    this.connectPromise = null;
    this.disposeClient();
  }

  selectHostConnection(choice: HostConnectionChoice): void {
    if (choice.kind === "direct") {
      this.selectDirectConnection();
      return;
    }
    this.selectRelayConnection(choice.serverId);
  }

  createDetached(choice: HostConnectionChoice): PaseoConnection {
    return new PaseoConnection(
      this.context,
      this.output,
      null,
      choice.kind === "relay" ? choice.serverId : null,
      { clientId: `vscode-workspace-picker-${randomUUID()}` },
    );
  }

  async refreshDirectConnectionConfiguration(): Promise<void> {
    if (this.target?.kind === "relay") {
      return;
    }
    this.target = null;
    await this.reconnect();
  }

  async addRelayPairingLink(pairingLink: string, label?: string): Promise<SavedRelayConnection> {
    const connection = parseRelayPairingLink(pairingLink, label);
    await saveRelayConnection(this.context, connection);
    return connection;
  }

  async listWorkspaces(options?: { force?: boolean }): Promise<WorkspaceDescriptorPayload[]> {
    if (!options?.force && this.workspaces.size > 0) {
      return [...this.workspaces.values()];
    }

    const client = await this.ensureConnected();
    const next = new Map<string, WorkspaceDescriptorPayload>();
    let cursor: string | undefined;
    let firstPage = true;
    do {
      const payload = await client.fetchWorkspaces({
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
        ...(firstPage ? { subscribe: { subscriptionId: "vscode-workspaces" } } : {}),
      });
      for (const workspace of payload.entries) {
        next.set(workspace.id, workspace);
      }
      cursor = payload.pageInfo.nextCursor ?? undefined;
      firstPage = false;
    } while (cursor);

    this.workspaces.clear();
    for (const [id, workspace] of next) {
      this.workspaces.set(id, workspace);
    }
    this.workspaceChangedEmitter.fire();
    return [...this.workspaces.values()];
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceDescriptorPayload> {
    const cached = this.workspaces.get(workspaceId);
    if (cached) {
      return cached;
    }
    await this.listWorkspaces({ force: true });
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Paseo workspace not found: ${workspaceId}`);
    }
    return workspace;
  }

  async getSharedTransportServerInfo(): Promise<ServerInfoStatusPayload> {
    const client = await this.ensureConnected();
    const serverInfo = client.getLastServerInfoMessage();
    if (!serverInfo) {
      throw new Error("The connected Paseo daemon did not identify itself.");
    }
    return serverInfo;
  }

  async sendSharedTransportFrame(frame: DaemonTransportFrame): Promise<void> {
    const client = await this.ensureConnected();
    client.sendRawTransportMessage(frame);
  }

  async assertServer(serverId: string): Promise<void> {
    const client = await this.ensureConnected();
    const actualServerId = client.getLastServerInfoMessage()?.serverId;
    if (!actualServerId) {
      throw new Error("The connected Paseo daemon did not identify itself.");
    }
    if (actualServerId !== serverId) {
      throw new Error(
        `This VS Code window belongs to Paseo host ${serverId}, but the configured daemon is ${actualServerId}.`,
      );
    }
  }

  async getWebEmbedConnection(serverId: string): Promise<WebEmbedConnection> {
    await this.assertServer(serverId);
    return {
      kind: "vscode",
      label: this.connectedHostLabel ?? undefined,
    };
  }

  async promptAndStorePassword(): Promise<void> {
    const target = await this.resolveTarget();
    if (target.kind !== "direct") {
      throw new Error("Relay connections use the pairing key and do not use a daemon password.");
    }
    const endpoint = target.endpoint;
    await promptForDaemonPassword({ context: this.context, endpoint: endpoint.endpoint });
    await this.reconnect();
  }

  async clearStoredPassword(): Promise<void> {
    const target = await this.resolveTarget();
    if (target.kind !== "direct") {
      throw new Error("Relay connections do not have a stored daemon password.");
    }
    const endpoint = target.endpoint;
    await clearPassword(this.context, endpoint.endpoint);
    this.disposeClient();
  }

  dispose(): void {
    this.disposeClient();
    this.statusChangedEmitter.dispose();
    this.workspaceChangedEmitter.dispose();
    this.transportFrameEmitter.dispose();
  }

  private async connect(promptForPassword: boolean): Promise<DaemonClient> {
    const target = await this.resolveTarget();
    const password =
      target.kind === "direct"
        ? await this.resolveDirectPassword(target.endpoint, promptForPassword)
        : null;

    const logger = this.createLogger();
    const client = new DaemonClient({
      url:
        target.kind === "relay"
          ? buildRelayWebSocketUrl({
              endpoint: target.connection.relayEndpoint,
              useTls: target.connection.useTls,
              serverId: target.connection.serverId,
              role: "client",
            })
          : `ws://${target.endpoint.endpoint}/ws`,
      clientId: this.clientId,
      // COMPAT(vscodeClientType): official daemons only accept the existing wire enum.
      // Use `cli` until a future protocol adds a backward-compatible client descriptor.
      clientType: "cli",
      appVersion: this.context.extension.packageJSON.version,
      // Virtual Webview clients maintain independent viewed-agent sets, but this
      // physical socket is their single server-side subscription source. Keep
      // legacy timeline delivery here; the broker broadcasts and each Webview
      // applies its own view state without one panel replacing another's set.
      ...(password ? { password } : {}),
      ...(target.kind === "relay"
        ? {
            e2ee: {
              enabled: true,
              daemonPublicKeyB64: target.connection.daemonPublicKeyB64,
            },
          }
        : {}),
      reconnect: { enabled: true },
      suppressSendErrors: true,
      logger,
      webSocketFactory: (url, options) =>
        new NodeWebSocket(url, options?.protocols ?? [], {
          headers: options?.headers,
        }) as unknown as WebSocketLike,
    });
    this.client = client;
    this.cleanup.push(
      client.subscribeConnectionStatus((state) => {
        this.state = state;
        this.renderStatus(state);
        this.statusChangedEmitter.fire(state);
      }),
      client.on("workspace_update", (message) => {
        if (message.payload.kind === "upsert") {
          this.workspaces.set(message.payload.workspace.id, message.payload.workspace);
        } else {
          this.workspaces.delete(message.payload.id);
        }
        this.workspaceChangedEmitter.fire();
      }),
      client.onRawTransportMessage((frame) => this.transportFrameEmitter.fire(frame)),
    );

    try {
      await client.connect();
      const serverInfo = client.getLastServerInfoMessage();
      if (this.options.pinnedServerId && serverInfo?.serverId !== this.options.pinnedServerId) {
        throw new Error(
          `This VS Code window belongs to Paseo host ${this.options.pinnedServerId}, but the configured daemon is ${serverInfo?.serverId ?? "unknown"}.`,
        );
      }
      if (target.kind === "relay" && serverInfo?.serverId !== target.connection.serverId) {
        throw new Error(
          `Relay connected to unexpected Paseo host ${serverInfo?.serverId ?? "unknown"}.`,
        );
      }
      if (target.kind === "relay" && serverInfo?.hostname) {
        await updateRelayConnectionLabel(
          this.context,
          target.connection.serverId,
          serverInfo.hostname,
        );
      }
      this.connectedHostLabel = getConnectedHostLabel(target, serverInfo?.hostname);
      this.renderStatus(this.state);
    } catch (error) {
      this.disposeClient();
      throw error;
    }
    this.output.appendLine(`Connected to Paseo daemon through ${describeTarget(target)}.`);
    return client;
  }

  private async resolveDirectPassword(
    endpoint: ResolvedDaemonEndpoint,
    promptForPassword: boolean,
  ): Promise<string | null> {
    if (!endpoint.available) {
      throw new Error(
        endpoint.unsupportedMessage ?? `Paseo daemon is not reachable at ${endpoint.endpoint}.`,
      );
    }
    const password = await getPassword(this.context, endpoint.endpoint);
    if (!endpoint.requiresPassword) {
      return password;
    }
    if (
      password !== null &&
      (await validateDaemonPassword({ endpoint: endpoint.endpoint, password }))
    ) {
      return password;
    }
    if (!promptForPassword) {
      throw new Error(`Paseo daemon at ${endpoint.endpoint} requires a password.`);
    }
    return promptForDaemonPassword({ context: this.context, endpoint: endpoint.endpoint });
  }

  private async resolveTarget(): Promise<ConnectionTarget> {
    if (this.target) {
      return this.target;
    }
    if (this.preferredServerId) {
      const relayConnection = this.savedRelayConnections.find(
        (connection) => connection.serverId === this.preferredServerId,
      );
      if (relayConnection) {
        this.target = { kind: "relay", connection: relayConnection };
        return this.target;
      }
    }

    const endpoint = await discoverDaemonEndpoint({
      settingEndpoint: vscode.workspace.getConfiguration("paseo").get<string>("endpoint"),
      envEndpoint: process.env.PASEO_VSCODE_ENDPOINT,
      configListen: await readDaemonListen(),
    });
    this.target = { kind: "direct", endpoint };
    return this.target;
  }

  private createLogger(): Logger {
    const write = (level: string, obj: object, message?: string) => {
      const details = Object.keys(obj).length > 0 ? ` ${JSON.stringify(obj)}` : "";
      this.output.appendLine(`[${level}] ${message ?? "Paseo client"}${details}`);
    };
    return {
      debug: (obj, message) => write("debug", obj, message),
      info: (obj, message) => write("info", obj, message),
      warn: (obj, message) => write("warn", obj, message),
      error: (obj, message) => write("error", obj, message),
    };
  }

  private renderStatus(state: ConnectionState): void {
    if (!this.statusBar) {
      return;
    }
    const endpoint = this.target ? describeTarget(this.target) : "configured daemon";
    if (state.status === "connected") {
      this.statusBar.text = this.connectedHostLabel
        ? `$(remote) Paseo: ${this.connectedHostLabel}`
        : "$(remote) Paseo";
      this.statusBar.tooltip = `Connected to ${endpoint}`;
      this.statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.remoteBackground");
      this.statusBar.color = new vscode.ThemeColor("statusBarItem.remoteForeground");
    } else if (state.status === "connecting") {
      this.statusBar.text = "$(sync~spin) Paseo";
      this.statusBar.tooltip = `Connecting to ${endpoint}`;
      this.statusBar.backgroundColor = undefined;
      this.statusBar.color = undefined;
    } else if (state.status === "disconnected") {
      this.statusBar.text = "$(debug-disconnect) Paseo";
      this.statusBar.tooltip = state.reason ?? `Disconnected from ${endpoint}`;
      this.statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
      this.statusBar.color = undefined;
    } else {
      this.statusBar.text = "$(circle-outline) Paseo";
      this.statusBar.tooltip = "Paseo daemon is not connected";
      this.statusBar.backgroundColor = undefined;
      this.statusBar.color = undefined;
    }
    this.statusBar.command =
      state.status === "connected" ? "paseo.workspace.open" : "paseo.daemon.reconnect";
    this.statusBar.show();
  }

  private disposeClient(): void {
    for (const dispose of this.cleanup.splice(0)) {
      dispose();
    }
    if (this.client) {
      void this.client.close();
    }
    this.client = null;
    this.workspaces.clear();
    this.connectedHostLabel = null;
    this.state = { status: "idle" };
    this.renderStatus(this.state);
    this.statusChangedEmitter.fire(this.state);
  }

  private assertConnectionCanChangeHosts(): void {
    if (this.options.pinnedServerId) {
      throw new Error(
        `This VS Code window is pinned to Paseo host ${this.options.pinnedServerId}. Open another host in a new window instead.`,
      );
    }
  }
}

function getConnectedHostLabel(
  target: ConnectionTarget,
  hostname: string | null | undefined,
): string {
  if (target.kind === "relay" && target.connection.label !== target.connection.serverId) {
    return target.connection.label;
  }
  return hostname?.trim() || (target.kind === "relay" ? target.connection.serverId : "local");
}

function describeTarget(target: ConnectionTarget): string {
  if (target.kind === "relay") {
    return `relay ${target.connection.relayEndpoint} for ${target.connection.label}`;
  }
  return `${target.endpoint.endpoint} (${target.endpoint.source})`;
}
