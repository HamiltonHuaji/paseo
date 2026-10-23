import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import pino from "pino";
import { FileBackedProjectRegistry } from "../workspace-registry.js";
import { ProjectExperimentStore } from "../experiments/store.js";
import { WorkService } from "./service.js";
import { createWorkTools } from "./tools.js";
import { WorkObjectResultSchema, WorkListResultSchema } from "@getpaseo/protocol/work-objects";
import { resolveViewerConfig, resolveViewerPath, resolveWorkSource } from "./viewers.js";
import { parseViewerDeepLink } from "@getpaseo/protocol/viewer-deep-link";
import { DatabaseSync } from "node:sqlite";

const resources: Array<{ root: string; service: WorkService }> = [];
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.service.close();
    await rm(resource.root, { recursive: true, force: true });
  }
});
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "work-service-"));
  const projects = new FileBackedProjectRegistry(
    path.join(root, "registry.json"),
    pino({ level: "silent" }),
  );
  const project = await projects.getOrCreateActiveByRoot({
    rootPath: root,
    kind: "non_git",
    displayName: "Works test",
    timestamp: new Date().toISOString(),
  });
  const service = new WorkService(projects, "test-host");
  resources.push({ root, service });
  return { root, projectId: project.projectId, projects, service };
}

it("returns a single MCP copy of complete content and keeps v1 separate", async () => {
  const { projectId, service, root } = await setup();
  const tools = createWorkTools({
    service,
    projectId: async () => projectId,
    callerAgentId: "executor",
  });
  const body = "完整描述".repeat(2000);
  const result = await tools
    .find((tool) => tool.name === "create_card")!
    .handler({
      preset: "topic",
      title: "模块",
      body,
      items: [{ preset: "issue", title: "修复", body: "具体修改" }],
    });
  expect(result.content).toHaveLength(1);
  expect(result).not.toHaveProperty("structuredContent");
  const part = result.content[0]!;
  if (part.type !== "text") throw new Error("Expected JSON text");
  const created = WorkObjectResultSchema.parse(JSON.parse(part.text));
  expect(created.object.body).toBe(body);
  expect(created.object.storage!.path).toContain(`${path.sep}.paseo${path.sep}v2${path.sep}`);
  const output = await tools
    .find((tool) => tool.name === "list_cards")!
    .handler({ query: "模块", limit: 1 });
  const listedPart = output.content[0]!;
  if (listedPart.type !== "text") throw new Error("Expected JSON text");
  const page = WorkListResultSchema.parse(JSON.parse(listedPart.text));
  expect(page.objects[0]!.body).toBe(body);
  expect(page.objects[0]).not.toHaveProperty("metrics");
  const read = await service.getCard(projectId, {
    cardId: created.object.id,
    select: ["touches", "sessions"],
    allItems: true,
  });
  expect(read.object.sessions).toBeNull();
  expect(read.object.touches?.[0]?.agentId).toBe("executor");
  expect(read.items).toHaveLength(1);
  const legacy = await ProjectExperimentStore.open(root);
  try {
    expect(legacy.listExperiments({})).toEqual([]);
  } finally {
    legacy.close();
  }
});

