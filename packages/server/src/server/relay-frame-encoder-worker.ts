import { parentPort } from "node:worker_threads";
import { encodeEncryptedFrame } from "@getpaseo/relay/e2ee";
import type { RelayFrameWorkerRequest, RelayFrameWorkerResponse } from "./relay-frame-encoder.js";

const port = parentPort;
if (!port) throw new Error("Relay frame encoder requires a worker parent");

port.on("message", (request: RelayFrameWorkerRequest) => {
  let response: RelayFrameWorkerResponse;
  try {
    const data = encodeEncryptedFrame(request.sharedKey, request.data, request.binaryCiphertext);
    response = { id: request.id, data };
  } catch (error) {
    response = {
      id: request.id,
      error: error instanceof Error ? error.message : "Relay frame encoding failed",
    };
  } finally {
    // postMessage cloned this key; the channel's original key stays on the parent.
    request.sharedKey.fill(0);
  }
  const transfer =
    "data" in response && response.data instanceof ArrayBuffer ? [response.data] : [];
  port.postMessage(response, transfer);
});
