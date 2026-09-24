import { asUint8Array } from "./terminal.js";

export const ViewerHttpOpcode = {
  Data: 0x30,
  End: 0x31,
  Reset: 0x32,
  Pause: 0x33,
  Resume: 0x34,
  Credit: 0x35,
} as const;

export type ViewerHttpOpcode = (typeof ViewerHttpOpcode)[keyof typeof ViewerHttpOpcode];

export interface ViewerHttpFrame {
  opcode: ViewerHttpOpcode;
  requestId: string;
  payload: Uint8Array;
}

export const VIEWER_HTTP_WINDOW_BYTES = 256 * 1024;

export function viewerHttpCreditPayload(bytes: number): Uint8Array {
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > VIEWER_HTTP_WINDOW_BYTES) {
    throw new RangeError("Invalid viewer HTTP credit");
  }
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, bytes);
  return payload;
}

export function viewerHttpCreditBytes(payload: Uint8Array): number {
  if (payload.byteLength !== 4) throw new RangeError("Invalid viewer HTTP credit payload");
  return new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0);
}

export function encodeViewerHttpFrame(input: {
  opcode: ViewerHttpOpcode;
  requestId: string;
  payload?: Uint8Array | ArrayBuffer;
}): Uint8Array {
  const id = new TextEncoder().encode(input.requestId);
  if (id.length < 1 || id.length > 255) throw new RangeError("Invalid viewer request ID");
  const payload = asUint8Array(input.payload ?? new Uint8Array()) ?? new Uint8Array();
  if (
    input.opcode === ViewerHttpOpcode.Credit
      ? payload.length !== 4
      : input.opcode !== ViewerHttpOpcode.Data && payload.length > 0
  ) {
    throw new RangeError("Viewer control frames cannot contain a body");
  }
  const bytes = new Uint8Array(2 + id.length + payload.length);
  bytes[0] = input.opcode;
  bytes[1] = id.length;
  bytes.set(id, 2);
  bytes.set(payload, 2 + id.length);
  return bytes;
}

export function decodeViewerHttpFrame(bytes: Uint8Array): ViewerHttpFrame | null {
  if (bytes.length < 3 || !isViewerHttpOpcode(bytes[0])) return null;
  const idLength = bytes[1];
  if (idLength < 1 || idLength > bytes.length - 2) return null;
  const payload = bytes.subarray(2 + idLength);
  if (
    bytes[0] === ViewerHttpOpcode.Credit
      ? payload.length !== 4
      : bytes[0] !== ViewerHttpOpcode.Data && payload.length > 0
  )
    return null;
  return {
    opcode: bytes[0],
    requestId: new TextDecoder().decode(bytes.subarray(2, 2 + idLength)),
    payload,
  };
}

function isViewerHttpOpcode(value: number): value is ViewerHttpOpcode {
  return (
    value === ViewerHttpOpcode.Data ||
    value === ViewerHttpOpcode.End ||
    value === ViewerHttpOpcode.Reset ||
    value === ViewerHttpOpcode.Pause ||
    value === ViewerHttpOpcode.Resume ||
    value === ViewerHttpOpcode.Credit
  );
}
