import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { WorkArtifactsSchema, WorkDataQueryResultSchema } from "@getpaseo/protocol/work-data";
import { history, recordStream } from "./wandb/fixtures/records.js";
import { WorkObjectResultSchema, WorkListResultSchema } from "@getpaseo/protocol/work-objects";

const execute = promisify(execFile);

it("serves Works RPCs, shared metrics/progress, artifact bytes and v1 viewers through one isolated daemon", async () => {
  const daemon = await createTestPaseoDaemon();
  const root = await mkdtemp(path.join(tmpdir(), "works-integration-"));
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.9.0" });
  try {
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    await client.reconcileAgentSkills();
    const installedSkill = path.join(
      path.dirname(daemon.paseoHome),
      "provider-home",
      ".agents",
      "skills",
      "paseo-works",
      "SKILL.md",
    );
    expect((await stat(installedSkill)).isFile()).toBe(true);
    const installedSkillBody = await readFile(installedSkill, "utf8");
    expect(installedSkillBody).toContain("name: paseo-works");
    expect(installedSkillBody).toContain("Find the work before starting");
    const workspace = await client.createWorkspace({ source: { kind: "directory", path: root } });
    const projectId = workspace.workspace!.projectId;
    const fixture = await readFile(
      fileURLToPath(new URL("./wandb/fixtures/sdk-offline.wandb", import.meta.url)),
    );
    const runFile = path.join(root, "run.wandb");
    await writeFile(
      runFile,
      Buffer.concat([fixture, recordStream([history(1, 0.8), history(2, 0.4)], fixture.length)]),
    );
    await writeFile(
      path.join(root, "index.html"),
      "<!doctype html><title>Report</title><h1>Works report</h1>",
    );
    const changes: string[] = [];
    expect(client.getLastServerInfoMessage()?.features?.works).toBe(true);
    const unsubscribe = client.subscribe((event) => {
      if (event.type === "work.project.changed") changes.push(...event.payload.objectIds);
    });
    await client.subscribeWorkProject({ projectId });
    const created = await client.createWorkCard({
      projectId,
      preset: "experiment",
      title: "Shared run",
      body: "Two attempts read the same source",
      viewers: {
        mounts: { report: root },
        entries: { Report: "report/index.html" },
        sources: { training: { type: "wandb-local", paths: [root] } },
      },
      items: [
        {
          preset: "attempt",
          title: "First",
          body: "Run once",
          progress: {
            source: {
              type: "viewer-source",
              source: { objectId: "parent", source: "training" },
              current: { kind: "step" },
              total: 10,
            },
          },
        },
        {
          preset: "attempt",
          title: "Resume",
          body: "Continue",
          progress: {
            source: {
              type: "viewer-source",
              source: { objectId: "parent", source: "training" },
              current: { kind: "metric", key: ["loss"] },
            },
          },
        },
      ],
    });
    expect(changes).toContain(created.object.id);
    expect(created.items).toHaveLength(2);
    const board = await client.getWorkBoard({ projectId });
    expect(board.itemCounts[created.object.id]).toBe(2);
    const refreshed = await client.refreshWorkProgress({
      projectId,
      objectIds: created.items!.map((item) => item.id),
    });
    expect(refreshed.results.map((result) => result.observation?.current)).toEqual([2, 0.4]);
    const detail = await client.getWorkCard({
      projectId,
      cardId: created.object.id,
      allItems: true,
      select: ["timestamps", "progress", "result"],
    });
    expect(
      detail.items!.every(
        (item) => item.startedAt === null && item.endedAt === null && item.result === null,
      ),
    ).toBe(true);
    const target = daemon.daemon.getExperimentViewerListenTarget();
    if (target?.type !== "tcp") throw new Error("Viewer host must listen on TCP");
    const origin = `http://127.0.0.1:${target.port}`;
    const entries = await client.resolveWorkViewers({ projectId, objectId: created.object.id });
    const report = entries.entries[0]!.path;
    expect(await (await fetch(`${origin}${report}`)).text()).toContain("Works report");
    const range = await fetch(`${origin}${report}`, { headers: { Range: "bytes=0-14" } });
    expect(range.status).toBe(206);
    expect(await range.text()).toBe("<!doctype html>");
    expect(
      (await fetch(`${origin}${report}`, { method: "HEAD" })).headers.get("content-length"),
    ).toBeTruthy();
    const source = entries.sources[0]!.apiPath;
    const query = WorkDataQueryResultSchema.parse(
      await (
        await fetch(
          `${origin}${source}/query?q=${encodeURIComponent(JSON.stringify({ series: [["loss"]] }))}`,
        )
      ).json(),
    );
    expect(query.series[0]!.points).toEqual([
      [1, 0.8],
      [2, 0.4],
    ]);
    const artifacts = WorkArtifactsSchema.parse(
      await (await fetch(`${origin}${source}/artifacts`)).json(),
    );
    const entry = artifacts.artifacts[0]!.files[0]!;
    expect(entry.available).toBe(false);
    const artifactFile = path.join(root, entry.path);
    await mkdir(path.dirname(artifactFile), { recursive: true });
    await writeFile(artifactFile, "artifact content");
    const available = WorkArtifactsSchema.parse(
      await (await fetch(`${origin}${source}/artifacts`)).json(),
    );
    const href = available.artifacts[0]!.files[0]!.href!;
    expect(await (await fetch(`${origin}${href}`)).text()).toBe("artifact content");
    await writeFile(artifactFile, Buffer.alloc(16 * 1024 * 1024, 42));
    const download = await fetch(`${origin}${href}`);
    const downloadReader = download.body!.getReader();
    expect((await downloadReader.read()).value!.length).toBeGreaterThan(0);
    expect((await client.getWorkBoard({ projectId })).cards).toHaveLength(1);
    await downloadReader.cancel();
    const largeForward = await client.fetchViewerHttp({ method: "GET", path: href, headers: {} });
    const transferred = new Promise<number>((resolve, reject) => {
      let bytes = 0;
      largeForward.stream.setHandlers({
        onData(chunk) {
          bytes += chunk.length;
          largeForward.stream.consumed(chunk.length);
        },
        onEnd() {
          resolve(bytes);
        },
        onReset() {
          reject(new Error("Artifact forwarding failed"));
        },
      });
    });
    const [byteCount, duringTransfer] = await Promise.all([
      transferred,
      client.listWorkCards({ projectId }),
    ]);
    expect(byteCount).toBe(16 * 1024 * 1024);
    expect(duringTransfer.objects).toHaveLength(1);
    const forwarded = await client.fetchViewerHttp({ method: "GET", path: report, headers: {} });
    const body = await new Promise<string>((resolve, reject) => {
      const parts: Buffer[] = [];
      forwarded.stream.setHandlers({
        onData(bytes) {
          parts.push(Buffer.from(bytes));
          forwarded.stream.consumed(bytes.length);
        },
        onEnd() {
          resolve(Buffer.concat(parts).toString());
        },
        onReset() {
          reject(new Error("Forwarding failed"));
        },
      });
    });
    expect(body).toContain("Works report");
    const legacy = await client.createExperiment({
      projectId,
      shortDescription: "V1",
      description: "Legacy report",
    });
    await client.configureExperimentViewer({
      projectId,
      target: { experiment: legacy.experiment.id },
      viewer: { mounts: { report: root }, entries: { Report: "report/index.html" } },
    });
    const legacyViewers = await client.resolveExperimentViewers({
      projectId,
      target: { experiment: legacy.experiment.id },
    });
    expect(await (await fetch(`${origin}${legacyViewers.entries[0]!.url}`)).text()).toContain(
      "Works report",
    );
    expect(
      (await client.listExperiments({ projectId })).experiments.map((record) => record.id),
    ).toEqual([legacy.experiment.id]);
    expect((await client.listWorkCards({ projectId })).objects.map((record) => record.id)).toEqual([
      created.object.id,
    ]);
    await checkCli(daemon.port, daemon.paseoHome, projectId, created.items![0]!.id);
    await client.unsubscribeWorkProject({ projectId });
    unsubscribe();
  } finally {
    await client.close();
    await daemon.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

async function checkCli(port: number, home: string, projectId: string, itemId: string) {
  const entry = fileURLToPath(new URL("../../../../cli/src/index.ts", import.meta.url));
  async function cli(args: string[]) {
    const result = await execute(
      process.execPath,
      [
        "--import",
        "tsx",
        entry,
        "work",
        ...args,
        "--project",
        projectId,
        "--host",
        `127.0.0.1:${port}`,
        "--json",
      ],
      {
        env: { ...process.env, PASEO_HOME: home },
        timeout: 20_000,
      },
    );
    return JSON.parse(result.stdout);
  }
  const completed = WorkObjectResultSchema.parse(
    await cli([
      "item",
      "update",
      itemId,
      "--completed",
      "--input",
      JSON.stringify({ returning: ["timestamps", "result"] }),
    ]),
  );
  expect(completed.object.result?.completed).toBe(true);
  expect(completed.object.startedAt).toBeTruthy();
  expect(completed.object.endedAt).toBeTruthy();
  const reopened = WorkObjectResultSchema.parse(
    await cli([
      "item",
      "update",
      itemId,
      "--no-completed",
      "--input",
      JSON.stringify({ returning: ["timestamps", "result"] }),
    ]),
  );
  expect(reopened.object.startedAt).toBe(completed.object.startedAt);
  expect(reopened.object.endedAt).toBeNull();
  const listed = WorkListResultSchema.parse(await cli(["card", "ls"]));
  expect(listed.objects[0]?.title).toBe("Shared run");
}
