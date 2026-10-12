import { crc32 } from "../binary.js";
export function varint(value: number): Buffer {
  const bytes: number[] = [];
  do {
    const byte = value & 127;
    value = Math.floor(value / 128);
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
}
export function message(field: number, value: Buffer): Buffer {
  return Buffer.concat([varint(field * 8 + 2), varint(value.length), value]);
}
export function string(field: number, value: string): Buffer {
  return message(field, Buffer.from(value));
}
export function double(field: number, value: number): Buffer {
  const bytes = Buffer.alloc(9);
  bytes[0] = field * 8 + 1;
  bytes.writeDoubleLE(value, 1);
  return bytes;
}
export function item(key: string, value: Buffer): Buffer {
  return message(1, Buffer.concat([string(1, key), value]));
}
export function frame(payload: Buffer): Buffer {
  const bytes = Buffer.alloc(7);
  bytes.writeUInt32LE(crc32(Buffer.concat([Buffer.from([1]), payload])));
  bytes.writeUInt16LE(payload.length, 4);
  bytes[6] = 1;
  return Buffer.concat([bytes, payload]);
}

// Encode legal datastore fragments, including records that cross block boundaries.
export function recordStream(records: Buffer[], initialOffset = 7): Buffer {
  const chunks: Buffer[] = [];
  let offset = initialOffset;
  for (const record of records) {
    let read = 0;
    while (read < record.length) {
      const available = 32768 - (offset % 32768);
      if (available < 7) {
        chunks.push(Buffer.alloc(available));
        offset += available;
        continue;
      }
      const count = Math.min(record.length - read, available - 7);
      const last = read + count === record.length;
      let type = last ? 4 : 3;
      if (read === 0) type = last ? 1 : 2;
      const payload = record.subarray(read, read + count);
      const header = Buffer.alloc(7);
      header[6] = type;
      header.writeUInt16LE(count, 4);
      header.writeUInt32LE(crc32(Buffer.concat([Buffer.from([type]), payload])));
      chunks.push(header, payload);
      read += count;
      offset += count + 7;
    }
  }
  return Buffer.concat(chunks);
}
export function history(step: number, loss: number, time = 1800000000 + step): Buffer {
  return message(
    2,
    Buffer.concat([
      item("_step", string(16, String(step))),
      item("_timestamp", double(6, time)),
      item("loss", double(6, loss)),
    ]),
  );
}
