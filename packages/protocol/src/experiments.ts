import { z } from "zod";

export const ExperimentHandleSchema = z.string().regex(/^exp_[a-z0-9]+$/);
export const AttemptHandleSchema = z.string().regex(/^att_[a-z0-9]+$/);

export const AgentExperimentTouchSchema = z.object({
  experiment: ExperimentHandleSchema,
  attempt: AttemptHandleSchema.nullable(),
  lastTouchedAt: z.string(),
});

export const ProgressPlanSchema = z.object({
  unit: z.string().min(1),
  total: z.number().positive(),
  segments: z
    .array(
      z.object({
        label: z.string().min(1),
        start: z.number().nonnegative(),
        end: z.number().positive(),
      }),
    )
    .optional(),
});

export const LogProgressSourceSchema = z.object({
  type: z.literal("log"),
  path: z.string().min(1),
  progressRegex: z.string().min(1),
  endRegex: z.string().min(1).optional(),
});

export const CommandProgressParserSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("json") }),
  z.object({ type: z.literal("regex"), regex: z.string().min(1) }),
]);

export const CommandProgressSourceSchema = z.object({
  type: z.literal("command"),
  command: z.array(z.string()).min(1),
  cwd: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  parse: CommandProgressParserSchema,
});

export const ProgressSourceSchema = z.discriminatedUnion("type", [
  LogProgressSourceSchema,
  CommandProgressSourceSchema,
]);

export const ViewerConfigSchema = z.object({
  mounts: z.record(z.string(), z.string()),
  entries: z.record(z.string(), z.string()),
});

export const ProgressObservationSchema = z.object({
  current: z.number(),
  total: z.number().nullable(),
  ended: z.boolean(),
  phase: z.string().nullable(),
  message: z.string().nullable(),
  refreshedAt: z.string(),
});

export const ExperimentAttemptSchema = z.object({
  id: AttemptHandleSchema,
  experiment: ExperimentHandleSchema,
  shortDescription: z.string(),
  purpose: z.string(),
  resultSummary: z.string().nullable(),
  wandbId: z.string().nullable(),
  jobId: z.string().nullable(),
  outputDir: z.string().nullable(),
  progressPlan: ProgressPlanSchema.nullable(),
  progressSource: ProgressSourceSchema.nullable(),
  viewer: ViewerConfigSchema.nullable(),
  blobRelpath: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  progress: ProgressObservationSchema.nullable(),
  progressError: z.string().nullable(),
});

export const ExperimentRecordSchema = z.object({
  id: ExperimentHandleSchema,
  goal: z.string().nullable(),
  shortDescription: z.string(),
  description: z.string(),
  basedOn: ExperimentHandleSchema.nullable(),
  viewerSource: ExperimentHandleSchema.nullable(),
  viewer: ViewerConfigSchema.nullable(),
  conclusion: z.string().nullable(),
  blobRelpath: z.string(),
  closedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ExperimentDetailSchema = z.object({
  experiment: ExperimentRecordSchema,
  attempts: z.array(ExperimentAttemptSchema),
});

export const CreateExperimentInputSchema = z.object({
  shortDescription: z.string().min(1),
  description: z.string().min(1),
  goal: z.string().min(1).nullable().optional(),
  basedOn: ExperimentHandleSchema.nullable().optional(),
  viewerSource: ExperimentHandleSchema.nullable().optional(),
  conclusion: z.string().min(1).nullable().optional(),
});

export const UpdateExperimentInputSchema = z.object({
  experiment: ExperimentHandleSchema,
  shortDescription: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  goal: z.string().min(1).nullable().optional(),
  basedOn: ExperimentHandleSchema.nullable().optional(),
  viewerSource: ExperimentHandleSchema.nullable().optional(),
  conclusion: z.string().min(1).nullable().optional(),
});

export const CreateAttemptInputSchema = z.object({
  experiment: ExperimentHandleSchema,
  shortDescription: z.string().min(1),
  purpose: z.string().min(1),
  resultSummary: z.string().min(1).nullable().optional(),
  wandbId: z.string().min(1).nullable().optional(),
  jobId: z.string().min(1).nullable().optional(),
  outputDir: z.string().min(1).nullable().optional(),
  progressPlan: ProgressPlanSchema.nullable().optional(),
  progressSource: ProgressSourceSchema.nullable().optional(),
});

export const UpdateAttemptInputSchema = z.object({
  attempt: AttemptHandleSchema,
  shortDescription: z.string().min(1).optional(),
  purpose: z.string().min(1).optional(),
  resultSummary: z.string().min(1).nullable().optional(),
  wandbId: z.string().min(1).nullable().optional(),
  jobId: z.string().min(1).nullable().optional(),
  outputDir: z.string().min(1).nullable().optional(),
  progressPlan: ProgressPlanSchema.nullable().optional(),
  progressSource: ProgressSourceSchema.nullable().optional(),
});

export const ExperimentListRequestSchema = z.object({
  type: z.literal("experiment.list.request"),
  requestId: z.string(),
  projectId: z.string(),
  goal: z.string().min(1).optional(),
  includeClosed: z.boolean().optional(),
  includeArchived: z.boolean().optional(),
});

export const ExperimentGetRequestSchema = z.object({
  type: z.literal("experiment.get.request"),
  requestId: z.string(),
  projectId: z.string(),
  experiment: ExperimentHandleSchema,
});

export const ExperimentCreateRequestSchema = CreateExperimentInputSchema.extend({
  type: z.literal("experiment.create.request"),
  requestId: z.string(),
  projectId: z.string(),
  callerAgentId: z.string().optional(),
});

export const ExperimentUpdateRequestSchema = UpdateExperimentInputSchema.extend({
  type: z.literal("experiment.update.request"),
  requestId: z.string(),
  projectId: z.string(),
  callerAgentId: z.string().optional(),
});

export const ExperimentAttemptCreateRequestSchema = CreateAttemptInputSchema.extend({
  type: z.literal("experiment.attempt.create.request"),
  requestId: z.string(),
  projectId: z.string(),
  callerAgentId: z.string().optional(),
});

export const ExperimentAttemptUpdateRequestSchema = UpdateAttemptInputSchema.extend({
  type: z.literal("experiment.attempt.update.request"),
  requestId: z.string(),
  projectId: z.string(),
  callerAgentId: z.string().optional(),
});

export const ExperimentProgressRefreshRequestSchema = z.object({
  type: z.literal("experiment.attempt.progress.refresh.request"),
  requestId: z.string(),
  projectId: z.string(),
  attempt: AttemptHandleSchema,
});

export const ExperimentStorageResolveRequestSchema = z.object({
  type: z.literal("experiment.storage.resolve.request"),
  requestId: z.string(),
  projectId: z.string(),
  scope: z.enum(["shared", "experiment", "attempt"]),
  experiment: ExperimentHandleSchema.optional(),
  attempt: AttemptHandleSchema.optional(),
});

const ViewerTargetSchema = z.union([
  z.object({ experiment: ExperimentHandleSchema }),
  z.object({ attempt: AttemptHandleSchema }),
]);

export const ExperimentViewerConfigureRequestSchema = z.object({
  type: z.literal("experiment.viewer.configure.request"),
  requestId: z.string(),
  projectId: z.string(),
  target: ViewerTargetSchema,
  viewer: ViewerConfigSchema.nullable(),
});

export const ExperimentViewerResolveRequestSchema = z.object({
  type: z.literal("experiment.viewer.resolve.request"),
  requestId: z.string(),
  projectId: z.string(),
  target: ViewerTargetSchema,
});

export const ResolvedViewerEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  url: z.string(),
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
});

