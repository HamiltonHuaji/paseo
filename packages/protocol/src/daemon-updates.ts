import { z } from "zod";

export const DAEMON_UPDATE_CHUNK_BYTES = 256 * 1024;
export const DAEMON_UPDATE_CHUNK_BASE64 = 4 * Math.ceil(DAEMON_UPDATE_CHUNK_BYTES / 3);

export const DaemonUpdatePackageSchema = z.object({
  version: z.string().min(1),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type DaemonUpdatePackage = z.infer<typeof DaemonUpdatePackageSchema>;

export interface DaemonPackageDownload {
  status: "downloading" | "ready" | "failed" | "cancelled";
  receivedBytes: number;
  package: DaemonUpdatePackage | null;
  error: string | null;
}

export const DaemonUpdateJobSchema = z.object({
  id: z.string(),
  status: z.enum(["running", "cancelling", "cancelled", "failed", "complete"]),
  phase: z.enum(["starting", "downloading", "uploading", "verifying", "installing", "complete"]),
  startedAt: z.number(),
  updatedAt: z.number(),
  output: z.string(),
  error: z.string().nullable(),
  package: DaemonUpdatePackageSchema.nullable(),
  receivedBytes: z.number(),
});
export type DaemonUpdateJob = z.infer<typeof DaemonUpdateJobSchema>;

export const DaemonUpdateStatusRequestSchema = z.object({
  type: z.literal("daemon.update.status.request"),
  requestId: z.string(),
});
export const DaemonUpdateCancelRequestSchema = z.object({
  type: z.literal("daemon.update.cancel.request"),
  requestId: z.string(),
  jobId: z.string(),
});
export const DaemonUpdateTransferRequestSchema = z.object({
  type: z.literal("daemon.update.transfer.request"),
  requestId: z.string(),
  transfer: z.discriminatedUnion("action", [
    z.object({ action: z.literal("begin"), package: DaemonUpdatePackageSchema }),
    z.object({
      action: z.literal("chunk"),
      jobId: z.string(),
      offset: z.number().int().nonnegative(),
      data: z.string().min(4).max(DAEMON_UPDATE_CHUNK_BASE64),
    }),
  ]),
});
export type DaemonUpdateTransfer = z.infer<typeof DaemonUpdateTransferRequestSchema>["transfer"];

export const DaemonUpdateStatusResponseSchema = z.object({
  type: z.literal("daemon.update.status.response"),
  payload: z.object({ requestId: z.string(), job: DaemonUpdateJobSchema.nullable() }),
});
export const DaemonUpdateCancelResponseSchema = z.object({
  type: z.literal("daemon.update.cancel.response"),
  payload: z.object({ requestId: z.string(), job: DaemonUpdateJobSchema.nullable() }),
});
export const DaemonUpdateTransferResponseSchema = z.object({
  type: z.literal("daemon.update.transfer.response"),
  payload: z.object({ requestId: z.string(), job: DaemonUpdateJobSchema }),
});
