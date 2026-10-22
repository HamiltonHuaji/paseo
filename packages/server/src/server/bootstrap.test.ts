import { expect, test } from "vitest";

import { fanOutReconciledWorkspaceUpdates } from "./bootstrap.js";

test("reconciliation emits workspace updates when observer sync fails", async () => {
  const emittedWorkspaceIds: string[][] = [];
  const syncFailure = new Error("workspace observer unavailable");

  await fanOutReconciledWorkspaceUpdates({
    sessions: [
      {
        syncWorkspaceGitObserversForExternalWorkspaceIds: async () => {
          throw syncFailure;
        },
        emitWorkspaceUpdatesForExternalWorkspaceIds: async (workspaceIds) => {
          emittedWorkspaceIds.push(Array.from(workspaceIds));
        },
      },
    ],
    workspaceIds: ["ws-reclassified"],
    logger: { warn: () => {} },
  });

  expect(emittedWorkspaceIds).toEqual([["ws-reclassified"]]);
});

test("reconciliation isolates workspace update failures between sessions", async () => {
  const emittedWorkspaceIds: string[][] = [];
  const warnings: unknown[] = [];

  await fanOutReconciledWorkspaceUpdates({
    sessions: [
      {
        syncWorkspaceGitObserversForExternalWorkspaceIds: async () => {},
        emitWorkspaceUpdatesForExternalWorkspaceIds: async () => {
          throw new Error("session closed");
        },
      },
      {
        syncWorkspaceGitObserversForExternalWorkspaceIds: async () => {},
        emitWorkspaceUpdatesForExternalWorkspaceIds: async (workspaceIds) => {
          emittedWorkspaceIds.push(Array.from(workspaceIds));
        },
      },
    ],
    workspaceIds: ["ws-reclassified"],
    logger: {
      warn: (context) => {
        warnings.push(context);
      },
    },
  });

  expect(emittedWorkspaceIds).toEqual([["ws-reclassified"]]);
  expect(warnings).toHaveLength(1);
});

test("viewer HTTP proxy preserves resources through concurrency, cancellation and listener changes", async () => {
  const { createTestPaseoDaemon } = await import("./test-utils/paseo-daemon.js");
  const { DaemonClient } = await import("./test-utils/daemon-client.js");
  const { createLocalViewerHttpProxy } =
    await import("@getpaseo/client/node/local-viewer-http-proxy");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { createServer } = await import("node:http");
  const root = await mkdtemp(path.join(tmpdir(), "paseo-viewer-http-"));
  const daemon = await createTestPaseoDaemon({ mcpEnabled: false });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  let proxy: Awaited<ReturnType<typeof createLocalViewerHttpProxy>> | undefined;
  const occupied = createServer();
  try {
    await writeFile(path.join(root, "index.html"), "viewer report");
    await writeFile(path.join(root, "large.bin"), Buffer.alloc(2 * 1024 * 1024, 97));
    await client.connect();
    const workspace = await client.createWorkspace({ source: { kind: "directory", path: root } });
    const projectId = workspace.workspace!.projectId;
    const card = await client.createWorkCard({
      projectId,
      preset: "topic",
      title: "Viewer",
      body: "Fixture",
      viewers: { mounts: { files: root }, entries: { Report: "files/index.html" } },
    });
    const entries = await client.resolveWorkViewers({ projectId, objectId: card.object.id });
    const report = entries.entries[0]!.path;
    proxy = await createLocalViewerHttpProxy({ fetch: (input) => client.fetchViewerHttp(input) });
    const origin = proxy.origin;
    expect(
      await Promise.all(
        Array.from({ length: 4 }, async () => (await fetch(`${origin}${report}`)).text()),
      ),
    ).toEqual(Array(4).fill("viewer report"));
    const range = await fetch(`${origin}${report}`, { headers: { Range: "bytes=0-5" } });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe("viewer");
    const large = report.replace("index.html", "large.bin");
    const cancelled = await fetch(`${origin}${large}`);
    await cancelled.body!.cancel();
    expect((await (await fetch(`${origin}${large}`)).arrayBuffer()).byteLength).toBe(
      2 * 1024 * 1024,
    );
    expect(
      await (await fetch(`${origin}${report.replace("index.html", "missing.html")}`)).text(),
    ).not.toContain(root);
    expect((await fetch(`${origin}/view/v2/unknown`)).status).toBe(404);
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const rebound = await client.configureExperimentViewerHost(`127.0.0.1:${address.port}`);
    expect(rebound.viewer.port).not.toBe(address.port);
    expect(await (await fetch(`${origin}${report}`)).text()).toBe("viewer report");
    await expect(client.configureExperimentViewerHost("203.0.113.1:0")).rejects.toThrow();
    expect(await (await fetch(`${origin}${report}`)).text()).toBe("viewer report");
    expect(proxy.origin).toBe(origin);
  } finally {
    occupied.close();
    await proxy?.close();
    await client.close();
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
