import {
  appendFile,
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
  open,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { crc32, scanWandb } from "./binary.js";
import {
  item,
  varint,
  double,
  string,
  message,
  frame,
  recordStream,
  history,
} from "./fixtures/records.js";
import { WandbReader } from "./reader.js";
import { queryWandb, writeWandbQuery } from "./query.js";

// Official SDK output, MIT; license accompanies the fixture:
// https://github.com/wandb/wandb/blob/main/tests/assets/wandb/offline-run-20210216_154407-g9dvvkua/run-g9dvvkua.wandb
const fixture = fileURLToPath(new URL("./fixtures/sdk-offline.wandb", import.meta.url));
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it("reads an SDK-created offline run and its artifact manifest without Python", async () => {
  expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  const reader = new WandbReader();
  const snapshot = await reader.read(source([fixture]));
  expect(reader.meta(snapshot).runs).toEqual([
    {
      id: "g9dvvkua",
      name: "",
      project: "code-toad",
      entity: "",
      startedAt: "2021-02-16T23:44:07.000Z",
    },
  ]);
  expect(snapshot.error).toBeNull();
  expect(snapshot.caughtUp).toBe(true);
  expect(snapshot.run!.artifacts.size).toBe(1);
  const artifacts = await reader.artifacts(snapshot, "/data/training");
  expect(artifacts).toHaveLength(1);
  expect(artifacts[0]!.files.length).toBeGreaterThan(0);
  expect(artifacts[0]!.files[0]!.available).toBe(false);
});

it("preserves complete records across partial writes, resume, and replacement; typed values override legacy JSON", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "works-wandb-"));
  directories.push(directory);
  const file = path.join(directory, "run.wandb");
  await copyFile(fixture, file);
  const reader = new WandbReader();
  const input = source([directory]);
  const initial = await reader.read(input);
  const step = item("_step", Buffer.concat([varint(5 << 3), varint(2)]));
  const timestamp = item("_timestamp", double(6, 1800000000));
  const loss = item("train/loss", Buffer.concat([double(6, 0.5), string(16, "999")]));
  const row = message(2, Buffer.concat([step, timestamp, loss]));
  const bytes = frame(row);
  await appendFile(file, bytes.subarray(0, bytes.length - 3));
  const partial = await reader.read(input);
  expect(partial.caughtUp).toBe(false);
  expect(partial.run!.rowCount).toBe(0);
  await appendFile(file, bytes.subarray(bytes.length - 3));
  const resumed = await reader.read(input);
  expect(resumed.generation).toBe(initial.generation);
  const query = await queryWandb(resumed, { series: [["train/loss"]] });
  expect(query.series[0]!.points).toEqual([[1, 0.5]]);
  expect(query.series[0]!.mean).toBe(0.5);
  const latest = await queryWandb(resumed, {
    series: [["train/loss"], ["missing"]],
    mode: "latest",
  });
  expect(latest.series.map((series) => [series.status, series.last])).toEqual([
    ["available", 0.5],
    ["missing", null],
  ]);
  expect((await reader.read(input)).revision).toBe(resumed.revision);
  // A snapshot keeps its committed prefix even while the writer appends.
  await appendFile(file, frame(history(2, 0.25)));
  expect((await queryWandb(resumed, { series: [["loss"]] })).series[0]!.points).toEqual([]);
  const original = await readFile(fixture);
  await writeFile(
    file,
    Buffer.concat([original, recordStream([history(7, 0.9), history(8, 0.7)], original.length)]),
  );
  await expect(queryWandb(resumed, { series: [["loss"]] })).rejects.toThrow("history changed");
  const rewritten = await reader.read(input);
  expect(rewritten.generation).not.toBe(resumed.generation);
  expect((await queryWandb(rewritten, { series: [["loss"]] })).series[0]!.points).toEqual([
    [7, 0.9],
    [8, 0.7],
  ]);
  await writeFile(file, await readFile(fixture));
  const replaced = await reader.read(input);
  expect(replaced.generation).not.toBe(resumed.generation);
  expect(replaced.run!.rowCount).toBe(0);
});

