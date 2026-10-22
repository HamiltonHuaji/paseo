import { z } from "zod";

export const TunnelTargetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tcp"),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  }),
  z.object({ type: z.literal("service"), name: z.string().min(1) }),
]);

export const TunnelOpenRequestSchema = z.object({
  type: z.literal("tunnel.open.request"),
  requestId: z.string(),
  target: TunnelTargetSchema,
});

export const TunnelOpenResponseSchema = z.object({
  type: z.literal("tunnel.open.response"),
  payload: z.object({ requestId: z.string(), tunnelId: z.string() }),
});

export type TunnelTarget = z.infer<typeof TunnelTargetSchema>;
