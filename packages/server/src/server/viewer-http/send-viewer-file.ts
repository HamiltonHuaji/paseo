import { createHash, randomBytes } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";

const FILE_OPEN_FLAGS =
  process.platform === "win32" ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NONBLOCK;
const MAX_RANGE_HEADER_LENGTH = 4096;
const MAX_RANGES = 16;
const CHUNK_BYTES = 64 * 1024;

interface ByteRange {
  start: number;
  end: number; // Exclusive.
}

interface SendViewerFileInput {
  req: Request;
  res: Response;
  filePath: string;
}

/** Send a resolved regular file. Return false when the file is missing. */
export async function sendViewerFile({
  req,
  res,
  filePath,
}: SendViewerFileInput): Promise<boolean> {
  const file = await open(filePath, FILE_OPEN_FLAGS).catch((error: unknown) => {
    if (
      error instanceof Error &&
      "code" in error &&
      ["ENOENT", "ENOTDIR"].includes(String(error.code))
    ) {
      return null;
    }
    throw error;
  });
  if (!file) return false;

  try {
    // Read headers and every part from the same handle if the mounted path is replaced.
    const stats = await file.stat({ bigint: true });
    if (!stats.isFile()) return false;
    if (res.destroyed) return true;
    const size = Number(stats.size);
    if (!Number.isSafeInteger(size)) throw new Error("Viewer resource is too large to address");
    const lastModified = Math.floor(Math.min(stats.mtime.getTime(), Date.now()) / 1000) * 1000;
    const etag = fileETag(stats);

    res.set({
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=0",
      ETag: etag,
      "Last-Modified": new Date(lastModified).toUTCString(),
    });
    const precondition = preconditionStatus(req, etag, lastModified);
    if (precondition) {
      res.status(precondition).end();
      return true;
    }

    res.type(path.extname(filePath) || "application/octet-stream");
    const ifRange = req.get("If-Range");
    const ranges =
      req.method === "GET" &&
      (ifRange === undefined || ifRange === etag || parseHttpDate(ifRange) === lastModified)
        ? parseByteRanges(req.get("Range"), size)
        : null;
    if (ranges?.length === 0) {
      res.status(416).set("Content-Range", `bytes */${size}`).end();
      return true;
    }
    if (ranges && ranges.length > 1) {
      await sendMultipart(res, file, ranges, size);
      return true;
    }

    const range = ranges?.[0] ?? { start: 0, end: size };
    res.set("Content-Length", String(range.end - range.start));
    if (ranges) res.status(206).set("Content-Range", contentRange(range, size));
    if (req.method === "HEAD" || size === 0) {
      res.end();
    } else {
      await pipeline(Readable.from(readRange(file, range), { objectMode: false }), res);
    }
    return true;
  } finally {
    await file.close();
  }
}

function fileETag(stats: BigIntStats): string {
  // Include ctime to distinguish rewrites that restore the old mtime.
  const revision = [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs].join(":");
  return `"${createHash("sha256").update(revision).digest("base64url")}"`;
}

function preconditionStatus(req: Request, etag: string, lastModified: number): 304 | 412 | null {
  const ifMatch = req.get("If-Match");
  if (
    ifMatch !== undefined
      ? !matchesETag(ifMatch, etag, false)
      : lastModified > parseHttpDate(req.get("If-Unmodified-Since"))
  ) {
    return 412;
  }
  const ifNoneMatch = req.get("If-None-Match");
  if (
    ifNoneMatch !== undefined
      ? matchesETag(ifNoneMatch, etag, true)
      : lastModified <= parseHttpDate(req.get("If-Modified-Since"))
  ) {
    return 304;
  }
  return null;
}

function matchesETag(value: string, etag: string, weak: boolean): boolean {
  if (value.trim() === "*") return true;
  // Commas inside a quoted entity tag are part of the tag.
  const tags = value.match(/(?:W\/)?"[^"]*"/g) ?? [];
  return tags.some((tag) => tag === etag || (weak && tag === `W/${etag}`));
}

