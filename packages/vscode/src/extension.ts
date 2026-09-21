import * as vscode from "vscode";
import { PaseoAgentChatManager } from "./chat/agent-chat";
import { type HostConnectionChoice, PaseoConnection } from "./daemon/connection";
import { acquireWorkspaceConnection } from "./daemon/workspace-connection-policy";
import { PaseoFileSystemProvider } from "./fs/provider";
import {
  createPaseoWorkspaceUri,
  getOpenPaseoWorkspaceUri,
  isCurrentPaseoWorkspaceUri,
  parsePaseoWorkspaceIdentity,
  parsePaseoWorkspaceUri,
  PASEO_FILE_SYSTEM_SCHEME,
} from "./fs/uri";
import { PASEO_TERMINAL_PROFILE_ID, PaseoTerminalManager } from "./terminal/terminal-bridge";
import { type PaseoSessionLeaf, PaseoSessionTreeProvider } from "./tree/session-tree";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Paseo");
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const openWorkspaceUri = getOpenPaseoWorkspaceUri();
  let initialServerId: string | null = null;
  let workspaceNeedsReopen = false;
  if (openWorkspaceUri) {
    try {
      initialServerId = parsePaseoWorkspaceIdentity(openWorkspaceUri).serverId;
      workspaceNeedsReopen = !isCurrentPaseoWorkspaceUri(openWorkspaceUri);
    } catch (error) {
      workspaceNeedsReopen = true;
      logError(output, error);
    }
  }
  const connection = new PaseoConnection(context, output, statusBar, initialServerId, {
    pinnedServerId: initialServerId,
  });
  const fileSystem = new PaseoFileSystemProvider(connection);
  const sessionTree = new PaseoSessionTreeProvider(connection);
  const agentChat = new PaseoAgentChatManager(connection, context.extensionUri, output);
  const terminalManager = new PaseoTerminalManager(connection, (operation) => {
    void showErrors(
      output,
      operation.then(() => sessionTree.refresh()),
    );
  });
  const workspaceActive = openWorkspaceUri !== null;
  await vscode.commands.executeCommand("setContext", "paseo.workspaceActive", workspaceActive);

  const treeView = vscode.window.createTreeView("paseo.sessions", {
    treeDataProvider: sessionTree,
    showCollapseAll: true,
  });
  context.subscriptions.push(
    output,
    statusBar,
    connection,
    fileSystem,
    sessionTree,
    agentChat,
    terminalManager,
    treeView,
    vscode.workspace.registerFileSystemProvider(PASEO_FILE_SYSTEM_SCHEME, fileSystem, {
      isCaseSensitive: process.platform === "linux",
      isReadonly: true,
    }),
    vscode.window.registerTerminalProfileProvider(PASEO_TERMINAL_PROFILE_ID, {
      provideTerminalProfile: () => terminalManager.createProfile(),
    }),
    vscode.commands.registerCommand("paseo.workspace.open", () =>
      showErrors(output, openPaseoWorkspace(connection, { chooseHost: true })),
    ),
    vscode.commands.registerCommand("paseo.host.addRelay", () =>
      showErrors(output, addRelayHostAndOpen(connection)),
    ),
    vscode.commands.registerCommand("paseo.sessions.refresh", () =>
      showErrors(output, sessionTree.refresh()),
    ),
    vscode.commands.registerCommand("paseo.daemon.reconnect", () =>
      showErrors(
        output,
        connection.reconnect().then(() => sessionTree.refresh()),
      ),
    ),
    vscode.commands.registerCommand("paseo.daemon.setPassword", () =>
      showErrors(output, connection.promptAndStorePassword()),
    ),
    vscode.commands.registerCommand("paseo.daemon.clearPassword", () =>
      showErrors(
        output,
        connection.clearStoredPassword().then(async () => {
          await vscode.window.showInformationMessage("Paseo daemon password cleared.");
          return undefined;
        }),
      ),
    ),
    vscode.commands.registerCommand("paseo.agent.archive", (leaf: PaseoSessionLeaf) =>
      showErrors(output, archiveAgent(connection, sessionTree, leaf)),
    ),
    vscode.commands.registerCommand("paseo.agent.open", (leaf: PaseoSessionLeaf) =>
      showErrors(output, agentChat.open(leaf)),
    ),
    vscode.commands.registerCommand("paseo.agent.resume", (leaf: PaseoSessionLeaf) =>
      showErrors(output, resumeAgent(connection, sessionTree, agentChat, leaf)),
    ),
    vscode.commands.registerCommand("paseo.terminal.create", () =>
      showErrors(
        output,
        terminalManager.create().then(() => sessionTree.refresh()),
      ),
    ),
    vscode.commands.registerCommand("paseo.terminal.open", (leaf: PaseoSessionLeaf) =>
      showErrors(output, terminalManager.open(leaf)),
    ),
    vscode.commands.registerCommand("paseo.terminal.kill", (leaf: PaseoSessionLeaf) =>
      showErrors(output, killTerminal(terminalManager, sessionTree, leaf)),
    ),
    connection.onDidChangeStatus((state) => {
      if (state.status === "connected" && workspaceActive && !workspaceNeedsReopen) {
        void sessionTree.refresh().catch((error) => logError(output, error));
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("paseo.endpoint")) {
        void connection
          .refreshDirectConnectionConfiguration()
          .catch((error) => logError(output, error));
      }
    }),
  );

  if (workspaceNeedsReopen) {
    void vscode.window
      .showWarningMessage(
        "This window uses an obsolete Paseo workspace URI. Reopen it to use the daemon's actual workspace path.",
        "Reopen Workspace",
      )
      .then((choice) => {
        if (choice === "Reopen Workspace") {
          void vscode.commands.executeCommand("paseo.workspace.open");
        }
        return undefined;
      });
  } else if (workspaceActive) {
    void sessionTree.refresh().catch((error) => {
      logError(output, error);
      void vscode.window
        .showWarningMessage(`Paseo workspace could not connect: ${getErrorMessage(error)}`, "Retry")
        .then((choice) => {
          if (choice === "Retry") {
            void vscode.commands.executeCommand("paseo.daemon.reconnect");
          }
          return undefined;
        });
    });
  }
}

