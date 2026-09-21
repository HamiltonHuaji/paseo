import {
  createDaemonTransportBridgeFactory,
  type DaemonTransportBridgeEvent,
  parseDaemonTransportBridgeEvent,
} from "@getpaseo/client/internal/daemon-transport-bridge";
import type { DaemonTransportFactory } from "@getpaseo/client/internal/daemon-client-transport-types";
import { postPaseoVscodeMessage } from "./bridge";

const listeners = new Set<(event: DaemonTransportBridgeEvent) => void>();
let listening = false;

function ensureListening(): void {
  if (listening || typeof window === "undefined") {
    return;
  }
  listening = true;
  window.addEventListener("message", (event) => {
    const parsed = parseDaemonTransportBridgeEvent(event.data);
    if (!parsed) {
      return;
    }
    for (const listener of listeners) {
      listener(parsed);
    }
  });
}

export function getPaseoVscodeDaemonTransportFactory(): DaemonTransportFactory | null {
  if (typeof window === "undefined" || !window.__PASEO_VSCODE_API__) {
    return null;
  }
  ensureListening();
  return createDaemonTransportBridgeFactory({
    createPortId: () => `port_${globalThis.crypto.randomUUID().replaceAll("-", "")}`,
    post: (request) => postPaseoVscodeMessage(request),
    subscribe: (handler) => {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
  });
}