it("continues a pre-multi-unit v1 database without losing plans or resurrecting cleared plans", async () => {
  const { root, service, projectId } = await setup();
  const directory = path.join(root, ".paseo", "v1");
  await mkdir(directory, { recursive: true });
  const database = path.join(directory, "state.db");
  const db = new DatabaseSync(database);
  db.exec(`CREATE TABLE attempts (
    id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, short_description TEXT NOT NULL,
    purpose TEXT NOT NULL, result_summary TEXT, wandb_id TEXT, job_id TEXT, output_dir TEXT,
    progress_plan_json TEXT, progress_source_json TEXT, viewer_config_json TEXT,
    blob_relpath TEXT NOT NULL, started_at TEXT, ended_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  const plan = { unit: "step", total: 100, segments: [{ label: "Train", start: 0, end: 100 }] };
  db.prepare(`INSERT INTO attempts (id, experiment_id, short_description, purpose,
    progress_plan_json, blob_relpath, created_at, updated_at)
    VALUES ('att_old', 'exp_old', 'Old attempt', 'Keep training', ?, 'blobs/old', '2025-01-01', '2025-01-01')`).run(
    JSON.stringify(plan),
  );
  db.close();
  let legacy = await ProjectExperimentStore.open(root);
  try {
    const expected = { sourceUnit: "step", units: [plan] };
    expect(legacy.getAttempt("att_old")).toMatchObject({
      progressPlan: plan,
      progressPlans: expected,
      blobRelpath: "blobs/old",
      createdAt: "2025-01-01",
    });
    expect(legacy.updateAttempt({ attempt: "att_old", purpose: "Continue" }).progressPlans).toEqual(
      expected,
    );
    const experiment = await legacy.createExperiment({
      shortDescription: "New",
      description: "After upgrade",
    });
    const created = await legacy.createAttempt({
      experiment: experiment.id,
      shortDescription: "New attempt",
      purpose: "Run",
      progressPlan: plan,
    });
    expect(created.progressPlans).toEqual(expected);
    expect(
      legacy.updateAttempt({ attempt: created.id, progressPlan: { unit: "epoch", total: 5 } })
        .progressPlans,
    ).toEqual({ sourceUnit: "epoch", units: [{ unit: "epoch", total: 5 }] });
    legacy.updateAttempt({ attempt: "att_old", progressPlans: null });
    legacy.close();
    legacy = await ProjectExperimentStore.open(root);
    expect(legacy.getAttempt("att_old")).toMatchObject({ progressPlans: null, progressPlan: null });
    expect(legacy.getAttempt(created.id).progressPlans?.sourceUnit).toBe("epoch");
    await service.createCard(projectId, { preset: "topic", title: "Works", body: "Coexists" });
    expect(legacy.listExperiments({})).toHaveLength(1);
    const inspect = new DatabaseSync(database, { readOnly: true });
    try {
      expect(
        inspect.prepare("SELECT progress_plan_json FROM attempts WHERE id = 'att_old'").get(),
      ).toEqual({ progress_plan_json: JSON.stringify(plan) });
    } finally {
      inspect.close();
    }
  } finally {
    legacy.close();
  }
});

it("commits before mkdir failure and repairs storage without duplicate records", async () => {
  const { service, projectId, root } = await setup();
  await service.store(projectId);
  const blobs = path.join(root, ".paseo", "v2", "blobs");
  await writeFile(blobs, "blocked");
  const result = await service.createCard(projectId, {
    preset: "topic",
    title: "Report",
    body: "Retain report",
  });
  expect(result.committed).toBe(true);
  expect(result.storageError).toBeTruthy();
  expect((await service.listCards(projectId, {})).objects).toHaveLength(1);
  await rm(blobs);
  const storage = await service.storage(projectId, result.object.id);
  expect((await stat(storage.path)).isDirectory()).toBe(true);
  await rm(storage.path, { recursive: true });
  expect(await service.storage(projectId, result.object.id)).toEqual(storage);
});

it("returns an unambiguous chat link for a published viewer through MCP", async () => {
  const { projectId, service, root } = await setup();
  await writeFile(path.join(root, "report.html"), "<h1>Training report</h1>");
  const tools = createWorkTools({
    service,
    projectId: async () => projectId,
    callerAgentId: "executor",
  });
  const result = await tools
    .find((tool) => tool.name === "create_card")!
    .handler({
      preset: "topic",
      title: "Report",
      body: "Training results",
      viewers: { mounts: { report: root }, entries: { Report: "report/report.html" } },
    });
  const content = result.content[0]!;
  if (content.type !== "text") throw new Error("Expected JSON text");
  const created = WorkObjectResultSchema.parse(JSON.parse(content.text));
  const entry = created.object.viewerEntries!.entries[0]!;
  const expectedPath = `/view/v2/${encodeURIComponent(projectId)}/${created.object.id}/files/report/report.html`;
  expect(entry).toEqual({
    name: "Report",
    path: expectedPath,
    href: `paseo://h/test-host${expectedPath}`,
    available: true,
    unavailableReason: null,
  });
  expect(parseViewerDeepLink(entry.href!)).toEqual({ serverId: "test-host", path: expectedPath });
});