export const ExperimentListResponseSchema = z.object({
  type: z.literal("experiment.list.response"),
  payload: z.object({ requestId: z.string(), experiments: z.array(ExperimentRecordSchema) }),
});

export const ExperimentGetResponseSchema = z.object({
  type: z.literal("experiment.get.response"),
  payload: z.object({ requestId: z.string(), detail: ExperimentDetailSchema }),
});

export const ExperimentCreateResponseSchema = z.object({
  type: z.literal("experiment.create.response"),
  payload: z.object({ requestId: z.string(), experiment: ExperimentRecordSchema }),
});

export const ExperimentUpdateResponseSchema = z.object({
  type: z.literal("experiment.update.response"),
  payload: z.object({ requestId: z.string(), experiment: ExperimentRecordSchema }),
});

export const ExperimentAttemptCreateResponseSchema = z.object({
  type: z.literal("experiment.attempt.create.response"),
  payload: z.object({ requestId: z.string(), attempt: ExperimentAttemptSchema }),
});

export const ExperimentAttemptUpdateResponseSchema = z.object({
  type: z.literal("experiment.attempt.update.response"),
  payload: z.object({ requestId: z.string(), attempt: ExperimentAttemptSchema }),
});

export const ExperimentProgressRefreshResponseSchema = z.object({
  type: z.literal("experiment.attempt.progress.refresh.response"),
  payload: z.object({
    requestId: z.string(),
    observation: ProgressObservationSchema.nullable(),
    error: z.string().nullable(),
    nextRefreshAfterMs: z.number().int().positive().nullable(),
  }),
});

export const ExperimentStorageResolveResponseSchema = z.object({
  type: z.literal("experiment.storage.resolve.response"),
  payload: z.object({ requestId: z.string(), path: z.string() }),
});

export const ExperimentViewerConfigureResponseSchema = z.object({
  type: z.literal("experiment.viewer.configure.response"),
  payload: z.object({ requestId: z.string(), viewer: ViewerConfigSchema.nullable() }),
});

export const ExperimentViewerResolveResponseSchema = z.object({
  type: z.literal("experiment.viewer.resolve.response"),
  payload: z.object({ requestId: z.string(), entries: z.array(ResolvedViewerEntrySchema) }),
});

export type ProgressPlan = z.infer<typeof ProgressPlanSchema>;
export type AgentExperimentTouch = z.infer<typeof AgentExperimentTouchSchema>;
export type ProgressSource = z.infer<typeof ProgressSourceSchema>;
export type ProgressObservation = z.infer<typeof ProgressObservationSchema>;
export type ViewerConfig = z.infer<typeof ViewerConfigSchema>;
export type ResolvedViewerEntry = z.infer<typeof ResolvedViewerEntrySchema>;
export type ExperimentRecord = z.infer<typeof ExperimentRecordSchema>;
export type ExperimentAttempt = z.infer<typeof ExperimentAttemptSchema>;
export type ExperimentDetail = z.infer<typeof ExperimentDetailSchema>;
export type CreateExperimentInput = z.infer<typeof CreateExperimentInputSchema>;
export type UpdateExperimentInput = z.infer<typeof UpdateExperimentInputSchema>;
export type CreateAttemptInput = z.infer<typeof CreateAttemptInputSchema>;
export type UpdateAttemptInput = z.infer<typeof UpdateAttemptInputSchema>;
