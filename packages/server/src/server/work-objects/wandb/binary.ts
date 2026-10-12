import { open } from "node:fs/promises";
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
  consume: (record: Buffer, nextOffset: number) => void,
  signal?: AbortSignal,
): Promise<ScanResult> {
  const handle = await open(file, "r");
  try {
    const info = await handle.stat();
    const header = Buffer.alloc(7);
    const initial = await handle.read(header, 0, 7, 0);
    if (initial.bytesRead < 7) return { offset: 0, caughtUp: false };
    if (
      header.toString("ascii", 0, 4) !== ":W&B" ||
      header.readUInt16LE(4) !== 0xbee1 ||
      header[6] !== 0
    )
      throw new WorkError("format_unsupported", `Unsupported W&B datastore: ${file}`);
    let position = Math.max(7, offset);
    let committed = position;
    let fragments: Buffer[] = [];
    while (position < info.size) {
      signal?.throwIfAborted();
      const space = BLOCK - (position % BLOCK);
      if (space < 7) {
        position += space;
        continue;
      }
      if (position + 7 > info.size) break;
      await handle.read(header, 0, 7, position);
      const length = header.readUInt16LE(4);
      const type = header[6]!;
      if (position + 7 + length > info.size) break;
      if (length + 7 > space || type < 1 || type > 4)
        throw new WorkError("data_corrupt", `Invalid W&B record at byte ${position}`);
      const payload = Buffer.alloc(length + 1);
      payload[0] = type;
      const read = await handle.read(payload, 1, length, position + 7);
      if (read.bytesRead !== length) break;
      if (crc32(payload) !== header.readUInt32LE(0))
        throw new WorkError("data_corrupt", `W&B checksum mismatch at byte ${position}`);
      const bytes = payload.subarray(1);
      const completed = consumeFragment(type, bytes, fragments);
      if (completed) {
        consume(completed, position + 7 + length);
        fragments = [];
      }
      position += 7 + length;
      if (!fragments.length) committed = position;
      await setImmediate();
    }
    return { offset: committed, caughtUp: !fragments.length && position >= info.size };
  } finally {
    await handle.close();
  }
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