export function deactivate(): void {}

async function openPaseoWorkspace(
  connection: PaseoConnection,
  options: { chooseHost?: boolean; hostChoice?: HostConnectionChoice },
): Promise<void> {
  let hostChoice: HostConnectionChoice | null | undefined = options.hostChoice;
  if (options.chooseHost) {
    hostChoice = await chooseHostConnection(connection);
    if (!hostChoice) {
      return;
    }
  }
  if (!hostChoice) {
    throw new Error("No Paseo host connection was selected.");
  }
  const acquired = acquireWorkspaceConnection(
    connection,
    getOpenPaseoWorkspaceUri() !== null,
    hostChoice,
  );
  const workspaceConnection = acquired.connection;

  const { workspaces, serverId } = await (async () => {
    try {
      const client = await workspaceConnection.ensureConnected();
      const activeWorkspaces = (await workspaceConnection.listWorkspaces({ force: true })).filter(
        (workspace) => workspace.archivingAt == null,
      );
      const serverInfo = client.getLastServerInfoMessage();
      if (!serverInfo?.serverId) {
        throw new Error("The Paseo daemon did not identify itself.");
      }
      return { workspaces: activeWorkspaces, serverId: serverInfo.serverId };
    } finally {
      // Cross-host pickers only need a physical connection while fetching this snapshot.
      acquired.release();
    }
  })();

  if (workspaces.length === 0) {
    throw new Error("The Paseo daemon has no active workspaces.");
  }
  const selected = await vscode.window.showQuickPick(
    workspaces.map((workspace) => ({
      label: workspace.name,
      description: workspace.projectDisplayName,
      detail: workspace.workspaceDirectory,
      workspace,
    })),
    {
      title: "Open Paseo Workspace",
      placeHolder: "One VS Code window will be opened for this worktree/workspace",
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!selected) {
    return;
  }
  const folderUri = createPaseoWorkspaceUri(
    serverId,
    selected.workspace.id,
    selected.workspace.workspaceDirectory,
  );
  const forceNewWindow = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  await vscode.commands.executeCommand("vscode.openFolder", folderUri, forceNewWindow);
}

async function addRelayHostAndOpen(connection: PaseoConnection): Promise<void> {
  const saved = await promptForRelayPairingLink(connection);
  if (!saved) {
    return;
  }
  await openPaseoWorkspace(connection, {
    hostChoice: { kind: "relay", serverId: saved.serverId },
  });
}

async function chooseHostConnection(
  connection: PaseoConnection,
): Promise<HostConnectionChoice | null> {
  const relayConnections = connection.savedRelayConnections;
  const items: HostConnectionQuickPickItem[] = [
    ...relayConnections.map((relay) => ({
      label: `$(radio-tower) ${relay.label}`,
      description: relay.serverId,
      detail: relay.relayEndpoint,
      connectionKind: "relay" as const,
      serverId: relay.serverId,
    })),
    {
      label:
        relayConnections.length > 0
          ? "$(add) Add another relay host"
          : "$(globe) Add relay host from pairing link",
      detail: "Use Paseo's encrypted relay without exposing the daemon to the public internet",
      connectionKind: "add",
    },
    {
      label: "$(device-desktop) Direct or local daemon",
      detail: "Use paseo.endpoint, PASEO_VSCODE_ENDPOINT, daemon config, or localhost",
      connectionKind: "direct",
    },
  ];
  const choice = await vscode.window.showQuickPick(items, {
    title: "Choose Paseo Host Connection",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!choice) {
    return null;
  }
  if (choice.connectionKind === "add") {
    const saved = await promptForRelayPairingLink(connection);
    return saved ? { kind: "relay", serverId: saved.serverId } : null;
  }
  if (choice.connectionKind === "direct") {
    return { kind: "direct" };
  }
  if (!choice.serverId) {
    throw new Error("Selected relay host has no server id.");
  }
  return { kind: "relay", serverId: choice.serverId };
}

interface HostConnectionQuickPickItem extends vscode.QuickPickItem {
  connectionKind: "relay" | "add" | "direct";
  serverId?: string;
}

async function promptForRelayPairingLink(connection: PaseoConnection) {
  const pairingLink = await vscode.window.showInputBox({
    title: "Add Paseo Relay Host",
    prompt: "Paste the host pairing link containing #offer=",
    placeHolder: "https://app.paseo.sh/#offer=...",
    ignoreFocusOut: true,
  });
  if (!pairingLink?.trim()) {
    return null;
  }
  return connection.addRelayPairingLink(pairingLink.trim());
}

async function archiveAgent(
  connection: PaseoConnection,
  sessionTree: PaseoSessionTreeProvider,
  leaf: PaseoSessionLeaf,
): Promise<void> {
  if (leaf.value.kind !== "agent") {
    throw new Error("The selected session is not an agent.");
  }
  const choice = await vscode.window.showWarningMessage(
    `Archive ${leaf.label}?`,
    { modal: true },
    "Archive",
  );
  if (choice !== "Archive") {
    return;
  }
  const workspaceUri = getOpenPaseoWorkspaceUri();
  if (!workspaceUri) {
    throw new Error("Open a Paseo workspace first.");
  }
  await connection.assertServer(parsePaseoWorkspaceUri(workspaceUri).serverId);
  const client = await connection.ensureConnected();
  await client.archiveAgent(leaf.value.agent.id);
  await sessionTree.refresh();
}

async function resumeAgent(
  connection: PaseoConnection,
  sessionTree: PaseoSessionTreeProvider,
  agentChat: PaseoAgentChatManager,
  leaf: PaseoSessionLeaf,
): Promise<void> {
  if (leaf.value.kind !== "agent") {
    throw new Error("The selected session is not an agent.");
  }
  const client = await connection.ensureConnected();
  await client.refreshAgent(leaf.value.agent.id);
  await sessionTree.refresh();
  await agentChat.open(leaf);
}

async function killTerminal(
  terminalManager: PaseoTerminalManager,
  sessionTree: PaseoSessionTreeProvider,
  leaf: PaseoSessionLeaf,
): Promise<void> {
  if (leaf.value.kind !== "terminal") {
    throw new Error("The selected session is not a terminal.");
  }
  const choice = await vscode.window.showWarningMessage(
    `Kill ${leaf.label}?`,
    { modal: true },
    "Kill Terminal",
  );
  if (choice !== "Kill Terminal") {
    return;
  }
  await terminalManager.kill(leaf);
  await sessionTree.refresh();
}

async function showErrors(output: vscode.OutputChannel, operation: Promise<void>): Promise<void> {
  try {
    await operation;
  } catch (error) {
    logError(output, error);
    const choice = await vscode.window.showErrorMessage(
      `Paseo: ${getErrorMessage(error)}`,
      "Show Log",
    );
    if (choice === "Show Log") {
      output.show(true);
    }
  }
}

function logError(output: vscode.OutputChannel, error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  output.appendLine(`[error] ${message}`);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
