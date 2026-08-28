import { asUint8Array } from "./terminal.js";

export const TunnelStreamOpcode = {
  Data: 0x20,
  End: 0x21,
  Pause: 0x22,
  Resume: 0x23,
} as const;

export type TunnelStreamOpcode = (typeof TunnelStreamOpcode)[keyof typeof TunnelStreamOpcode];

export interface TunnelStreamFrame {
  opcode: TunnelStreamOpcode;
  tunnelId: string;
  payload: Uint8Array;
}

export function encodeTunnelStreamFrame(input: {
  opcode: TunnelStreamOpcode;
  tunnelId: string;
  payload?: Uint8Array | ArrayBuffer | string;
}): Uint8Array {
  const tunnelId = new TextEncoder().encode(input.tunnelId);
  if (tunnelId.byteLength === 0 || tunnelId.byteLength > 0xff) {
    throw new RangeError("Tunnel id must encode to 1..255 bytes");
  }
  const payload = asUint8Array(input.payload ?? new Uint8Array()) ?? new Uint8Array();
  const bytes = new Uint8Array(2 + tunnelId.byteLength + payload.byteLength);
  bytes[0] = input.opcode;
  bytes[1] = tunnelId.byteLength;
  bytes.set(tunnelId, 2);
  bytes.set(payload, 2 + tunnelId.byteLength);
  return bytes;
}

export function decodeTunnelStreamFrame(bytes: Uint8Array): TunnelStreamFrame | null {
  if (bytes.byteLength < 3 || !isTunnelStreamOpcode(bytes[0])) return null;
  const tunnelIdLength = bytes[1];
  if (tunnelIdLength === 0 || tunnelIdLength > bytes.byteLength - 2) return null;
  const payload = bytes.subarray(2 + tunnelIdLength);
  if (bytes[0] !== TunnelStreamOpcode.Data && payload.byteLength !== 0) return null;
  return {
    opcode: bytes[0],
    tunnelId: new TextDecoder().decode(bytes.subarray(2, 2 + tunnelIdLength)),
    payload,
  };
}

function isTunnelStreamOpcode(value: number): value is TunnelStreamOpcode {
  return (
    value === TunnelStreamOpcode.Data ||
    value === TunnelStreamOpcode.End ||
    value === TunnelStreamOpcode.Pause ||
    value === TunnelStreamOpcode.Resume
  );
}
