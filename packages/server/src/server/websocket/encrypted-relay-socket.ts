import { EventEmitter } from "node:events";
import { sendBoundedPhysicalFrameAndWait } from "./physical-socket.js";

export interface EncryptedRelayChannel {
  setState: (state: "open") => void;
  send: (data: string | ArrayBuffer) => Promise<void>;
  outboundWireByteLength: (data: string | ArrayBuffer) => number;
  close: (code?: number, reason?: string) => void;
}

export interface EncryptedRelaySocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  outboundWireByteLength: (data: string | Uint8Array | ArrayBuffer) => number;
  send: (data: string | Uint8Array | ArrayBuffer) => void | Promise<void>;
  close: (code?: number, reason?: string) => void;
  terminate: () => void;
  on: (event: "message" | "close" | "error", listener: (...args: unknown[]) => void) => void;
  once: (event: "close" | "error", listener: (...args: unknown[]) => void) => void;
}

export function createEncryptedRelaySocket(params: {
  channel: EncryptedRelayChannel;
  emitter: EventEmitter;
  getTransportBufferedAmount: () => number | undefined;
  terminateTransport: () => void;
}): EncryptedRelaySocket {
  const { channel, emitter, getTransportBufferedAmount, terminateTransport } = params;
  let readyState = 1;

  channel.setState("open");

  const terminate = () => {
    if (readyState === 3) return;
    readyState = 3;
    terminateTransport();
  };

  const close = (code?: number, reason?: string) => {
    if (readyState === 3) return;
    readyState = 3;
    channel.close(code, reason);
  };

  emitter.on("close", () => {
    readyState = 3;
  });

  const transport = {
    get readyState() {
      return readyState;
    },
    get bufferedAmount() {
      return getTransportBufferedAmount() ?? 0;
    },
    send: (data: string | Uint8Array | ArrayBuffer) =>
      channel.send(normalizeRelaySendPayload(data)).catch((error) => {
        emitter.emit("error", error);
        throw error;
      }),
  };

  return {
    get readyState() {
      return readyState;
    },
    get bufferedAmount() {
      return getTransportBufferedAmount() ?? 0;
    },
    outboundWireByteLength: (data) =>
      channel.outboundWireByteLength(normalizeRelaySendPayload(data)),
    send: async (data) => {
      if (readyState !== 1) {
        throw new Error("Encrypted relay socket is not open");
      }
      const outbound = normalizeRelaySendPayload(data);
      const outboundBytes = channel.outboundWireByteLength(outbound);
      const sent = await sendBoundedPhysicalFrameAndWait({
        socket: transport,
        frame: outbound,
        frameBytes: outboundBytes,
        onHighWater: terminate,
      });
      if (!sent) {
        throw new Error("Encrypted relay socket exceeded its outbound high-water mark");
      }
    },
    close,
    terminate,
    on: (event, listener) => {
      emitter.on(event, listener);
    },
    once: (event, listener) => {
      emitter.once(event, listener);
    },
  };
}

function normalizeRelaySendPayload(data: string | Uint8Array | ArrayBuffer): string | ArrayBuffer {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return data;
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const out = new Uint8Array(view.byteLength);
  out.set(view);
  return out.buffer;
}
