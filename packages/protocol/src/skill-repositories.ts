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
