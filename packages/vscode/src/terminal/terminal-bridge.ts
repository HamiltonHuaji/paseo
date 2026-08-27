import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { renderTerminalSnapshotToAnsi } from "@getpaseo/protocol/terminal-snapshot";
import * as vscode from "vscode";
import type { PaseoConnection } from "../daemon/connection";
import { getOpenPaseoWorkspaceUri, parsePaseoWorkspaceUri } from "../fs/uri";
import type { PaseoSessionLeaf, PaseoTerminalInfo } from "../tree/session-tree";
import { shouldRouteShellTerminalToPaseo } from "./terminal-routing";

export const PASEO_TERMINAL_PROFILE_ID = "paseo.terminalProfile";

interface PaseoTerminalOptions extends vscode.ExtensionTerminalOptions {
  pty: PaseoPseudoterminal;
}

export class PaseoTerminalManager implements vscode.Disposable {
  private readonly terminals = new Map<
    string,
    { terminal: vscode.Terminal; pty: PaseoPseudoterminal }
  >();
  private readonly openTerminalSubscription: vscode.Disposable;

  constructor(
    private readonly connection: PaseoConnection,
    private readonly runBackgroundOperation: (operation: Promise<void>) => void,
  ) {
    this.openTerminalSubscription = vscode.window.onDidOpenTerminal((terminal) => {
      const options = terminal.creationOptions;
      if (!("pty" in options)) {
        const workspaceUri = getOpenPaseoWorkspaceUri();
        if (
          workspaceUri &&
          shouldRouteShellTerminalToPaseo(
            {
              cwd: options.cwd,
              hasExplicitLaunchConfiguration:
                options.name !== undefined ||
                options.shellPath !== undefined ||
                options.shellArgs !== undefined ||
                options.env !== undefined,
            },
            workspaceUri,
          )
        ) {
          terminal.dispose();
          this.runBackgroundOperation(this.create());
        }
        return;
      }
      const pty = options.pty;
      if (!(pty instanceof PaseoPseudoterminal)) {
        return;
      }
      this.terminals.set(pty.terminalId, { terminal, pty });
    });
  }

  async open(input: PaseoSessionLeaf | PaseoTerminalInfo): Promise<void> {
    const info = "kind" in input ? getTerminalFromLeaf(input) : input;
    await this.assertCurrentWorkspaceServer();
    const existing = this.terminals.get(info.id);
    if (existing) {
      existing.terminal.show();
      return;
    }

    const terminalOptions = await this.createTerminalOptions(info);
    const terminal = vscode.window.createTerminal(terminalOptions);
    const pty = terminalOptions.pty;
    this.terminals.set(info.id, { terminal, pty });
    terminal.show();
  }

  async create(): Promise<void> {
    const terminalOptions = await this.createNewTerminalOptions();
    const terminal = vscode.window.createTerminal(terminalOptions);
    this.terminals.set(terminalOptions.pty.terminalId, {
      terminal,
      pty: terminalOptions.pty,
    });
    terminal.show();
  }

  async createProfile(): Promise<vscode.TerminalProfile> {
    return new vscode.TerminalProfile(await this.createNewTerminalOptions());
  }

  async kill(input: PaseoSessionLeaf | PaseoTerminalInfo): Promise<void> {
    const info = "kind" in input ? getTerminalFromLeaf(input) : input;
    await this.assertCurrentWorkspaceServer();
    const client = await this.connection.ensureConnected();
    const payload = await client.killTerminal(info.id);
    if (!payload.success) {
      throw new Error(`Unable to kill terminal ${info.id}.`);
    }
    this.terminals.get(info.id)?.terminal.dispose();
    this.terminals.delete(info.id);
  }

