import { z } from "zod";
import { ProgressPlanSetSchema } from "./experiments.js";

export const WorkCardIdSchema = z.string().regex(/^card_[a-f0-9]{8}$/);
export const WorkItemIdSchema = z.string().regex(/^item_[a-f0-9]{8}$/);
export const WorkObjectIdSchema = z.string().regex(/^(card|item)_[a-f0-9]{8}$/);
export const WorkSourceRefSchema = z.object({ objectId: z.string(), source: z.string().min(1) });
export const WorkSessionsSchema = z.object({ agentIds: z.array(z.string()) });
export const WorkResultSchema = z.object({
  text: z.string().optional(),
  completed: z.boolean().optional(),
});
export const WorkConfigSchema = z.record(z.string(), z.unknown());
export const WorkLocalSourceSchema = z.object({
  type: z.literal("wandb-local"),
  paths: z.array(z.string()).min(1),
  runId: z.string().optional(),
});
export const WorkViewersSchema = z.object({
  mounts: z.record(z.string(), z.string()).optional(),
  sources: z.record(z.string(), WorkLocalSourceSchema).optional(),
  entries: z.record(z.string(), z.string()).optional(),
});
export const WorkProgressSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("log"),
    path: z.string(),
    progressRegex: z.string(),
    endRegex: z.string().optional(),
  }),
  z.object({
    type: z.literal("command"),
    argv: z.array(z.string()).min(1),
    cwd: z.string().optional(),
    timeoutMs: z.number().positive().optional(),
    parse: z.discriminatedUnion("type", [
      z.object({ type: z.literal("json") }),
      z.object({ type: z.literal("regex"), regex: z.string() }),
    ]),
  }),
  z.object({
    type: z.literal("viewer-source"),
    source: WorkSourceRefSchema,
    current: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("step") }),
      z.object({ kind: z.literal("metric"), key: z.array(z.string()).min(1) }),
    ]),
    total: z.union([z.number(), z.object({ key: z.array(z.string()).min(1) })]).optional(),
  }),
]);
export const WorkProgressSchema = z.object({
  plan: ProgressPlanSetSchema.optional(),
  source: WorkProgressSourceSchema.optional(),
});
export const WorkMetricAxisSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("step") }),
  z.object({ kind: z.literal("time") }),
  z.object({ kind: z.literal("metric"), key: z.array(z.string()).min(1) }),
]);
export const WorkMetricRangeSchema = z.object({
  from: z.number().optional(),
  to: z.number().optional(),
});
export const WorkMetricsSchema = z.object({
  panels: z.array(
    z.object({
      id: z.string(),
      title: z.string().optional(),
      source: WorkSourceRefSchema,
      display: z.enum(["line", "value"]),
      series: z.array(z.object({ key: z.array(z.string()).min(1), label: z.string().optional() })),
      x: WorkMetricAxisSchema.optional(),
      range: WorkMetricRangeSchema.optional(),
      scale: z.enum(["linear", "log"]).optional(),
      statistic: z.enum(["last", "min", "max", "mean"]).optional(),
    }),
  ),
});
export const WorkComponentsSchema = z.object({
  sessions: WorkSessionsSchema.nullable(),
  viewers: WorkViewersSchema.nullable(),
  progress: WorkProgressSchema.nullable(),
  metrics: WorkMetricsSchema.nullable(),
  result: WorkResultSchema.nullable(),
  config: WorkConfigSchema.nullable(),
});
export const WorkTouchSchema = z.object({ agentId: z.string(), lastTouchedAt: z.string() });
export const WorkObservationSchema = z.object({
  current: z.number(),
  total: z.number().nullable(),
  ended: z.boolean(),
  phase: z.string().nullable(),
  message: z.string().nullable(),
  observedAt: z.string(),
});
export const WorkProgressStateSchema = z.object({
  observation: WorkObservationSchema.nullable(),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
  catchingUp: z.boolean(),
});
const WorkBaseSchema = WorkComponentsSchema.extend({
  id: WorkObjectIdSchema,
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  touches: z.array(WorkTouchSchema),
  storageRelpath: z.string(),
  progressState: WorkProgressStateSchema,
});
export const WorkCardSchema = WorkBaseSchema.extend({
  kind: z.literal("card"),
  id: WorkCardIdSchema,
  label: z.enum(["experiment", "topic"]),
  goal: z.string().nullable(),
  basedOn: WorkCardIdSchema.nullable(),
  viewerSource: WorkCardIdSchema.nullable(),
});
export const WorkItemSchema = WorkBaseSchema.extend({
  kind: z.literal("item"),
  id: WorkItemIdSchema,
  label: z.enum(["attempt", "issue"]),
  parentCardId: WorkCardIdSchema,
});
export const WorkObjectSchema = z.discriminatedUnion("kind", [WorkCardSchema, WorkItemSchema]);
export const WorkStorageSchema = z.object({ path: z.string(), sharedPath: z.string() });
export const WorkViewerEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
});
export const WorkViewerSourceEntrySchema = z.object({
  source: WorkSourceRefSchema,
  apiPath: z.string(),
  available: z.boolean(),
  unavailableReason: z.string().nullable(),
});
export const WorkResolvedViewersSchema = z.object({
  configured: WorkViewersSchema.nullable(),
  resolved: WorkViewersSchema.nullable(),
  inheritedFrom: WorkObjectIdSchema.nullable(),
});
export const WorkViewerEntriesSchema = z.object({
  entries: z.array(WorkViewerEntrySchema),
  sources: z.array(WorkViewerSourceEntrySchema),
  inheritedFrom: WorkObjectIdSchema.nullable(),
});
export const WorkComponentNameSchema = z.enum([
  "sessions",
  "viewers",
  "progress",
  "metrics",
  "result",
  "config",
]);
export const WorkSelectSchema = z.array(
  z.enum([
    "timestamps",
    "touches",
    "sessions",
    "viewers",
    "progress",
    "metrics",
    "result",
    "config",
    "storage",
    "viewerEntries",
  ]),
);
const WorkProjectionSchema = WorkBaseSchema.omit({
  viewers: true,
  progress: true,
  storageRelpath: true,
  progressState: true,
})
  .partial()
  .extend({
    id: WorkObjectIdSchema,
    title: z.string(),
    body: z.string(),
    componentNames: z.array(WorkComponentNameSchema).optional(),
    viewers: WorkResolvedViewersSchema.optional(),
    progress: z
      .object({ configured: WorkProgressSchema, state: WorkProgressStateSchema })
      .nullable()
      .optional(),
    storage: WorkStorageSchema.optional(),
    viewerEntries: WorkViewerEntriesSchema.optional(),
    sessionRelations: z.array(z.enum(["linked", "touched"])).optional(),
  });
