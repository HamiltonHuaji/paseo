import { z } from "zod";
import { WorkMetricAxisSchema, WorkMetricRangeSchema } from "./work-objects.js";

export const WorkDataQuerySchema = z.object({
  series: z.array(z.array(z.string()).min(1)),
  x: WorkMetricAxisSchema.optional(),
  range: WorkMetricRangeSchema.optional(),
  mode: z.enum(["series", "summary", "latest"]).optional(),
  maxPoints: z.number().int().positive().optional(),
});
export const WorkDataRunSchema = z.object({
  id: z.string(),
  name: z.string(),
  project: z.string(),
  entity: z.string(),
  startedAt: z.string().nullable(),
});
export const WorkDataMetaSchema = z.object({
  runs: z.array(WorkDataRunSchema),
  run: WorkDataRunSchema.nullable(),
  generation: z.string(),
  revision: z.number(),
  activityAt: z.string().nullable(),
  caughtUp: z.boolean(),
  error: z.string().nullable(),
  keys: z.array(z.array(z.string())),
  config: z.record(z.string(), z.unknown()),
  summary: z.record(z.string(), z.unknown()),
});
export const WorkDataSeriesSchema = z.object({
  key: z.array(z.string()),
  status: z.enum(["available", "missing", "non_numeric", "empty"]),
  points: z.array(z.tuple([z.number(), z.number()])).optional(),
  sampled: z.boolean().optional(),
  count: z.number(),
  last: z.number().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  mean: z.number().nullable(),
  time: z.number().nullable(),
});
export const WorkDataQueryResultSchema = z.object({
  runId: z.string(),
  generation: z.string(),
  revision: z.number(),
  activityAt: z.string().nullable(),
  caughtUp: z.boolean(),
  ended: z.boolean().nullable(),
  lastStep: z.number().nullable(),
  error: z.string().nullable(),
  series: z.array(WorkDataSeriesSchema),
});
export const WorkArtifactFileSchema = z.object({
  path: z.string(),
  size: z.number(),
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
  href: z.string().nullable(),
});
export const WorkArtifactSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  description: z.string(),
  files: z.array(WorkArtifactFileSchema),
  aliases: z.array(z.string()),
  unavailableReason: z.string().nullable(),
});
export const WorkArtifactsSchema = z.object({ artifacts: z.array(WorkArtifactSchema) });
export type WorkDataQuery = z.infer<typeof WorkDataQuerySchema>;
export type WorkDataMeta = z.infer<typeof WorkDataMetaSchema>;
export type WorkDataQueryResult = z.infer<typeof WorkDataQueryResultSchema>;
export type WorkDataSeries = z.infer<typeof WorkDataSeriesSchema>;
export type WorkArtifact = z.infer<typeof WorkArtifactSchema>;