  dispose(): void {
    this.openTerminalSubscription.dispose();
    for (const { terminal } of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
  }

  private async createNewTerminalOptions(): Promise<PaseoTerminalOptions> {
    const workspaceUri = getOpenPaseoWorkspaceUri();
    if (!workspaceUri) {
      throw new Error("Open a Paseo workspace before creating a terminal.");
    }
    const { serverId, workspaceId } = parsePaseoWorkspaceUri(workspaceUri);
    await this.connection.assertServer(serverId);
    const workspace = await this.connection.getWorkspace(workspaceId);
    const client = await this.connection.ensureConnected();
    const payload = await client.createTerminal(
      workspace.workspaceDirectory,
      undefined,
      undefined,
      {
        workspaceId,
        size: { rows: 30, cols: 120 },
      },
    );
    if (payload.error || !payload.terminal) {
      throw new Error(payload.error ?? "Paseo daemon did not create a terminal.");
    }
    return this.createTerminalOptions(payload.terminal, client);
  }

  private async createTerminalOptions(
    info: PaseoTerminalInfo,
    connectedClient?: DaemonClient,
  ): Promise<PaseoTerminalOptions> {
    const client = connectedClient ?? (await this.connection.ensureConnected());
    let pty: PaseoPseudoterminal;
    pty = new PaseoPseudoterminal(client, info.id, () => {
      const tracked = this.terminals.get(info.id);
      if (tracked?.pty === pty) {
        this.terminals.delete(info.id);
      }
    });
    return {
      name: info.title?.trim() || info.name,
      pty,
      iconPath: new vscode.ThemeIcon("remote"),
      isTransient: true,
    };
  }

  private async assertCurrentWorkspaceServer(): Promise<void> {
    const workspaceUri = getOpenPaseoWorkspaceUri();
    if (!workspaceUri) {
      throw new Error("Open a Paseo workspace first.");
    }
    await this.connection.assertServer(parsePaseoWorkspaceUri(workspaceUri).serverId);
  }
}

class PaseoPseudoterminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number | void>();
  private readonly decoder = new TextDecoder();
  private cleanup: Array<() => void> = [];
  private dimensions: vscode.TerminalDimensions = { columns: 120, rows: 30 };
  private subscribed = false;
  private closed = false;

  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  constructor(
    private readonly client: DaemonClient,
    readonly terminalId: string,
    private readonly onClosed: () => void,
  ) {}

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    if (initialDimensions) {
      this.dimensions = initialDimensions;
    }
    this.cleanup.push(
      this.client.onTerminalStreamEvent((event) => {
        if (event.terminalId !== this.terminalId) {
          return;
        }
        if (event.type === "snapshot") {
          this.writeEmitter.fire(renderTerminalSnapshotToAnsi(event.state));
          return;
        }
        this.writeEmitter.fire(this.decoder.decode(event.data, { stream: true }));
      }),
      this.client.on("terminal_stream_exit", (message) => {
        if (message.payload.terminalId === this.terminalId) {
          this.finish(0);
        }
      }),
    );
    void this.subscribe();
  }

  close(): void {
    this.finish();
  }

  handleInput(data: string): void {
    this.client.sendTerminalInput(this.terminalId, { type: "input", data });
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    this.dimensions = dimensions;
    if (this.subscribed) {
      this.client.sendTerminalInput(this.terminalId, {
        type: "resize",
        rows: dimensions.rows,
        cols: dimensions.columns,
      });
    }
  }

  private async subscribe(): Promise<void> {
    try {
      const response = await this.client.subscribeTerminal(this.terminalId, {
        restore: {
          mode: "visible-snapshot",
          scrollbackLines: 500,
          size: { rows: this.dimensions.rows, cols: this.dimensions.columns },
        },
      });
      if (response.error) {
        throw new Error(response.error);
      }
      if (this.closed) {
        this.client.unsubscribeTerminal(this.terminalId);
        return;
      }
      this.subscribed = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.writeEmitter.fire(`\r\n[Paseo terminal connection failed: ${message}]\r\n`);
      this.finish(1);
    }
  }

  private finish(exitCode?: number): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.subscribed) {
      this.client.unsubscribeTerminal(this.terminalId);
    }
    for (const cleanup of this.cleanup.splice(0)) {
      cleanup();
    }
    this.writeEmitter.fire(this.decoder.decode());
    this.closeEmitter.fire(exitCode);
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
    this.onClosed();
  }
}

function getTerminalFromLeaf(leaf: PaseoSessionLeaf): PaseoTerminalInfo {
  if (leaf.value.kind !== "terminal") {
    throw new Error("The selected Paseo session is not a terminal.");
  }
  return leaf.value.terminal;
}
