import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// A cursor only belongs to this daemon and this exact listing context. Restarting
// or changing a provider home requires a refresh, never a silent page-one replay.
const cursorKey = randomBytes(32);
const envelopeSchema = z.object({ context: z.string(), state: z.unknown() });
const MAX_CURSOR_BYTES = 1_048_576;

export function encodeImportSessionCursor(context: string, state: unknown): string {
  const body = Buffer.from(JSON.stringify({ context, state })).toString("base64url");
  if (body.length > MAX_CURSOR_BYTES) throw new Error("Session listing cursor is too large");
  const signature = createHmac("sha256", cursorKey).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function decodeImportSessionCursor<T>(
  cursor: string,
  context: string,
  schema: z.ZodType<T>,
): T {
  try {
    if (cursor.length > MAX_CURSOR_BYTES + 44) throw new Error("Oversized cursor");
    const [body, signature, extra] = cursor.split(".");
    if (!body || !signature || extra !== undefined) throw new Error("Invalid cursor");
    const expected = createHmac("sha256", cursorKey).update(body).digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error("Invalid signature");
    }
    const envelope = envelopeSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString()));
    if (envelope.context !== context) throw new Error("Different listing context");
    return schema.parse(envelope.state);
  } catch {
    throw new Error("Session listing cursor is invalid or expired. Refresh the session list.");
  }
}
