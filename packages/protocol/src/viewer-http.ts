import { z } from "zod";

export const ViewerHttpFetchRequestSchema = z.object({
  type: z.literal("viewer.http.fetch.request"),
  requestId: z.string(),
  method: z.enum(["GET", "HEAD"]),
  path: z.string().min(1).max(8192),
  headers: z.record(z.string(), z.string()),
});

export const ViewerHttpFetchResponseSchema = z.object({
  type: z.literal("viewer.http.fetch.response"),
  payload: z.object({
    requestId: z.string(),
    status: z.number().int().min(100).max(599),
    headers: z.record(z.string(), z.string()),
  }),
});
