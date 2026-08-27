import type { HostConnectionChoice } from "./connection";

interface WorkspaceConnectionHandle<TConnection> {
  createDetached(choice: HostConnectionChoice): TConnection;
  dispose(): void;
  selectHostConnection(choice: HostConnectionChoice): void;
}

export interface AcquiredWorkspaceConnection<TConnection> {
  connection: TConnection;
  release(): void;
}

export function acquireWorkspaceConnection<
  TConnection extends WorkspaceConnectionHandle<TConnection>,
>(
  primary: TConnection,
  hasOpenPaseoWorkspace: boolean,
  choice: HostConnectionChoice,
): AcquiredWorkspaceConnection<TConnection> {
  if (hasOpenPaseoWorkspace) {
    const detached = primary.createDetached(choice);
    return {
      connection: detached,
      release: () => detached.dispose(),
    };
  }

  primary.selectHostConnection(choice);
  return {
    connection: primary,
    release: () => undefined,
  };
}
