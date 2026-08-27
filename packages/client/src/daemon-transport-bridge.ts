import type { DaemonTransport, DaemonTransportFactory } from "./daemon-client-transport-types.js";

export type EncodedDaemonTransportFrame =
  | { kind: "text"; value: string }
  | { kind: "base64"; value: string };

export type DaemonTransportBridgeRequest =
  | { type: "daemonTransportRequest"; action: "open"; portId: string }
  | {
      type: "daemonTransportRequest";
      action: "send";
      portId: string;
      frame: EncodedDaemonTransportFrame;
    }
  | {
      type: "daemonTransportRequest";
      action: "close";
      portId: string;
      code?: number;
      reason?: string;
    };

export type DaemonTransportBridgeEvent =
  | { type: "daemonTransportEvent"; event: "open"; portId: string }
  | {
      type: "daemonTransportEvent";
      event: "message";
      portId: string;
      frame: EncodedDaemonTransportFrame;
    }
  | {
      type: "daemonTransportEvent";
      event: "close";
      portId: string;
      code?: number;
      reason?: string;
    }
  | {
      type: "daemonTransportEvent";
      event: "error";
      portId: string;
      message: string;
    };

export interface DaemonTransportBridgeChannel {
  createPortId(): string;
  post(request: DaemonTransportBridgeRequest): void;
  subscribe(handler: (event: DaemonTransportBridgeEvent) => void): () => void;
}

export function encodeDaemonTransportFrame(
  frame: string | Uint8Array | ArrayBuffer,
): EncodedDaemonTransportFrame {
  if (typeof frame === "string") {
    return { kind: "text", value: frame };
  }
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  return { kind: "base64", value: encodeBase64(bytes) };
}

export function decodeDaemonTransportFrame(
  frame: EncodedDaemonTransportFrame,
): string | Uint8Array {
  return frame.kind === "text" ? frame.value : decodeBase64(frame.value);
}

export function parseDaemonTransportBridgeRequest(
  value: unknown,
): DaemonTransportBridgeRequest | null {
  if (!isRecord(value) || value.type !== "daemonTransportRequest" || !isNonEmpty(value.portId)) {
    return null;
  }
  if (value.action === "open") {
    return { type: value.type, action: value.action, portId: value.portId };
  }
  if (value.action === "send" && isEncodedFrame(value.frame)) {
    return {
      type: value.type,
      action: value.action,
      portId: value.portId,
      frame: value.frame,
    };
  }
  if (value.action === "close") {
    return {
      type: value.type,
      action: value.action,
      portId: value.portId,
      ...(typeof value.code === "number" ? { code: value.code } : {}),
      ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    };
  }
  return null;
}

export function parseDaemonTransportBridgeEvent(value: unknown): DaemonTransportBridgeEvent | null {
  if (!isRecord(value) || value.type !== "daemonTransportEvent" || !isNonEmpty(value.portId)) {
    return null;
  }
  if (value.event === "open") {
    return { type: value.type, event: value.event, portId: value.portId };
  }
  if (value.event === "message" && isEncodedFrame(value.frame)) {
    return {
      type: value.type,
      event: value.event,
      portId: value.portId,
      frame: value.frame,
    };
  }
  if (value.event === "close") {
    return {
      type: value.type,
      event: value.event,
      portId: value.portId,
      ...(typeof value.code === "number" ? { code: value.code } : {}),
      ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
    };
  }
  if (value.event === "error" && typeof value.message === "string") {
    return {
      type: value.type,
      event: value.event,
      portId: value.portId,
      message: value.message,
    };
  }
  return null;
}

export function createDaemonTransportBridgeFactory(
  channel: DaemonTransportBridgeChannel,
): DaemonTransportFactory {
  return () => createDaemonTransportBridge(channel);
}

function createDaemonTransportBridge(channel: DaemonTransportBridgeChannel): DaemonTransport {
  const portId = channel.createPortId();
  const messageHandlers = new Set<(data: unknown) => void>();
  const openHandlers = new Set<() => void>();
  const closeHandlers = new Set<(event?: unknown) => void>();
  const errorHandlers = new Set<(event?: unknown) => void>();
  let closed = false;

  const unsubscribe = channel.subscribe((event) => {
    if (event.portId !== portId || closed) {
      return;
    }
    if (event.event === "open") {
      for (const handler of openHandlers) handler();
      return;
    }
    if (event.event === "message") {
      const frame = decodeDaemonTransportFrame(event.frame);
      for (const handler of messageHandlers) handler(frame);
      return;
    }
    if (event.event === "error") {
      for (const handler of errorHandlers) handler(new Error(event.message));
      return;
    }
    closed = true;
    unsubscribe();
    const closeEvent = { code: event.code, reason: event.reason };
    for (const handler of closeHandlers) handler(closeEvent);
  });

  queueMicrotask(() => {
    if (!closed) {
      channel.post({ type: "daemonTransportRequest", action: "open", portId });
    }
  });

  return {
    send: (data) => {
      if (closed) {
        throw new Error("VS Code daemon transport is closed");
      }
      channel.post({
        type: "daemonTransportRequest",
        action: "send",
        portId,
        frame: encodeDaemonTransportFrame(data),
      });
    },
    close: (code, reason) => {
      if (closed) {
        return;
      }
      closed = true;
      unsubscribe();
      channel.post({
        type: "daemonTransportRequest",
        action: "close",
        portId,
        ...(code !== undefined ? { code } : {}),
        ...(reason !== undefined ? { reason } : {}),
      });
    },
    onMessage: (handler) => subscribeSet(messageHandlers, handler),
    onOpen: (handler) => subscribeSet(openHandlers, handler),
    onClose: (handler) => subscribeSet(closeHandlers, handler),
    onError: (handler) => subscribeSet(errorHandlers, handler),
  };
}

function subscribeSet<T>(handlers: Set<T>, handler: T): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

function isEncodedFrame(value: unknown): value is EncodedDaemonTransportFrame {
  return (
    isRecord(value) &&
    (value.kind === "text" || value.kind === "base64") &&
    typeof value.value === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function encodeBase64(bytes: Uint8Array): string {
  const nodeBuffer = getNodeBuffer();
  if (nodeBuffer) {
    return nodeBuffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const nodeBuffer = getNodeBuffer();
  if (nodeBuffer) {
    return new Uint8Array(nodeBuffer.from(value, "base64"));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

type NodeBufferLike = Uint8Array & { toString(encoding: string): string };
interface NodeBufferConstructor {
  from(value: Uint8Array | string, encoding?: string): NodeBufferLike;
}

function getNodeBuffer(): NodeBufferConstructor | null {
  const value = (globalThis as { Buffer?: unknown }).Buffer;
  if (
    typeof value === "function" &&
    "from" in value &&
    typeof (value as { from?: unknown }).from === "function"
  ) {
    return value as NodeBufferConstructor;
  }
  return null;
}
