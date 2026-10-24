import type { AttachmentMetadata, UserComposerAttachment } from "@/attachments/types";
import { isLegacyNewWorkspaceDraftKey, NEW_WORKSPACE_DRAFT_KEY } from "@/stores/draft-keys";
import { z } from "zod";
import equal from "fast-deep-equal/es6";
import { isStoredObject, parseStoredValue } from "@/storage/persisted-value";
import {
  AttachmentMetadataSchema,
  LegacyDraftImageSchema,
  normalizeAttachmentMetadata,
  normalizeComposerAttachment,
  UserComposerAttachmentSchema,
  type CanonicalDraftInput,
  type DraftLifecycleState,
  type DraftRecord,
  type DraftStoreState,
  type PersistedDraftImage,
} from "./state";

const LegacyPullRequestItemSchema = z.strictObject({
  kind: z.literal("pr"),
  forge: z.string().optional(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.string()),
  projectPath: z.string().optional(),
  baseRefName: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
});
const LegacyGithubPrAttachmentSchema = z.strictObject({
  kind: z.literal("github_pr"),
  item: LegacyPullRequestItemSchema,
  owner: z.literal("new-workspace-picker").optional(),
});
const LegacyReviewAttachmentContextLineSchema = z.strictObject({
  oldLineNumber: z.number().int().positive().nullable(),
  newLineNumber: z.number().int().positive().nullable(),
  type: z.enum(["add", "remove", "context"]),
  content: z.string(),
});
const LegacyReviewAttachmentSchema = z.strictObject({
  kind: z.literal("review"),
  reviewDraftKey: z.string(),
  commentCount: z.number().int().nonnegative(),
  attachment: z.strictObject({
    type: z.literal("review"),
    mimeType: z.literal("application/paseo-review"),
    cwd: z.string(),
    mode: z.enum(["uncommitted", "base"]),
    baseRef: z.string().nullable().optional(),
    comments: z.array(
      z.strictObject({
        filePath: z.string(),
        side: z.enum(["old", "new"]),
        lineNumber: z.number().int().positive(),
        body: z.string(),
        context: z.strictObject({
          hunkHeader: z.string(),
          targetLine: LegacyReviewAttachmentContextLineSchema,
          lines: z.array(LegacyReviewAttachmentContextLineSchema),
        }),
      }),
    ),
  }),
});
const PersistedComposerAttachmentSchema = z.union([
  UserComposerAttachmentSchema,
  LegacyGithubPrAttachmentSchema,
  LegacyReviewAttachmentSchema,
]);
type PersistedComposerAttachment = z.infer<typeof PersistedComposerAttachmentSchema>;
const LegacyAttachmentMetadataSchema = AttachmentMetadataSchema.extend({
  previewUri: z.string(),
});
type PersistedImage = PersistedDraftImage | z.infer<typeof LegacyAttachmentMetadataSchema>;

const RawDraftInputSchema = z.strictObject({
  text: z.string().optional(),
  attachments: z.array(PersistedComposerAttachmentSchema).optional(),
  images: z
    .array(
      z.union([AttachmentMetadataSchema, LegacyAttachmentMetadataSchema, LegacyDraftImageSchema]),
    )
    .optional(),
  cwd: z.string().optional(),
});
const DraftLifecycleSchema = z.enum(["active", "abandoned", "sent"]);
const NestedDraftRecordSchema = z.strictObject({
  input: RawDraftInputSchema,
  lifecycle: DraftLifecycleSchema.optional(),
  updatedAt: z.number().optional(),
  version: z.number().int().positive().optional(),
});
const FlatDraftRecordSchema = RawDraftInputSchema.extend({
  lifecycle: DraftLifecycleSchema.optional(),
  updatedAt: z.number().optional(),
  version: z.number().int().positive().optional(),
});
const PersistedDraftRecordSchema = z.unknown().transform((raw, context) => {
  // A malformed nested input must never match the all-optional legacy flat shape.
  const schema =
    isStoredObject(raw) && Object.hasOwn(raw, "input")
      ? NestedDraftRecordSchema
      : FlatDraftRecordSchema;
  const result = schema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error.issues) context.addIssue({ ...issue });
    return z.NEVER;
  }
  return result.data;
});
export const PersistedDraftStoreSchema = z.strictObject({
  drafts: z.record(z.string(), PersistedDraftRecordSchema).optional(),
  createModalDraft: PersistedDraftRecordSchema.nullable().optional(),
});
type PersistedDraftRecord = z.infer<typeof PersistedDraftRecordSchema>;

