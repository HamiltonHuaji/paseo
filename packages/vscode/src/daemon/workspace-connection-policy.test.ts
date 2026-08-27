import { describe, expect, it } from "vitest";
import type { HostConnectionChoice } from "./connection";
import { acquireWorkspaceConnection } from "./workspace-connection-policy";

class TestConnection {
  readonly selected: HostConnectionChoice[] = [];
  readonly detached: TestConnection[] = [];
  disposed = false;

  selectHostConnection(choice: HostConnectionChoice): void {
    this.selected.push(choice);
  }

  createDetached(choice: HostConnectionChoice): TestConnection {
    const connection = new TestConnection();
    connection.selected.push(choice);
    this.detached.push(connection);
    return connection;
  }

  dispose(): void {
    this.disposed = true;
  }
}

describe("acquireWorkspaceConnection", () => {
  it("leaves the current window untouched and releases its detached picker connection", () => {
    const primary = new TestConnection();
    const choice = { kind: "relay", serverId: "srv_other" } as const;

    const acquired = acquireWorkspaceConnection(primary, true, choice);

    expect(primary.selected).toEqual([]);
    expect(primary.detached).toEqual([acquired.connection]);
    expect(acquired.connection.selected).toEqual([choice]);
    expect(acquired.connection.disposed).toBe(false);

    acquired.release();

    expect(acquired.connection.disposed).toBe(true);
  });

  it("selects the host on the primary connection outside a Paseo workspace", () => {
    const primary = new TestConnection();
    const choice = { kind: "direct" } as const;

    const acquired = acquireWorkspaceConnection(primary, false, choice);

    expect(acquired.connection).toBe(primary);
    expect(primary.selected).toEqual([choice]);
    expect(primary.detached).toEqual([]);

    acquired.release();

    expect(primary.disposed).toBe(false);
  });
});