function source(paths: string[]) {
  return {
    objectId: "card_aabbccdd",
    source: "training",
    paths,
    config: { type: "wandb-local" as const, paths },
  };
}

it("reads fragmented records, selects runs, and extends the same run across files without changing generation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "works-wandb-resume-"));
  directories.push(directory);
  const original = await readFile(fixture);
  const first = path.join(directory, "z-first.wandb");
  await writeFile(
    first,
    Buffer.concat([
      original,
      recordStream(
        [
          message(2, item("notes", string(16, JSON.stringify("long history value ".repeat(5000))))),
          history(1, 0.8),
          message(18, Buffer.alloc(0)),
        ],
        original.length,
      ),
    ]),
  );
  const reader = new WandbReader();
  const before = await reader.read(source([directory]));
  expect(before.caughtUp).toBe(true);
  expect(before.run!.ended).toBe(true);
  const resumed = path.join(directory, "a-resumed.wandb");
  await writeFile(
    resumed,
    Buffer.concat([original, recordStream([history(2, 0.4)], original.length)]),
  );
  const after = await reader.read(source([directory]));
  expect(after.generation).toBe(before.generation);
  const queried = await queryWandb(after, { series: [["loss"]] });
  expect(queried.series[0]!.points).toEqual([
    [1, 0.8],
    [2, 0.4],
  ]);
  expect(queried.ended).toBe(false);
  const secondRun = Buffer.concat([
    original.subarray(0, 7),
    recordStream([message(17, string(1, "another")), history(0, 2)]),
  ]);
  await writeFile(path.join(directory, "another.wandb"), secondRun);
  const ambiguous = await reader.read(source([directory]));
  expect(ambiguous.runs).toHaveLength(2);
  await expect(queryWandb(ambiguous, { series: [["loss"]] })).rejects.toThrow("Select a runId");
  const selected = await reader.read({
    ...source([directory]),
    config: { type: "wandb-local", paths: [directory], runId: "another" },
  });
  expect((await queryWandb(selected, { series: [["loss"]] })).series[0]!.last).toBe(2);
});

it("retains valid history on a bad checksum and can cancel large queries without truncating data", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "works-wandb-large-"));
  directories.push(directory);
  const original = await readFile(fixture);
  const file = path.join(directory, "large.wandb");
  const records = Array.from({ length: 100000 }, (_, step) => history(step, step % 10));
  await writeFile(file, Buffer.concat([original, recordStream(records, original.length)]));
  const reader = new WandbReader();
  const input = source([file]);
  const waiting = new AbortController();
  const cacheRoot = path.join(directory, ".paseo", "v2", "cache", "wandb", "legacy");
  await mkdir(cacheRoot, { recursive: true });
  const legacy = await open(path.join(cacheRoot, "state.bin"), "w");
  await legacy.truncate(1_850_000_000);
  await legacy.close();
  const cancelled = reader.read(input, waiting.signal);
  const snapshotPromise = reader.read(input);
  waiting.abort();
  await expect(cancelled).rejects.toThrow();
  const snapshot = await snapshotPromise;
  expect((await queryWandb(snapshot, { series: [["loss"]] })).series[0]!.points).toHaveLength(
    100000,
  );
  const restarted = new WandbReader();
  const restored = await restarted.read(input);
  expect(restored.generation).not.toBe(snapshot.generation);
  expect(restored.revision).toBe(snapshot.revision);
  expect(restored.run!.rowCount).toBe(100000);
  expect(await readdir(cacheRoot)).toEqual(["state.bin"]);
  expect((await queryWandb(restored, { series: [["loss"]], mode: "latest" })).series[0]!.last).toBe(
    9,
  );
  const sampled = await queryWandb(snapshot, { series: [["loss"]], maxPoints: 5 });
  expect(sampled.series[0]).toMatchObject({ count: 100000, mean: 4.5, sampled: true });
  const abort = new AbortController();
  abort.abort();
  await expect(queryWandb(snapshot, { series: [["loss"]] }, abort.signal)).rejects.toThrow();
  const midQuery = new AbortController();
  const pendingQuery = queryWandb(snapshot, { series: [["loss"]], maxPoints: 5 }, midQuery.signal);
  setImmediate(() => midQuery.abort());
  await expect(pendingQuery).rejects.toThrow();
  const corrupt = recordStream([history(100001, 10)], (await readFile(file)).length);
  corrupt[0] = corrupt[0]! ^ 1;
  await appendFile(file, corrupt);
  const damaged = await reader.read(input);
  expect(damaged.error).toContain("checksum mismatch");
  expect(damaged.run!.rowCount).toBe(100000);
  expect(
    (await queryWandb(damaged, { series: [["loss"]], maxPoints: 1 })).series[0]!.points,
  ).toEqual([[99999, 9]]);
  expect(damaged.caughtUp).toBe(false);
}, 60_000);