export const WorkViewSchema = z.discriminatedUnion("kind", [
  WorkProjectionSchema.extend({
    kind: z.literal("card"),
    label: z.enum(["experiment", "topic"]),
    goal: z.string().nullable(),
    basedOn: WorkCardIdSchema.nullable(),
    viewerSource: WorkCardIdSchema.nullable().optional(),
  }),
  WorkProjectionSchema.extend({
    kind: z.literal("item"),
    label: z.enum(["attempt", "issue"]),
    parentCardId: WorkCardIdSchema,
  }),
]);
export const WorkListOptionsSchema = z.object({
  query: z.string().optional(),
  sessionId: z.string().optional(),
  sessionRelation: z.enum(["linked", "touched", "any"]).optional(),
  archive: z.enum(["active", "archived", "all"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().optional(),
});
export const WorkListCardsSchema = WorkListOptionsSchema.extend({
  goal: z.string().optional(),
  basedOn: WorkCardIdSchema.optional(),
  label: z.enum(["experiment", "topic"]).optional(),
});
export const WorkListItemsSchema = WorkListOptionsSchema.extend({
  parentCardId: WorkCardIdSchema,
  label: z.enum(["attempt", "issue"]).optional(),
});
export const WorkGetCardSchema = z.object({
  cardId: WorkCardIdSchema,
  select: WorkSelectSchema.optional(),
  includeItems: WorkListItemsSchema.omit({ parentCardId: true }).optional(),
});
export const WorkGetItemSchema = z.object({
  itemId: WorkItemIdSchema,
  select: WorkSelectSchema.optional(),
});
const WorkCreateBaseSchema = WorkComponentsSchema.partial().extend({
  title: z.string().regex(/\S/),
  body: z.string().regex(/\S/),
  startedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional(),
  linkCaller: z.boolean().optional(),
  returning: WorkSelectSchema.optional(),
});
export const WorkCreateItemSchema = WorkCreateBaseSchema.extend({
  parentCardId: WorkCardIdSchema,
  preset: z.enum(["attempt", "issue"]),
});
export const WorkCreateCardSchema = WorkCreateBaseSchema.extend({
  preset: z.enum(["experiment", "topic"]),
  goal: z.string().nullable().optional(),
  basedOn: WorkCardIdSchema.nullable().optional(),
  viewerSource: WorkCardIdSchema.nullable().optional(),
  items: z.array(WorkCreateItemSchema.omit({ parentCardId: true })).optional(),
});
const WorkUpdateBaseSchema = WorkCreateBaseSchema.partial().extend({
  sessions: z
    .object({ add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() })
    .nullable()
    .optional(),
  viewers: z
    .object({
      mounts: z.record(z.string(), z.string().nullable()).optional(),
      sources: z.record(z.string(), WorkLocalSourceSchema.nullable()).optional(),
      entries: z.record(z.string(), z.string().nullable()).optional(),
    })
    .nullable()
    .optional(),
  archived: z.boolean().optional(),
});
export const WorkUpdateCardSchema = WorkUpdateBaseSchema.extend({
  cardId: WorkCardIdSchema,
  label: z.enum(["experiment", "topic"]).optional(),
  goal: z.string().nullable().optional(),
  basedOn: WorkCardIdSchema.nullable().optional(),
  viewerSource: WorkCardIdSchema.nullable().optional(),
});
export const WorkUpdateItemSchema = WorkUpdateBaseSchema.extend({
  itemId: WorkItemIdSchema,
  label: z.enum(["attempt", "issue"]).optional(),
});
export const WorkListResultSchema = z.object({
  objects: z.array(WorkViewSchema),
  nextCursor: z.string().nullable(),
});
export const WorkObjectResultSchema = z.object({
  object: WorkViewSchema,
  committed: z.boolean().optional(),
  items: z.array(WorkViewSchema).optional(),
  nextItemCursor: z.string().nullable().optional(),
  storageError: z.string().optional(),
});
export const WorkPlacementSchema = z.object({
  cardId: WorkCardIdSchema,
  column: z.number().int().nullable(),
  row: z.number().int().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
export const WorkBoardSchema = z.object({
  cards: z.array(WorkCardSchema),
  itemCounts: z.record(z.string(), z.number()),
  goals: z.array(z.string()),
  placements: z.array(WorkPlacementSchema),
});

const RequestContextSchema = z.object({
  requestId: z.string(),
  projectId: z.string(),
  callerAgentId: z.string().optional(),
});
export const WorkCardListRequestSchema = WorkListCardsSchema.extend({
  ...RequestContextSchema.shape,
  type: z.literal("work.card.list.request"),
});
export const WorkCardGetRequestSchema = WorkGetCardSchema.extend({
  ...RequestContextSchema.shape,
  type: z.literal("work.card.get.request"),
  allItems: z.boolean().optional(),
});
export const WorkCardCreateRequestSchema = WorkCreateCardSchema.extend({
  ...RequestContextSchema.shape,
  type: z.literal("work.card.create.request"),
});
export const WorkCardUpdateRequestSchema = WorkUpdateCardSchema.extend({
  ...RequestContextSchema.shape,
  type: z.literal("work.card.update.request"),
});
export const WorkItemListRequestSchema = WorkListItemsSchema.extend({
  ...RequestContextSchema.shape,
  type: z.literal("work.item.list.request"),
});
export const WorkItemGetRequestSchema = WorkGetItemSchema.extend({
  ...RequestContextSchema.shape,
  type: z.literal("work.item.get.request"),
});
export const WorkItemCreateRequestSchema = WorkCreateItemSchema.extend({
  ...RequestContextSchema.shape,
  type: z.literal("work.item.create.request"),
});
export const WorkItemUpdateRequestSchema = WorkUpdateItemSchema.extend({
  ...RequestContextSchema.shape,
  type: z.literal("work.item.update.request"),
});
export const WorkBoardGetRequestSchema = RequestContextSchema.extend({
  type: z.literal("work.board.get.request"),
  archive: z.enum(["active", "archived", "all"]).optional(),
});
export const WorkBoardUpdateRequestSchema = RequestContextSchema.extend({
  type: z.literal("work.board.update.request"),
  placements: z.array(WorkPlacementSchema),
});
export const WorkProgressRefreshRequestSchema = RequestContextSchema.extend({
  type: z.literal("work.progress.refresh.request"),
  objectIds: z.array(WorkObjectIdSchema),
});
export const WorkStorageGetRequestSchema = RequestContextSchema.extend({
  type: z.literal("work.storage.get.request"),
  objectId: WorkObjectIdSchema.optional(),
});
export const WorkViewersResolveRequestSchema = RequestContextSchema.extend({
  type: z.literal("work.viewers.resolve.request"),
  objectId: WorkObjectIdSchema,
});
export const WorkSubscribeRequestSchema = RequestContextSchema.extend({
  type: z.literal("work.project.subscribe.request"),
});

const ResultPayloadSchema = WorkObjectResultSchema.extend({ requestId: z.string() });
const ListPayloadSchema = WorkListResultSchema.extend({ requestId: z.string() });
export const WorkCardListResponseSchema = z.object({
  type: z.literal("work.card.list.response"),
  payload: ListPayloadSchema,
});
export const WorkCardGetResponseSchema = z.object({
  type: z.literal("work.card.get.response"),
  payload: ResultPayloadSchema,
});
export const WorkCardCreateResponseSchema = z.object({
  type: z.literal("work.card.create.response"),
  payload: ResultPayloadSchema,
});
export const WorkCardUpdateResponseSchema = z.object({
  type: z.literal("work.card.update.response"),
  payload: ResultPayloadSchema,
});
export const WorkItemListResponseSchema = z.object({
  type: z.literal("work.item.list.response"),
  payload: ListPayloadSchema,
});
export const WorkItemGetResponseSchema = z.object({
  type: z.literal("work.item.get.response"),
  payload: ResultPayloadSchema,
});
export const WorkItemCreateResponseSchema = z.object({
  type: z.literal("work.item.create.response"),
  payload: ResultPayloadSchema,
});
export const WorkItemUpdateResponseSchema = z.object({
  type: z.literal("work.item.update.response"),
  payload: ResultPayloadSchema,
});
export const WorkBoardGetResponseSchema = z.object({
  type: z.literal("work.board.get.response"),
  payload: WorkBoardSchema.extend({ requestId: z.string() }),
});
export const WorkBoardUpdateResponseSchema = z.object({
  type: z.literal("work.board.update.response"),
  payload: z.object({ requestId: z.string(), placements: z.array(WorkPlacementSchema) }),
});
export const WorkProgressRefreshResultSchema = WorkProgressStateSchema.extend({
  objectId: WorkObjectIdSchema,
  nextRefreshAfterMs: z.number().nullable(),
});
export const WorkProgressRefreshResponseSchema = z.object({
  type: z.literal("work.progress.refresh.response"),
  payload: z.object({ requestId: z.string(), results: z.array(WorkProgressRefreshResultSchema) }),
});
export const WorkStorageGetResponseSchema = z.object({
  type: z.literal("work.storage.get.response"),
  payload: z.object({ requestId: z.string(), storage: WorkStorageSchema }),
});
export const WorkViewersResolveResponseSchema = z.object({
  type: z.literal("work.viewers.resolve.response"),
  payload: WorkViewerEntriesSchema.extend({ requestId: z.string() }),
});
export const WorkUnsubscribeRequestSchema = RequestContextSchema.extend({
  type: z.literal("work.project.unsubscribe.request"),
});
export const WorkUnsubscribeResponseSchema = z.object({
  type: z.literal("work.project.unsubscribe.response"),
  payload: z.object({ requestId: z.string(), projectId: z.string() }),
});
export const WorkSubscribeResponseSchema = z.object({
  type: z.literal("work.project.subscribe.response"),
  payload: z.object({ requestId: z.string(), projectId: z.string(), subscriptionId: z.string() }),
});
export const WorkProjectChangedSchema = z.object({
  type: z.literal("work.project.changed"),
  payload: z.object({
    subscriptionId: z.string().optional(),
    projectId: z.string(),
    objectIds: z.array(WorkObjectIdSchema),
    fields: z.array(z.string()),
  }),
});

export type WorkObject = z.infer<typeof WorkObjectSchema>;
export type WorkCard = z.infer<typeof WorkCardSchema>;
export type WorkItem = z.infer<typeof WorkItemSchema>;
export type WorkView = z.infer<typeof WorkViewSchema>;
export type WorkComponents = z.infer<typeof WorkComponentsSchema>;
export type WorkViewers = z.infer<typeof WorkViewersSchema>;
export type WorkSourceRef = z.infer<typeof WorkSourceRefSchema>;
export type WorkLocalSource = z.infer<typeof WorkLocalSourceSchema>;
export type WorkProgress = z.infer<typeof WorkProgressSchema>;
export type WorkProgressSource = z.infer<typeof WorkProgressSourceSchema>;
export type WorkProgressState = z.infer<typeof WorkProgressStateSchema>;
export type WorkObservation = z.infer<typeof WorkObservationSchema>;
export type WorkMetrics = z.infer<typeof WorkMetricsSchema>;
export type WorkSelect = z.infer<typeof WorkSelectSchema>;
export type WorkListCards = z.infer<typeof WorkListCardsSchema>;
export type WorkListItems = z.infer<typeof WorkListItemsSchema>;
export type WorkCreateCard = z.infer<typeof WorkCreateCardSchema>;
export type WorkCreateItem = z.infer<typeof WorkCreateItemSchema>;
export type WorkUpdateCard = z.infer<typeof WorkUpdateCardSchema>;
export type WorkUpdateItem = z.infer<typeof WorkUpdateItemSchema>;
export type WorkListResult = z.infer<typeof WorkListResultSchema>;
export type WorkObjectResult = z.infer<typeof WorkObjectResultSchema>;
export type WorkPlacement = z.infer<typeof WorkPlacementSchema>;
export type WorkBoard = z.infer<typeof WorkBoardSchema>;
export type WorkViewerEntries = z.infer<typeof WorkViewerEntriesSchema>;
export type WorkResolvedViewers = z.infer<typeof WorkResolvedViewersSchema>;
export type WorkStorage = z.infer<typeof WorkStorageSchema>;
export type WorkProgressRefreshResult = z.infer<typeof WorkProgressRefreshResultSchema>;
