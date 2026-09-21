import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 1_000;
const SNAPSHOT_IDLE_TTL_MS = 5 * 60_000;
const MAX_SNAPSHOTS = 64;

export type ViewerDirectoryEntryKind = "directory" | "file" | "other";

export interface ViewerDirectoryEntry {
  name: string;
  kind: ViewerDirectoryEntryKind;
}

export interface ViewerDirectoryPage {
  entries: ViewerDirectoryEntry[];
  nextCursor: string | null;
}

interface ViewerDirectorySnapshot {
  binding: string;
  entries: ViewerDirectoryEntry[];
  pageSize: number;
  expiresAt: number;
}

export class ViewerDirectoryCursorError extends Error {
  constructor(readonly code: "cursor_expired" | "cursor_invalid") {
    super(
      code === "cursor_expired"
        ? "Viewer directory cursor expired"
        : "Invalid viewer directory cursor",
    );
    this.name = "ViewerDirectoryCursorError";
  }
}

export class ViewerDirectoryPager {
  private readonly snapshots = new Map<string, ViewerDirectorySnapshot>();

  clear(): void {
    this.snapshots.clear();
  }

  async firstPage(
    directoryPath: string,
    binding: string,
    requestedLimit: number | null,
  ): Promise<ViewerDirectoryPage> {
    const now = Date.now();
    this.sweep(now);
    const pageSize = normalizePageSize(requestedLimit);
    const entries = await readDirectoryEntries(directoryPath);
    const snapshotId = randomUUID();
    this.makeRoom();
    this.snapshots.set(snapshotId, {
      binding,
      entries,
      pageSize,
      expiresAt: now + SNAPSHOT_IDLE_TTL_MS,
    });
    return pageFromSnapshot(snapshotId, this.snapshots.get(snapshotId)!, 0);
  }

  nextPage(cursor: string, binding: string): ViewerDirectoryPage {
    const now = Date.now();
    this.sweep(now);
    const decoded = decodeCursor(cursor);
    const snapshot = this.snapshots.get(decoded.snapshotId);
    if (!snapshot) throw new ViewerDirectoryCursorError("cursor_expired");
    if (
      snapshot.binding !== binding ||
      decoded.offset < 1 ||
      decoded.offset >= snapshot.entries.length
    ) {
      throw new ViewerDirectoryCursorError("cursor_invalid");
    }
    snapshot.expiresAt = now + SNAPSHOT_IDLE_TTL_MS;
    return pageFromSnapshot(decoded.snapshotId, snapshot, decoded.offset);
  }

  private sweep(now: number): void {
    for (const [snapshotId, snapshot] of this.snapshots) {
      if (snapshot.expiresAt <= now) this.snapshots.delete(snapshotId);
    }
  }

  private makeRoom(): void {
    while (this.snapshots.size >= MAX_SNAPSHOTS) {
      const oldest = this.snapshots.keys().next().value;
      if (typeof oldest !== "string") return;
      this.snapshots.delete(oldest);
    }
  }
}

function normalizePageSize(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(value)));
}

async function readDirectoryEntries(directoryPath: string): Promise<ViewerDirectoryEntry[]> {
  const dirents = await readdir(directoryPath, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map(async (dirent): Promise<ViewerDirectoryEntry> => {
      let kind: ViewerDirectoryEntryKind;
      if (dirent.isDirectory()) kind = "directory";
      else if (dirent.isFile()) kind = "file";
      else if (dirent.isSymbolicLink()) {
        const target = await stat(path.join(directoryPath, dirent.name)).catch(() => null);
        if (target?.isDirectory()) kind = "directory";
        else if (target?.isFile()) kind = "file";
        else kind = "other";
      } else kind = "other";
      return { name: dirent.name, kind };
    }),
  );
  return entries.sort(compareDirectoryEntries);
}

function compareDirectoryEntries(left: ViewerDirectoryEntry, right: ViewerDirectoryEntry): number {
  const natural = left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return natural || left.name.localeCompare(right.name);
}

function pageFromSnapshot(
  snapshotId: string,
  snapshot: ViewerDirectorySnapshot,
  offset: number,
): ViewerDirectoryPage {
  const end = Math.min(snapshot.entries.length, offset + snapshot.pageSize);
  return {
    entries: snapshot.entries.slice(offset, end),
    nextCursor: end < snapshot.entries.length ? encodeCursor(snapshotId, end) : null,
  };
}

function encodeCursor(snapshotId: string, offset: number): string {
  return Buffer.from(JSON.stringify({ snapshotId, offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { snapshotId: string; offset: number } {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      typeof value.snapshotId !== "string" ||
      value.snapshotId.length === 0 ||
      !Number.isSafeInteger(value.offset)
    ) {
      throw new ViewerDirectoryCursorError("cursor_invalid");
    }
    return { snapshotId: value.snapshotId, offset: value.offset as number };
  } catch (error) {
    if (error instanceof ViewerDirectoryCursorError) throw error;
    throw new ViewerDirectoryCursorError("cursor_invalid");
  }
}