export type MigrateLegacyImages = (
  images: readonly PersistedDraftImage[],
) => Promise<AttachmentMetadata[]>;

function normalizePersistedImage(value: PersistedImage): PersistedDraftImage {
  if ("id" in value) {
    return normalizeAttachmentMetadata(value);
  }
  return {
    uri: value.uri,
    ...(value.mimeType ? { mimeType: value.mimeType } : {}),
  };
}

function legacyImagesToAttachments(
  images: readonly AttachmentMetadata[],
): UserComposerAttachment[] {
  return images.map((metadata) => ({
    kind: "image",
    metadata,
  }));
}

function normalizePersistedComposerAttachment(
  attachment: PersistedComposerAttachment,
): UserComposerAttachment | null {
  if (attachment.kind === "review") {
    return null;
  }
  if (attachment.kind === "github_pr" && attachment.item.kind === "pr") {
    return {
      kind: "github_pr",
      item: { ...attachment.item, kind: "change_request" },
      ...(attachment.owner ? { owner: attachment.owner } : {}),
    };
  }
  const result = UserComposerAttachmentSchema.safeParse(attachment);
  if (!result.success) {
    throw new Error("Persisted composer attachment failed validation after migration");
  }
  return normalizeComposerAttachment(result.data);
}

export async function migrateDraftInput(
  input: { rawInput: unknown },
  ports: { migrateLegacyImages: MigrateLegacyImages },
): Promise<CanonicalDraftInput> {
  const rawInput = parseStoredValue(RawDraftInputSchema, input.rawInput, "paseo-drafts");
  const attachments = (rawInput.attachments ?? [])
    .map(normalizePersistedComposerAttachment)
    .filter((attachment): attachment is UserComposerAttachment => attachment !== null);
  const legacyImages = (rawInput.images ?? []).map(normalizePersistedImage);
  const migratedImages = await ports.migrateLegacyImages(legacyImages);

  return {
    text: typeof rawInput.text === "string" ? rawInput.text : "",
    attachments: [...attachments, ...legacyImagesToAttachments(migratedImages)],
  };
}

function resolvePersistedLifecycle(
  lifecycle: DraftLifecycleState | undefined,
): DraftLifecycleState {
  return lifecycle ?? "active";
}

function extractRawInput(record: PersistedDraftRecord): z.infer<typeof RawDraftInputSchema> {
  if ("input" in record) {
    return record.input;
  }
  return record;
}

async function buildMigratedDraftRecord(
  parsed: PersistedDraftRecord,
  ports: { migrateLegacyImages: MigrateLegacyImages },
  nowMs: number,
): Promise<DraftRecord> {
  return {
    input: await migrateDraftInput({ rawInput: extractRawInput(parsed) }, ports),
    lifecycle: resolvePersistedLifecycle(parsed.lifecycle),
    updatedAt: parsed.updatedAt ?? nowMs,
    version: parsed.version ?? 1,
  };
}

function migrateNewWorkspaceDraftKeys(drafts: Record<string, DraftRecord>): {
  drafts: Record<string, DraftRecord>;
  promotedKey?: string;
} {
  const legacyEntries = Object.entries(drafts).filter(([draftKey]) =>
    isLegacyNewWorkspaceDraftKey(draftKey),
  );
  if (legacyEntries.length === 0) {
    return { drafts };
  }

  const nextDrafts = { ...drafts };
  for (const [draftKey] of legacyEntries) {
    delete nextDrafts[draftKey];
  }

  if (nextDrafts[NEW_WORKSPACE_DRAFT_KEY]) {
    return { drafts: nextDrafts };
  }

  const newestActiveEntry = legacyEntries
    .filter(([, draft]) => draft.lifecycle === "active")
    .sort((left, right) => right[1].updatedAt - left[1].updatedAt)[0];
  if (newestActiveEntry) {
    const newestActiveDraft = newestActiveEntry[1];
    // Legacy scoped drafts did not record whether a PR came from the Base
    // picker. That checkout context is unsafe to carry onto a global surface.
    nextDrafts[NEW_WORKSPACE_DRAFT_KEY] = {
      ...newestActiveDraft,
      input: {
        ...newestActiveDraft.input,
        attachments: newestActiveDraft.input.attachments.filter(
          (attachment) => attachment.kind !== "github_pr",
        ),
      },
    };
  }

  return { drafts: nextDrafts, promotedKey: newestActiveEntry?.[0] };
}