it("queries history larger than the JS heap directly from a read-only log", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "works-wandb-memory-"));
  directories.push(directory);
  const file = path.join(directory, "large.wandb");
  const original = await readFile(fixture);
  await writeFile(file, original);
  let offset = original.length;
  // Every row has a large, changing payload: retaining decoded history exceeds
  // the child heap, even though the requested curve has only a few points.
  for (let batch = 0; batch < 160; batch++) {
    const records = Array.from({ length: 100 }, (_, index) => {
      const step = batch * 100 + index;
      return Buffer.concat([
        string(19, `record-${step}`),
        message(
          2,
          Buffer.concat([
            item("_step", double(6, step)),
            item("loss", double(6, step % 10)),
            item("payload", string(16, JSON.stringify(`${step}:` + "x".repeat(16384)))),
          ]),
        ),
      ]);
    });
    const bytes = recordStream(records, offset);
    await appendFile(file, bytes);
    offset += bytes.length;
  }
  const script = `
    import assert from "node:assert/strict";
    import { WandbReader } from ${JSON.stringify(new URL("./reader.ts", import.meta.url).href)};
    import { queryWandb, writeWandbQuery } from ${JSON.stringify(new URL("./query.ts", import.meta.url).href)};
    const input = ${JSON.stringify(source([file]))};
    const reader = new WandbReader();
    const snapshot = await reader.read(input);
    const latest = await queryWandb(snapshot, { series: [["loss"]], mode: "latest" });
    assert.equal(latest.lastStep, 15999);
    assert.equal(latest.series[0].last, 9);
    const result = await queryWandb(snapshot, { series: [["loss"]], maxPoints: 5 });
    assert.equal(result.series[0].count, 16000);
    assert.equal(result.series[0].mean, 4.5);
    assert.equal(result.series[0].points.length, 5);
    assert.equal((await reader.read(input)).revision, snapshot.revision);
    let chunks = 0;
    await writeWandbQuery(snapshot, { series: [["loss"]] }, async (chunk) => {
      assert.ok(chunk.length < 70 * 1024);
      chunks++;
    }, new AbortController().signal);
    assert.ok(chunks > 4);
    console.log(JSON.stringify({ heapUsed: process.memoryUsage().heapUsed, rss: process.memoryUsage().rss }));
  `;
  const result = await promisify(execFile)(
    process.execPath,
    ["--max-old-space-size=96", "--import", "tsx", "--input-type=module", "--eval", script],
    { timeout: 60000 },
  );
  expect(result.stdout).toContain("heapUsed");
  expect(await readdir(directory)).toEqual(["large.wandb"]);
}, 60000);