function parseHttpDate(value: string | undefined): number {
  if (!value) return NaN;
  // The obsolete asctime form has no explicit time zone and is also UTC.
  if (/^[a-z]{3} [a-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/i.test(value)) {
    return Date.parse(`${value} GMT`);
  }
  return /^(?:[a-z]{3}, \d{2} [a-z]{3} \d{4}|[a-z]+, \d{2}-[a-z]{3}-\d{2}) \d{2}:\d{2}:\d{2} GMT$/i.test(
    value,
  )
    ? Date.parse(value)
    : NaN;
}

// null means ignore the field. An empty result means it was valid but unsatisfiable.
function parseByteRanges(header: string | undefined, size: number): ByteRange[] | null {
  if (
    !header ||
    size === 0 ||
    header.length > MAX_RANGE_HEADER_LENGTH ||
    !/^bytes=/i.test(header)
  ) {
    return null;
  }
  const specs = header
    .slice("bytes=".length)
    .split(",")
    .map((spec) => spec.trim())
    .filter(Boolean);
  if (specs.length === 0 || specs.length > MAX_RANGES) return null;

  const fileSize = BigInt(size);
  const ranges: ByteRange[] = [];
  for (const spec of specs) {
    const match = /^(\d*)-(\d*)$/.exec(spec);
    if (!match || (!match[1] && !match[2])) return null;
    const [, first, last] = match;
    if (!first) {
      const suffix = BigInt(last!);
      if (suffix > 0n)
        ranges.push({ start: suffix >= fileSize ? 0 : Number(fileSize - suffix), end: size });
      continue;
    }
    const start = BigInt(first);
    const end = last ? BigInt(last) + 1n : fileSize;
    if (last && end <= start) return null;
    if (start < fileSize)
      ranges.push({ start: Number(start), end: end >= fileSize ? size : Number(end) });
  }
  return coalesceRanges(ranges);
}

function coalesceRanges(ranges: ByteRange[]): ByteRange[] {
  const sorted = ranges
    .map((range, order) => ({ ...range, order }))
    .sort((a, b) => a.start - b.start);
  const merged: typeof sorted = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
      previous.order = Math.min(previous.order, range.order);
    } else {
      merged.push(range);
    }
  }
  return merged.sort((a, b) => a.order - b.order);
}

function contentRange({ start, end }: ByteRange, size: number): string {
  return `bytes ${start}-${end - 1}/${size}`;
}

async function sendMultipart(res: Response, file: FileHandle, ranges: ByteRange[], size: number) {
  const boundary = randomBytes(16).toString("hex");
  const contentType = res.getHeader("Content-Type");
  const parts = ranges.map((range) => ({
    range,
    header: Buffer.from(
      `--${boundary}\r\nContent-Type: ${contentType}\r\nContent-Range: ${contentRange(range, size)}\r\n\r\n`,
    ),
  }));
  const separator = Buffer.from("\r\n");
  const ending = Buffer.from(`--${boundary}--\r\n`);
  let length = BigInt(ending.length);
  for (const { range, header } of parts) {
    length += BigInt(header.length + separator.length) + BigInt(range.end - range.start);
  }

  res.status(206).set({
    "Content-Type": `multipart/byteranges; boundary=${boundary}`,
    "Content-Length": String(length),
  });
  async function* body() {
    for (const { range, header } of parts) {
      yield header;
      yield* readRange(file, range);
      yield separator;
    }
    yield ending;
  }
  await pipeline(Readable.from(body(), { objectMode: false }), res);
}

async function* readRange(file: FileHandle, { start, end }: ByteRange) {
  let offset = start;
  while (offset < end) {
    const chunk = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, end - offset));
    const { bytesRead } = await file.read(chunk, 0, chunk.length, offset);
    if (bytesRead === 0) throw new Error("Viewer file was truncated during transfer");
    offset += bytesRead;
    yield chunk.subarray(0, bytesRead);
  }
}
