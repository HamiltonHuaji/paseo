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

test("TCP viewer forwarding preserves keep-alive, generations, cancellation and restart", async () => {
  const { createTestPaseoDaemon } = await import("./test-utils/paseo-daemon.js");
  const { DaemonClient } = await import("./test-utils/daemon-client.js");
  const { createLocalTunnelForwarder } =
    await import("@getpaseo/client/node/local-tunnel-forwarder");
  const { createTunnelUpstream } = await import("@getpaseo/client/internal/tunnel-upstream");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Agent, get, createServer } = await import("node:http");
  const root = await mkdtemp(join(tmpdir(), "paseo-viewer-tcp-"));
  const home = join(root, "host");
  let daemon = await createTestPaseoDaemon({
    mcpEnabled: false,
    paseoHomeRoot: home,
    cleanup: false,
  });
  const control = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  const upstream = createTunnelUpstream({
    createClient: (connection) => {
      if (connection.type !== "directTcp") throw new Error("Expected direct route");
      return new DaemonClient({
        url: `ws://${connection.endpoint}/ws`,
        reconnect: { enabled: true },
      });
    },
    onError: () => {},
  });
  const proxy = await createLocalTunnelForwarder({
    openTunnel: upstream.openTunnel,
    target: { type: "service", name: "viewers" },
  });
  const first = new Agent({ keepAlive: true, maxSockets: 1 });
  const second = new Agent({ keepAlive: true, maxSockets: 1 });
  const parallel = new Agent({ keepAlive: true, maxSockets: 6 });
  const occupied = createServer();
  const request = (path: string, agent: InstanceType<typeof Agent> = first) =>
    new Promise<Buffer>((resolve, reject) => {
      get(`${proxy.origin}${path}`, { agent }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      }).on("error", reject);
    });
  try {
    await writeFile(join(root, "index.html"), "TCP viewer report");
    await writeFile(join(root, "large.bin"), Buffer.alloc(8 * 1024 * 1024, 103));
    await control.connect();
    const serverId = control.getLastServerInfoMessage()!.serverId;
    const workspace = await control.createWorkspace({ source: { kind: "directory", path: root } });
    const projectId = workspace.workspace!.projectId;
    const card = await control.createWorkCard({
      projectId,
      preset: "topic",
      title: "TCP viewer",
      body: "Fixture",
      viewers: { mounts: { files: root }, entries: { Report: "files/index.html" } },
    });
    const report = (await control.resolveWorkViewers({ projectId, objectId: card.object.id }))
      .entries[0]!.path;
    const connection = { type: "directTcp" as const, endpoint: `127.0.0.1:${daemon.port}` };
    await upstream.updateRoute(connection, 1);
    expect((await request(report)).toString()).toBe("TCP viewer report");
    const streamId = upstream.getState().generations[0]!.streams[0]!.tunnelId;
    expect((await request(report)).toString()).toBe("TCP viewer report");
    expect(upstream.getState().generations[0]!.streams[0]!.tunnelId).toBe(streamId);
    expect(daemon.daemon.getExperimentViewerState().activeConnections).toBe(1);

    const large = report.replace("index.html", "large.bin");
    const slow = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
      get(`${proxy.origin}${large}`, { agent: parallel }, (response) => {
        response.pause();
        resolve(response);
      }).on("error", reject);
    });
    expect(
      await Promise.all(
        Array.from({ length: 5 }, async () => (await request(report, parallel)).toString()),
      ),
    ).toEqual(Array(5).fill("TCP viewer report"));
    expect(
      upstream
        .getState()
        .generations[0]!.streams.every((stream) => stream.queuedBytes <= 1024 * 1024),
    ).toBe(true);
    slow.destroy();
    expect((await request(large, parallel)).equals(Buffer.alloc(8 * 1024 * 1024, 103))).toBe(true);
    parallel.destroy();

    await upstream.updateRoute(connection, 2);
    expect((await request(report, second)).toString()).toBe("TCP viewer report");
    expect(upstream.getState().currentRouteGeneration).toBe(2);
    expect(
      upstream
        .getState()
        .generations.find((generation) => generation.generation === 1)!
        .streams.some((stream) => stream.tunnelId === streamId),
    ).toBe(true);
    expect((await request(report)).toString()).toBe("TCP viewer report");
    first.destroy();
    await expect
      .poll(() => upstream.getState().generations.map((generation) => generation.generation))
      .toEqual([2]);
    second.destroy();
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    const occupiedAddress = occupied.address();
    if (!occupiedAddress || typeof occupiedAddress === "string")
      throw new Error("Expected TCP port");
    const rebound = await control.configureExperimentViewerHost(
      `127.0.0.1:${occupiedAddress.port}`,
    );
    expect(rebound.viewer.port).not.toBe(occupiedAddress.port);
    expect((await request(report)).toString()).toBe("TCP viewer report");
    first.destroy();
    const origin = proxy.origin;
    await control.close();
    await daemon.close();
    await expect.poll(() => upstream.getState().generations[0]?.activeStreams ?? 0).toBe(0);
    daemon = await createTestPaseoDaemon({
      mcpEnabled: false,
      paseoHomeRoot: home,
      cleanup: false,
      staticDir: daemon.staticDir,
    });
    await upstream.updateRoute({ type: "directTcp", endpoint: `127.0.0.1:${daemon.port}` }, 3);
    expect((await request(report)).toString()).toBe("TCP viewer report");
    expect(proxy.origin).toBe(origin);
    const restarted = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await restarted.connect();
    expect(restarted.getLastServerInfoMessage()!.serverId).toBe(serverId);
    await restarted.close();
  } finally {
    first.destroy();
    second.destroy();
    parallel.destroy();
    occupied.close();
    await proxy.close();
    await upstream.close();
    await control.close();
    await daemon.close();
    await rm(root, { recursive: true, force: true });
    await rm(daemon.staticDir, { recursive: true, force: true });
  }
}, 60_000);