it("preserves range statistics, custom axes, summary fallback and streamed JSON", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "works-wandb-query-"));
  directories.push(directory);
  const file = path.join(directory, "run.wandb");
  const original = await readFile(fixture);
  const records = [
    message(2, item("epoch", double(6, 10))),
    history(0, 3),
    history(1, 2),
    message(2, item("epoch", double(6, 20))),
    history(2, 1),
    history(3, 0),
    message(2, item("text", string(16, JSON.stringify("value")))),
    message(3, item("summary-only", string(16, "42"))),
  ];
  await writeFile(file, Buffer.concat([original, recordStream(records, original.length)]));
  const snapshot = await new WandbReader().read(source([file]));
  const series = [["loss"], ["missing"], ["text"], ["summary-only"]];
  const full = await queryWandb(snapshot, { series });
  const chunks: string[] = [];
  await writeWandbQuery(
    snapshot,
    { series },
    async (chunk) => {
      chunks.push(chunk);
    },
    new AbortController().signal,
  );
  expect(JSON.parse(chunks.join(""))).toEqual(full);
  const sampled = await queryWandb(snapshot, { series, maxPoints: 2 });
  expect(sampled.series[0]).toMatchObject({
    count: 4,
    mean: 1.5,
    points: [
      [0, 3],
      [3, 0],
    ],
    sampled: true,
  });
  const ranged = await queryWandb(snapshot, {
    series,
    x: { kind: "metric", key: ["epoch"] },
    range: { from: 20, to: 21 },
    maxPoints: 1,
  });
  expect(ranged.series[0]).toMatchObject({ count: 2, mean: 0.5, last: 0, points: [[20, 0]] });
  const summary = await queryWandb(snapshot, { series, mode: "summary" });
  expect(summary.series.map((value) => value.status)).toEqual([
    "available",
    "missing",
    "non_numeric",
    "available",
  ]);
  expect(summary.series[3]!.last).toBe(42);
});

it("retains lightweight sources beyond the old count limit and drains scans on close", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "works-wandb-lifecycle-"));
  directories.push(directory);
  const reader = new WandbReader();
  const first = await reader.read(source([fixture]));
  for (let index = 0; index < 64; index++) {
    const file = path.join(directory, `${index}.wandb`);
    await copyFile(fixture, file);
    await reader.read(source([file]));
  }
  const revisited = await reader.read(source([fixture]));
  expect(revisited.generation).toBe(first.generation);
  expect(reader.meta(revisited).runs).toEqual(reader.meta(first).runs);
  const pending = reader.read(source([directory]));
  const cancelled = expect(pending).rejects.toThrow();
  await reader.clear();
  await cancelled;
  const abort = new AbortController();
  const abandoned = reader.read(source([fixture]), abort.signal);
  const rejected = expect(abandoned).rejects.toThrow();
  abort.abort();
  const reopened = reader.read(source([fixture]));
  await rejected;
  expect((await reopened).caughtUp).toBe(true);
  await reader.clear();
});

it("slow consumers do not block other history reads", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered: Array<Promise<void>> = [];
  const scans: Array<Promise<unknown>> = [];
  for (let index = 0; index < 4; index++) {
    let started!: () => void;
    entered.push(
      new Promise<void>((resolve) => {
        started = resolve;
      }),
    );
    scans.push(
      scanWandb(
        fixture,
        0,
        async () => {
          started();
          await held;
        },
        AbortSignal.timeout(5000),
      ),
    );
  }
  try {
    await Promise.all(entered);
    const result = await scanWandb(fixture, 0, () => {}, AbortSignal.timeout(2000));
    expect(result.caughtUp).toBe(true);
  } finally {
    release();
    await Promise.all(scans);
  }
});

it("still serves sources that exceed the metadata reuse budget", async () => {
  const reader = new WandbReader({ cacheBytes: 1 });
  const first = await reader.read(source([fixture]));
  const next = await reader.read(source([fixture]));
  expect(next.generation).not.toBe(first.generation);
  expect(reader.meta(next)).toEqual({ ...reader.meta(first), generation: next.generation });
  await reader.clear();
});