function cannotReconcileMigration(): never {
  throw new Error("Cannot migrate saved paseo-drafts without discarding unknown data");
}

function reconcileDraftValue(raw: unknown, before: unknown, after: unknown): unknown {
  if (equal(before, after)) return raw;
  if (!isStoredObject(before) || !isStoredObject(after) || !isStoredObject(raw)) {
    // Array migrations may remove or reorder attachments. Without a proven mapping,
    // an unknown field on one item cannot be assigned to another surviving item.
    if (!equal(raw, before)) cannotReconcileMigration();
    return after;
  }
  const result = { ...raw };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Object.hasOwn(after, key)) {
      if (!equal(raw[key], before[key])) cannotReconcileMigration();
      delete result[key];
    } else if (!Object.hasOwn(before, key)) {
      if (Object.hasOwn(raw, key) && !equal(raw[key], after[key])) cannotReconcileMigration();
      result[key] = after[key];
    } else {
      result[key] = reconcileDraftValue(raw[key], before[key], after[key]);
    }
  }
  return result;
}

function nestDraftInput(record: Record<string, unknown>): Record<string, unknown> {
  if (Object.hasOwn(record, "input")) return record;
  const nested = { ...record };
  const input: Record<string, unknown> = {};
  for (const key of ["text", "attachments", "images", "cwd"]) {
    if (Object.hasOwn(nested, key)) {
      input[key] = nested[key];
      delete nested[key];
    }
  }
  return { ...nested, input };
}

function reconcileDraftRecord(
  raw: unknown,
  before: PersistedDraftRecord | null | undefined,
  after: DraftRecord | null,
): unknown {
  if (isStoredObject(raw) && before) {
    return reconcileDraftValue(nestDraftInput(raw), nestDraftInput(before), after);
  }
  return reconcileDraftValue(raw, before, after);
}

function reconcileDraftState(
  raw: unknown,
  before: z.infer<typeof PersistedDraftStoreSchema>,
  after: { drafts: Record<string, DraftRecord>; promotedKey?: string },
  createModalDraft: DraftRecord | null,
): DraftStoreState {
  if (!isStoredObject(raw)) cannotReconcileMigration();
  const rawDrafts = isStoredObject(raw.drafts) ? raw.drafts : {};
  const drafts: Record<string, unknown> = {};
  for (const [key, record] of Object.entries(after.drafts)) {
    const sourceKey =
      key === NEW_WORKSPACE_DRAFT_KEY && after.promotedKey ? after.promotedKey : key;
    Object.defineProperty(drafts, key, {
      value: reconcileDraftRecord(rawDrafts[sourceKey], before.drafts?.[sourceKey], record),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  for (const [key, record] of Object.entries(before.drafts ?? {})) {
    if (Object.hasOwn(drafts, key) || key === after.promotedKey) continue;
    // A migration may discard a recognized obsolete record, never its unknown data.
    if (!equal(rawDrafts[key], record)) cannotReconcileMigration();
  }
  return {
    ...raw,
    drafts: drafts as Record<string, DraftRecord>,
    createModalDraft: reconcileDraftRecord(
      raw.createModalDraft,
      before.createModalDraft,
      createModalDraft,
    ) as DraftRecord | null,
  };
}

export async function migratePersistedState(
  state: unknown,
  ports: { migrateLegacyImages: MigrateLegacyImages; nowMs: number },
): Promise<DraftStoreState> {
  const input = parseStoredValue(PersistedDraftStoreSchema, state, "paseo-drafts");

  const nextDrafts: Record<string, DraftRecord> = {};
  for (const [draftKey, rawRecord] of Object.entries(input.drafts ?? {})) {
    Object.defineProperty(nextDrafts, draftKey, {
      value: await buildMigratedDraftRecord(rawRecord, ports, ports.nowMs),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  let createModalDraft: DraftRecord | null = null;
  if (input.createModalDraft) {
    createModalDraft = await buildMigratedDraftRecord(input.createModalDraft, ports, ports.nowMs);
  }

  // COMPAT(newWorkspaceDraftSingleton): migrated in v0.1.108; remove after 2027-01-13.
  return reconcileDraftState(
    state,
    input,
    migrateNewWorkspaceDraftKeys(nextDrafts),
    createModalDraft,
  );
}