it("inherits in target context while preserving an explicit source across attempts", async () => {
  const { service, projectId, root } = await setup();
  const base = await service.createCard(projectId, {
    preset: "experiment",
    title: "Base",
    body: "Baseline",
    viewers: {
      mounts: { "": "${storage.path}", "report/assets": "assets" },
      entries: { Report: "report/index.html" },
      sources: { run: { type: "wandb-local", paths: ["${storage.path}/wandb"] } },
    },
  });
  const derived = await service.createCard(projectId, {
    preset: "experiment",
    title: "Derived",
    body: "Same layout",
    basedOn: base.object.id,
    items: [{ preset: "attempt", title: "Resume", body: "Continue run" }],
  });
  const store = await service.store(projectId);
  const item = derived.items![0]!;
  expect(resolveViewerConfig(store, store.get(item.id)).inheritedFrom).toBe(base.object.id);
  expect(await resolveViewerPath(store, item.id, "report/index.html")).toBe(
    path.join(item.storage!.path, "report", "index.html"),
  );
  expect(await resolveViewerPath(store, item.id, "report/assets/chart.js")).toBe(
    path.join(root, "assets", "chart.js"),
  );
  expect(
    (await resolveWorkSource(store, { objectId: base.object.id, source: "run" })).paths,
  ).toEqual([path.join(base.object.storage!.path, "wandb")]);
  await service.updateItem(projectId, { itemId: item.id, viewers: {} });
  expect(resolveViewerConfig(store, store.get(item.id)).inheritedFrom).toBeNull();
  expect(await resolveViewerPath(store, item.id, "report/index.html")).toBeNull();
  await service.updateItem(projectId, { itemId: item.id, viewers: null });
  expect(resolveViewerConfig(store, store.get(item.id)).inheritedFrom).toBe(base.object.id);
  await service.updateCard(projectId, {
    cardId: base.object.id,
    viewers: { entries: { Notes: "notes.md" } },
    sessions: { add: ["standing"] },
  });
  await service.updateCard(projectId, {
    cardId: base.object.id,
    viewers: { entries: { Report: null } },
    sessions: { add: ["second"] },
  });
  expect(store.getCard(base.object.id).viewers?.entries).toEqual({ Notes: "notes.md" });
  expect(store.getCard(base.object.id).sessions?.agentIds).toEqual(["standing", "second"]);
});

it("runs commands from project root and leaves unchanged observations out of activity time", async () => {
  const { service, projectId, root } = await setup();
  await writeFile(
    path.join(root, "value.json"),
    JSON.stringify({ current: 2, total: 10, ended: false }),
  );
  const created = await service.createCard(projectId, {
    preset: "experiment",
    title: "Progress",
    body: "Observe execution",
    items: [
      {
        preset: "attempt",
        title: "Run",
        body: "Read current state",
        progress: {
          source: {
            type: "command",
            argv: [
              process.execPath,
              "-e",
              "process.stdout.write(require('node:fs').readFileSync('value.json'))",
            ],
            parse: { type: "json" },
          },
        },
      },
    ],
  });
  const id = created.items![0]!.id;
  const first = (await service.refreshProgress(projectId, [id]))[0]!;
  expect(first.observation?.current).toBe(2);
  expect(first.error).toBeNull();
  const store = await service.store(projectId);
  const at = store.get(id).updatedAt;
  await service.refreshProgress(projectId, [id]);
  expect(store.get(id).updatedAt).toBe(at);
  const log = path.join(root, "train.log");
  await writeFile(log, "step=3/10\n");
  await service.updateItem(projectId, {
    itemId: id,
    progress: {
      source: {
        type: "log",
        path: "train.log",
        progressRegex: "step=(?<current>\\d+)/(?<total>\\d+)",
        endRegex: "done",
      },
    },
  });
  expect((await service.refreshProgress(projectId, [id]))[0]!.observation?.current).toBe(3);
  await writeFile(log, "step=1/2\ndone\n");
  const end = (await service.refreshProgress(projectId, [id]))[0]!;
  expect(end.observation).toMatchObject({ current: 1, total: 2, ended: true });
  expect(store.get(id).endedAt).not.toBeNull();
  expect(store.get(id).result).toBeNull();
});
