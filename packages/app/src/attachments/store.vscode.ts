import { createIndexedDbAttachmentStore } from "@/attachments/web/indexeddb-attachment-store";
import type { AttachmentStore } from "@/attachments/types";

let attachmentStorePromise: Promise<AttachmentStore> | null = null;

export async function getAttachmentStore(): Promise<AttachmentStore> {
  attachmentStorePromise ??= Promise.resolve(createIndexedDbAttachmentStore());
  return await attachmentStorePromise;
}

/** Test-only hook to inject a deterministic store implementation. */
export function __setAttachmentStoreForTests(store: AttachmentStore | null): void {
  attachmentStorePromise = store ? Promise.resolve(store) : null;
}
