import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { serialize, deserialize } from "node:v8";
import { z } from "zod";

const ValueSchema = z.object({
  value: z.unknown(),
  time: z.number().nullable(),
  step: z.number().nullable(),
});
const FileSchema = z.object({
  path: z.string(),
  digest: z.string(),
  ref: z.string(),
  size: z.number(),
  localPath: z.string(),
});
const RunSchema = z.object({
  id: z.string(),
  name: z.string(),
  project: z.string(),
  entity: z.string(),
  startedAt: z.string().nullable(),
  ended: z.boolean().nullable(),
  rows: z.array(
    z.object({
      step: z.number().nullable(),
      time: z.number().nullable(),
      values: z.map(z.string(), z.unknown()),
    }),
  ),
  config: z.map(z.string(), z.unknown()),
  summary: z.map(z.string(), z.unknown()),
  artifacts: z.map(
    z.string(),
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      description: z.string(),
      aliases: z.array(z.string()),
      files: z.array(FileSchema),
      manifestPath: z.string(),
    }),
  ),
  uuids: z.set(z.string()),
  activityAt: z.string().nullable(),
  latest: z.map(z.string(), ValueSchema),
});
export const CachedLogSchema = z.object({
  identity: z.string(),
  offset: z.number(),
  anchor: z.string(),
  size: z.number(),
  mtime: z.number(),
  run: RunSchema,
  caughtUp: z.boolean(),
  error: z.string().nullable(),
});
const CacheSchema = z.object({
  version: z.literal(1),
  generation: z.string(),
  revision: z.number(),
  logs: z.map(z.string(), CachedLogSchema),
});
type Cache = z.infer<typeof CacheSchema>;

export async function restoreCache(directory: string): Promise<Cache | null> {
  try {
    return CacheSchema.parse(deserialize(await readFile(path.join(directory, "state.bin"))));
  } catch {
    return null;
  } // Derived state is disposable, including after a Node/reader format change.
}

export async function persistCache(
  directory: string,
  value: Omit<Cache, "version">,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `state-${process.pid}.tmp`);
  await writeFile(temporary, serialize({ version: 1, ...value }));
  await rename(temporary, path.join(directory, "state.bin"));
}
