import { z } from "zod";

export const SkillRepositorySubscriptionSchema = z.object({
  repositoryId: z.string().min(1),
  label: z.string().min(1),
  remoteUrl: z.string().min(1),
  branch: z.string().min(1),
  autoReceive: z.enum(["overwrite", "fastforward", "none"]),
  agentPublishAllowed: z.boolean(),
});

export type SkillRepositorySubscription = z.infer<typeof SkillRepositorySubscriptionSchema>;

export const SkillRepositoryUpsertRequestSchema = z.object({
  type: z.literal("skills.repository.upsert.request"),
  requestId: z.string(),
  subscription: SkillRepositorySubscriptionSchema,
});
export const SkillRepositoryUpsertResponseSchema = z.object({
  type: z.literal("skills.repository.upsert.response"),
  payload: z.object({
    requestId: z.string(),
    subscription: SkillRepositorySubscriptionSchema,
    error: z.string().optional(),
  }),
});

export const SkillRepositoryListRequestSchema = z.object({
  type: z.literal("skills.repository.list.request"),
  requestId: z.string(),
});
export const SkillRepositoryListResponseSchema = z.object({
  type: z.literal("skills.repository.list.response"),
  payload: z.object({
    requestId: z.string(),
    subscriptions: z.array(SkillRepositorySubscriptionSchema),
  }),
});

export const SkillRepositoryRemoveRequestSchema = z.object({
  type: z.literal("skills.repository.remove.request"),
  requestId: z.string(),
  repositoryId: z.string().min(1),
});
export const SkillRepositoryRemoveResponseSchema = z.object({
  type: z.literal("skills.repository.remove.response"),
  payload: z.object({
    requestId: z.string(),
    repositoryId: z.string(),
    error: z.string().optional(),
  }),
});

export const SkillRepositoryExecutorRegisterRequestSchema = z.object({
  type: z.literal("skills.repository.executor.register.request"),
  requestId: z.string(),
  repositories: z.array(
    z.object({
      repositoryId: z.string().min(1),
      remoteUrl: z.string().min(1),
      branch: z.string().min(1),
      read: z.boolean(),
      publish: z.boolean(),
    }),
  ),
});
export const SkillRepositoryExecutorRegisterResponseSchema = z.object({
  type: z.literal("skills.repository.executor.register.response"),
  payload: z.object({ requestId: z.string(), subscriptionId: z.string() }),
});

export const SkillRepositoryExecutorRefreshRequestSchema = z.object({
  type: z.literal("skills.repository.executor.refresh.request"),
  requestId: z.string(),
});
export const SkillRepositoryExecutorRefreshResponseSchema = z.object({
  type: z.literal("skills.repository.executor.refresh.response"),
  payload: z.object({ requestId: z.string() }),
});

export const SkillRepositoryExecutorJobRequestSchema = z.object({
  type: z.literal("skills.repository.executor.job.request"),
  requestId: z.string(),
  repositoryId: z.string(),
  operation: z.enum(["fetch", "publish"]),
  bundleBase64: z.string().optional(),
  expectedHead: z.string().optional(),
});
export const SkillRepositoryExecutorJobResponseSchema = z.object({
  type: z.literal("skills.repository.executor.job.response"),
  payload: z.object({
    requestId: z.string(),
    repositoryId: z.string(),
    state: z.enum(["ok", "unavailable", "conflict", "failed"]),
    bundleBase64: z.string().optional(),
    remoteHead: z.string().optional(),
    publishedHead: z.string().optional(),
    error: z.string().optional(),
  }),
});

export type SkillRepositoryExecutorJobRequest = z.infer<
  typeof SkillRepositoryExecutorJobRequestSchema
>;
export type SkillRepositoryExecutorJobResponse = z.infer<
  typeof SkillRepositoryExecutorJobResponseSchema
>;

export const SkillRepositoryStatusSchema = z.object({
  repositoryId: z.string(),
  checkoutPath: z.string(),
  branch: z.string(),
  localHead: z.string().nullable(),
  remoteHead: z.string().nullable(),
  remoteTrackingRef: z.string().nullable(),
  remoteCheckedAt: z.string().nullable(),
  worktree: z.enum(["clean", "dirty", "conflicted"]),
  ahead: z.number().nullable(),
  behind: z.number().nullable(),
  publication: z.enum(["none", "pending", "published", "blocked"]),
  syncError: z.string().nullable(),
});
export type SkillRepositoryStatus = z.infer<typeof SkillRepositoryStatusSchema>;

export const SkillRepositoryGetStateRequestSchema = z.object({
  type: z.literal("skills.repository.get_state.request"),
  requestId: z.string(),
});
export const SkillRepositoryGetStateResponseSchema = z.object({
  type: z.literal("skills.repository.get_state.response"),
  payload: z.object({
    requestId: z.string(),
    repositories: z.array(
      z.object({
        subscription: SkillRepositorySubscriptionSchema,
        status: SkillRepositoryStatusSchema.nullable(),
        error: z.string().nullable(),
        busy: z.boolean(),
        canRead: z.boolean(),
        canPublish: z.boolean(),
      }),
    ),
  }),
});
export type SkillRepositoryState = z.infer<
  typeof SkillRepositoryGetStateResponseSchema
>["payload"]["repositories"][number];

// Compare the configuration the user saw before replacing it. A different
// client's changes must be surfaced, including deletion, rather than replayed over.
export const SkillRepositoryConfigureRequestSchema = z.object({
  type: z.literal("skills.repository.configure.request"),
  requestId: z.string(),
  repositoryId: z.string(),
  expected: SkillRepositorySubscriptionSchema.nullable(),
  subscription: SkillRepositorySubscriptionSchema.nullable(),
});
export const SkillRepositoryConfigureResponseSchema = z.object({
  type: z.literal("skills.repository.configure.response"),
  payload: z.object({ requestId: z.string(), error: z.string().optional() }),
});
export const SkillRepositorySyncRequestSchema = z.object({
  type: z.literal("skills.repository.sync.request"),
  requestId: z.string(),
  repositoryId: z.string(),
  expected: SkillRepositorySubscriptionSchema,
});
export const SkillRepositorySyncResponseSchema = z.object({
  type: z.literal("skills.repository.sync.response"),
  payload: z.object({
    requestId: z.string(),
    state: z.enum(["updated", "fetched", "unavailable", "needs_resolution", "failed"]),
    error: z.string().optional(),
  }),
});
