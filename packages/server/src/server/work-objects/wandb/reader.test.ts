import { appendFile, copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { crc32 } from "./binary.js";
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
import { queryWandb } from "./query.js";

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
  expect(partial.run!.rows).toHaveLength(0);
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
  const original = await readFile(fixture);
  await writeFile(
    file,
    Buffer.concat([original, recordStream([history(7, 0.9), history(8, 0.7)], original.length)]),
  );
  const rewritten = await reader.read(input);
  expect(rewritten.generation).not.toBe(resumed.generation);
  expect((await queryWandb(rewritten, { series: [["loss"]] })).series[0]!.points).toEqual([
    [7, 0.9],
    [8, 0.7],
  ]);
  await writeFile(file, await readFile(fixture));
  const replaced = await reader.read(input);
  expect(replaced.generation).not.toBe(resumed.generation);
  expect(replaced.run!.rows).toHaveLength(0);
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
  const cacheRoot = path.join(directory, "cache");
  const cancelled = reader.read(input, waiting.signal, cacheRoot);
  const snapshotPromise = reader.read(input, undefined, cacheRoot);
  waiting.abort();
  await expect(cancelled).rejects.toThrow();
  const snapshot = await snapshotPromise;
  expect((await queryWandb(snapshot, { series: [["loss"]] })).series[0]!.points).toHaveLength(
    100000,
  );
  const restarted = new WandbReader();
  const restored = await restarted.read(input, undefined, cacheRoot);
  expect(restored.generation).toBe(snapshot.generation);
  expect(restored.revision).toBe(snapshot.revision);
  expect(restored.run!.rows).toHaveLength(100000);
  const cacheDirectory = (await readdir(cacheRoot))[0]!;
  await writeFile(path.join(cacheRoot, cacheDirectory, "state.bin"), "incompatible derived cache");
  const rebuilt = await new WandbReader().read(input, undefined, cacheRoot);
  expect(rebuilt.run!.rows).toHaveLength(100000);
  expect(rebuilt.error).toBeNull();
  const sampled = await queryWandb(snapshot, { series: [["loss"]], maxPoints: 5 });
  expect(sampled.series[0]).toMatchObject({ count: 100000, mean: 4.5, sampled: true });
  const abort = new AbortController();
  abort.abort();
  await expect(queryWandb(snapshot, { series: [["loss"]] }, abort.signal)).rejects.toThrow();
  const corrupt = recordStream([history(100001, 10)], (await readFile(file)).length);
  corrupt[0] = corrupt[0]! ^ 1;
  await appendFile(file, corrupt);
  const damaged = await reader.read(input, undefined, cacheRoot);
  expect(damaged.error).toContain("checksum mismatch");
  expect(damaged.run!.rows).toHaveLength(100000);
  expect(damaged.caughtUp).toBe(false);
}, 60_000);
