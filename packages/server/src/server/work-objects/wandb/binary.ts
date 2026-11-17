import { open, type FileHandle } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { WorkError } from "../store.js";

// W&B datastore v0, not LevelDB's masked CRC32C. The SDK uses zlib CRC32.
// Format: wandb/wandb sdk/internal/datastore.py (MIT).
const BLOCK = 32768;
const crcTable = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
  return (crc ^ 0xffffffff) >>> 0;
}
interface ScanResult {
  offset: number;
  caughtUp: boolean;
}
export async function scanWandb(
  file: string,
  offset: number,
  consume: (record: Buffer, nextOffset: number) => void | Promise<void>,
  signal?: AbortSignal,
  endOffset?: number,
): Promise<ScanResult> {
  return withWandbFile(
    file,
    (handle) => scanFile(handle, file, offset, consume, signal, endOffset),
    signal,
  );
}

async function scanFile(
  handle: FileHandle,
  file: string,
  offset: number,
  consume: (record: Buffer, nextOffset: number) => void | Promise<void>,
  signal?: AbortSignal,
  endOffset?: number,
): Promise<ScanResult> {
  signal?.throwIfAborted();
  const info = await handle.stat();
  const size = Math.min(info.size, endOffset ?? info.size);
  if (!(await readHeader(handle, file))) return { offset: 0, caughtUp: false };
  let position = Math.max(7, offset);
  let committed = position;
  let fragments: Buffer[] = [];
  let block: Buffer = Buffer.alloc(0);
  let blockStart = -1;
  while (position < size) {
    signal?.throwIfAborted();
    const space = BLOCK - (position % BLOCK);
    if (space < 7) {
      position += space;
      continue;
    }
    if (position + 7 > size) break;
    const start = position - (position % BLOCK);
    if (start !== blockStart) {
      // Keep syscall and scheduling overhead proportional to blocks, not metrics.
      await setImmediate();
      signal?.throwIfAborted();
      block = await readBlock(handle, start, Math.min(BLOCK, size - start));
      blockStart = start;
    }
    const local = position - blockStart;
    if (local + 7 > block.length) break;
    const length = block.readUInt16LE(local + 4);
    const type = block[local + 6]!;
    if (length + 7 > space || type < 1 || type > 4)
      throw new WorkError("data_corrupt", `Invalid W&B record at byte ${position}`);
    if (local + 7 + length > block.length) break;
    const payload = block.subarray(local + 6, local + 7 + length);
    if (crc32(payload) !== block.readUInt32LE(local))
      throw new WorkError("data_corrupt", `W&B checksum mismatch at byte ${position}`);
    const bytes = payload.subarray(1);
    const completed = consumeFragment(type, bytes, fragments);
    if (completed) {
      const consumed = consume(completed, position + 7 + length);
      if (consumed) await consumed;
      fragments = [];
    }
    position += 7 + length;
    if (!fragments.length) committed = position;
  }
  return { offset: committed, caughtUp: !fragments.length && position >= size };
}

export type ProtoValue = bigint | number | Buffer;
export type ProtoMessage = Map<number, ProtoValue[]>;
export function decodeProto(bytes: Buffer): ProtoMessage {
  const fields: ProtoMessage = new Map();
  let offset = 0;
  function varint(): bigint {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= bytes.length) throw new WorkError("data_corrupt", "Truncated protobuf varint");
      const byte = bytes[offset++]!;
      value |= BigInt(byte & 127) << shift;
      if ((byte & 128) === 0) return value;
    }
    throw new WorkError("data_corrupt", "Invalid protobuf varint");
  }
  while (offset < bytes.length) {
    const tag = Number(varint());
    const field = tag >>> 3;
    const wire = tag & 7;
    let value: ProtoValue;
    if (wire === 0) value = varint();
    else if (wire === 1) {
      requireBytes(bytes, offset, 8);
      value = bytes.readDoubleLE(offset);
      offset += 8;
    } else if (wire === 2) {
      const length = Number(varint());
      requireBytes(bytes, offset, length);
      value = bytes.subarray(offset, offset + length);
      offset += length;
    } else if (wire === 5) {
      requireBytes(bytes, offset, 4);
      value = bytes.readFloatLE(offset);
      offset += 4;
    } else throw new WorkError("format_unsupported", `Unsupported protobuf wire type ${wire}`);
    const values = fields.get(field) ?? [];
    values.push(value);
    fields.set(field, values);
  }
  return fields;
}
function requireBytes(bytes: Buffer, offset: number, length: number): void {
  if (offset + length > bytes.length)
    throw new WorkError("data_corrupt", "Truncated protobuf value");
}
export function messages(fields: ProtoMessage, key: number): ProtoMessage[] {
  return (fields.get(key) ?? []).filter(Buffer.isBuffer).map(decodeProto);
}
export function textField(fields: ProtoMessage, key: number): string {
  const value = fields.get(key)?.at(-1);
  return Buffer.isBuffer(value) ? value.toString("utf8") : "";
}
export function numberField(fields: ProtoMessage, key: number): number {
  const value = fields.get(key)?.at(-1);
  return typeof value === "bigint" || typeof value === "number" ? Number(value) : 0;
}

function consumeFragment(type: number, bytes: Buffer, fragments: Buffer[]): Buffer | null {
  if (type === 1) {
    if (fragments.length) throw new WorkError("data_corrupt", "Unfinished fragmented W&B record");
    return bytes;
  }
  if (type === 2) {
    if (fragments.length) throw new WorkError("data_corrupt", "Nested fragmented W&B record");
    fragments.push(bytes);
    return null;
  }
  if (!fragments.length)
    throw new WorkError("data_corrupt", "W&B continuation has no first fragment");
  fragments.push(bytes);
  return type === 4 ? Buffer.concat(fragments) : null;
}

async function readHeader(handle: FileHandle, file: string): Promise<boolean> {
  const header = await readBlock(handle, 0, 7);
  if (header.length < 7) return false;
  if (
    header.toString("ascii", 0, 4) !== ":W&B" ||
    header.readUInt16LE(4) !== 0xbee1 ||
    header[6] !== 0
  )
    throw new WorkError("format_unsupported", `Unsupported W&B datastore: ${file}`);
  return true;
}

async function readBlock(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const block = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await handle.read(block, filled, length - filled, position + filled);
    if (!bytesRead) break;
    filled += bytesRead;
  }
  return block.subarray(0, filled);
}

// A process-wide I/O budget bounds open history files across sources and HTTP
// consumers. Queued work has no file handle and is removed immediately on abort.
const SCAN_CONCURRENCY = 4;
let activeScans = 0;
const scanQueue = new Set<() => void>();

function acquireScan(signal?: AbortSignal): Promise<() => void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () => {
      scanQueue.delete(start);
      reject(signal?.reason);
    };
    const start = () => {
      scanQueue.delete(start);
      signal?.removeEventListener("abort", cancel);
      activeScans++;
      resolve(() => {
        activeScans--;
        scanQueue.values().next().value?.();
      });
    };
    if (activeScans < SCAN_CONCURRENCY) start();
    else {
      scanQueue.add(start);
      signal?.addEventListener("abort", cancel, { once: true });
    }
  });
}

export async function withWandbFile<T>(
  file: string,
  read: (handle: FileHandle) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const release = await acquireScan(signal);
  try {
    signal?.throwIfAborted();
    const handle = await open(file, "r");
    try {
      return await read(handle);
    } finally {
      await handle.close();
    }
  } finally {
    release();
  }
}
