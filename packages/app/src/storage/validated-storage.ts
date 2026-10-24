import { z } from "zod";
import { mergeStoredEdits, parseStoredValue } from "./persisted-value";

export interface ValidatedStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}

/** Read-modify-write the one saved document; a failed read never becomes defaults. */
export async function writeValidatedJson<Value>(
  storage: ValidatedStorage & { setItem(key: string, value: string): Promise<void> },
  key: string,
  schema: z.ZodType<Value>,
  next: Value,
): Promise<void> {
  const value = schema.parse(next);
  const text = await storage.getItem(key);
  if (text === null) {
    await storage.setItem(key, JSON.stringify(value));
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Cannot write saved ${key}: invalid JSON; original data was retained`);
  }
  const before = parseStoredValue(schema, raw, key);
  await storage.setItem(key, JSON.stringify(mergeStoredEdits(raw, before, value)));
}

export async function readValidatedString<Value>(
  storage: ValidatedStorage,
  key: string,
  schema: z.ZodType<Value>,
): Promise<Value | null> {
  const raw = await storage.getItem(key);
  if (raw === null) return null;
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throw new Error(`Cannot read saved ${key}; original data was retained`);
}

export async function readValidatedJson<Value>(
  storage: ValidatedStorage,
  key: string,
  schema: z.ZodType<Value>,
): Promise<Value | null> {
  const raw = await storage.getItem(key);
  if (raw === null) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error(`Cannot read saved ${key}: invalid JSON; original data was retained`);
  }
  return parseStoredValue(schema, decoded, key);
}