test("TCP viewer streams preserve both half-close directions and source detach", async () => {
  const { createTestPaseoDaemon } = await import("./test-utils/paseo-daemon.js");
  const { DaemonClient } = await import("./test-utils/daemon-client.js");
  const { createLocalTunnelForwarder } =
    await import("@getpaseo/client/node/local-tunnel-forwarder");
  const net = await import("node:net");
  const { once } = await import("node:events");
  const daemon = await createTestPaseoDaemon({ mcpEnabled: false });
  let client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  let phase = "downstream-fin";
  let received = Buffer.alloc(0);
  const targets = new Set<import("node:net").Socket>();
  const target = net.createServer({ allowHalfOpen: true }, (socket) => {
    targets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => targets.delete(socket));
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
    });
    socket.on("end", () => {
      if (phase === "downstream-fin") socket.end(`received:${received.length}`);
    });
    if (phase === "upstream-fin") socket.end("upstream FIN");
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const address = target.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  await client.connect();
  const proxy = await createLocalTunnelForwarder({
    openTunnel: (destination) => client.openTunnel(destination),
    target: { type: "tcp", host: "127.0.0.1", port: address.port },
  });
  const sockets: import("node:net").Socket[] = [];
  const open = () => {
    const socket = net.createConnection({
      host: proxy.host,
      port: proxy.port,
      allowHalfOpen: true,
    });
    sockets.push(socket);
    socket.on("error", () => {});
    return socket;
  };
  try {
    const downstream = open();
    let reply = "";
    downstream.on("data", (bytes) => {
      reply += bytes.toString();
    });
    const ended = once(downstream, "end");
    downstream.end(Buffer.alloc(1024 * 1024, 73));
    await ended;
    expect(received.equals(Buffer.alloc(1024 * 1024, 73))).toBe(true);
    expect(reply).toBe("received:1048576");
    await expect.poll(() => targets.size).toBe(0);

    phase = "upstream-fin";
    received = Buffer.alloc(0);
    const upstreamFirst = open();
    upstreamFirst.resume();
    await once(upstreamFirst, "end");
    expect(upstreamFirst.writableEnded).toBe(false);
    upstreamFirst.end("bytes after upstream FIN");
    await expect.poll(() => received.toString()).toBe("bytes after upstream FIN");
    await expect.poll(() => targets.size).toBe(0);

    phase = "reset";
    const reset = open();
    await expect.poll(() => targets.size).toBe(1);
    reset.resetAndDestroy();
    await expect.poll(() => targets.size).toBe(0);
    const detached = open();
    await expect.poll(() => targets.size).toBe(1);
    const closed = new Promise<void>((resolve) => detached.once("close", () => resolve()));
    await client.close();
    await closed;
    await expect.poll(() => targets.size).toBe(0);
    await expect.poll(() => proxy.getState().activeConnections).toBe(0);
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
    const recovered = open();
    await expect.poll(() => targets.size).toBe(1);
    expect(proxy.port).toBe(Number(new URL(proxy.origin).port));
    recovered.resetAndDestroy();
    await expect.poll(() => targets.size).toBe(0);

    const { SessionDelivery } = await import("./session/owned-subscriptions/index.js");
    const { decodeTunnelStreamFrame, TunnelStreamOpcode } =
      await import("@getpaseo/protocol/binary-frames/index");
    const originalPermit = SessionDelivery.prototype.permitsBinary;
    let denied = false;
    SessionDelivery.prototype.permitsBinary = function (source, frame) {
      if (!denied && decodeTunnelStreamFrame(frame)?.opcode === TunnelStreamOpcode.Data) {
        denied = true;
        return false;
      }
      return originalPermit.call(this, source, frame);
    };
    try {
      phase = "downstream-fin";
      const rejected = open();
      let deliveredBytes = 0;
      rejected.on("data", (bytes) => {
        deliveredBytes += bytes.length;
      });
      const rejectedClosed = new Promise<void>((resolve) =>
        rejected.once("close", () => resolve()),
      );
      rejected.end("ownership denial");
      await rejectedClosed;
      expect(denied).toBe(true);
      expect(deliveredBytes).toBe(0);
      await expect.poll(() => targets.size).toBe(0);
      await expect.poll(() => proxy.getState().activeConnections).toBe(0);
    } finally {
      SessionDelivery.prototype.permitsBinary = originalPermit;
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    await proxy.close();
    await client.close();
    for (const socket of targets) socket.destroy();
    await new Promise<void>((resolve) => target.close(() => resolve()));
    await daemon.close();
  }
}, 30_000);
