import { request, type ClientRequest, type IncomingMessage } from "node:http";
import {
  encodeViewerHttpFrame,
  ViewerHttpOpcode,
  VIEWER_HTTP_WINDOW_BYTES,
  type ViewerHttpFrame,
  viewerHttpCreditBytes,
} from "@getpaseo/protocol/binary-frames/index";
import type { OwnedOperation } from "../session/owned-subscriptions/index.js";
import type { ServiceProxySubsystem } from "../service-proxy.js";

const BODY_CHUNK_BYTES = 64 * 1024;
const MAX_INFLIGHT_FRAMES_PER_REQUEST = 4;
const MAX_INFLIGHT_FRAMES_PER_SOURCE = 16;
const HEADER_TIMEOUT_MS = 30_000;
const REQUEST_HEADERS = new Set([
  "accept",
  "cache-control",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "range",
]);
const RESPONSE_HEADERS = new Set([
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-length",
  "content-range",
  "content-security-policy",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "location",
  "vary",
  "x-content-type-options",
]);

interface ViewerRequest {
  method: "GET" | "HEAD";
  path: string;
  headers: Record<string, string>;
  requestId: string;
}

interface ActiveRequest {
  owner: OwnedOperation;
  request: ClientRequest;
  response: IncomingMessage | null;
  paused: boolean;
  wake: (() => void) | null;
  flowControlled: boolean;
  creditBytes: number;
  started: boolean;
  finished: boolean;
  cancelled: boolean;
  onAbort: () => void;
}

interface PendingFrame {
  entry: ActiveRequest;
  frame: Uint8Array;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface SourceQueue {
  pending: PendingFrame[];
  inflight: number;
}

export class ViewerHttpRequestCancelledError extends Error {
  constructor() {
    super("Viewer HTTP request cancelled");
    this.name = "ViewerHttpRequestCancelledError";
  }
}

export class ViewerHttpController {
  private readonly requests = new Map<string, ActiveRequest>();
  private readonly sourceQueues = new Map<object, SourceQueue>();

  constructor(private readonly serviceProxy: ServiceProxySubsystem | null) {}

  async open(
    input: ViewerRequest,
    owner: OwnedOperation,
    flowControlled: boolean,
  ): Promise<{
    status: number;
    headers: Record<string, string>;
  }> {
    if (input.path !== "/" && !input.path.startsWith("/view/")) {
      throw new Error("Viewer request path is outside the viewer service");
    }
    const route = this.serviceProxy?.resolveInternalService("viewers");
    if (!route) throw new Error("Viewer HTTP service is unavailable");
    if (this.requests.has(input.requestId)) throw new Error("Duplicate viewer request ID");
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.headers)) {
      if (REQUEST_HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value;
    }
    const upstream = request({
      host: "127.0.0.1",
      port: route.port,
      method: input.method,
      path: input.path,
      headers,
    });
    const entry: ActiveRequest = {
      owner,
      request: upstream,
      response: null,
      // COMPAT(viewerHttpFlowControl): added after v0.9.5; remove the pause/resume path
      // once supported clients all advertise viewer_http_flow_control.
      paused: !flowControlled,
      wake: null,
      flowControlled,
      creditBytes: 0,
      started: false,
      finished: false,
      cancelled: false,
      onAbort: () => {},
    };
    this.requests.set(input.requestId, entry);
    const onAbort = () => this.abort(input.requestId, entry);
    entry.onAbort = onAbort;
    owner.signal.addEventListener("abort", onAbort, { once: true });
    let headerTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      const result = await new Promise<{ status: number; headers: Record<string, string> }>(
        (resolve, reject) => {
          headerTimer = setTimeout(() => {
            upstream.destroy(new Error("Viewer upstream response timeout"));
          }, HEADER_TIMEOUT_MS);
          const onError = (error: Error) => {
            if (entry.response) entry.response.destroy(error);
            else reject(error);
          };
          upstream.on("error", onError);
          upstream.once("response", (response) => {
            entry.response = response;
            response.pause();
            const responseHeaders: Record<string, string> = {};
            for (const [name, value] of Object.entries(response.headers)) {
              if (!RESPONSE_HEADERS.has(name) || value === undefined) continue;
              responseHeaders[name] = Array.isArray(value) ? value.join(", ") : String(value);
            }
            resolve({ status: response.statusCode ?? 502, headers: responseHeaders });
          });
          upstream.end();
        },
      );
      if (headerTimer) clearTimeout(headerTimer);
      return result;
    } catch (error) {
      if (headerTimer) clearTimeout(headerTimer);
      const cancelled = entry.cancelled;
      this.finish(input.requestId, entry);
      if (cancelled) throw new ViewerHttpRequestCancelledError();
      throw error;
    }
  }

  start(requestId: string, source: object): void {
    const entry = this.requests.get(requestId);
    if (!entry || entry.owner.source !== source || entry.started || entry.finished) return;
    entry.started = true;
    void this.stream(requestId, entry);
  }

  handleFrame(frame: ViewerHttpFrame, source: object): void {
    const entry = this.requests.get(frame.requestId);
    if (!entry || entry.owner.source !== source) return;
    if (frame.opcode === ViewerHttpOpcode.Reset) {
      this.abort(frame.requestId, entry);
    } else if (frame.opcode === ViewerHttpOpcode.Pause && !entry.flowControlled) {
      entry.paused = true;
    } else if (frame.opcode === ViewerHttpOpcode.Resume && !entry.flowControlled) {
      entry.paused = false;
      entry.wake?.();
      entry.wake = null;
    } else if (frame.opcode === ViewerHttpOpcode.Credit && entry.flowControlled) {
      const bytes = viewerHttpCreditBytes(frame.payload);
      if (bytes < 1 || bytes > VIEWER_HTTP_WINDOW_BYTES) {
        this.abort(frame.requestId, entry);
        return;
      }
      entry.creditBytes = Math.min(VIEWER_HTTP_WINDOW_BYTES, entry.creditBytes + bytes);
      entry.wake?.();
      entry.wake = null;
    }
  }

  cancel(requestId: string): void {
    const entry = this.requests.get(requestId);
    if (entry) this.abort(requestId, entry);
  }

  dispose(): void {
    for (const [requestId, entry] of this.requests) this.abort(requestId, entry);
  }

  private async stream(requestId: string, entry: ActiveRequest): Promise<void> {
    const response = entry.response;
    if (!response) return;
    const inflight: Promise<void>[] = [];
    let sendError: Error | null = null;
    const flush = async () => {
      await Promise.all(inflight);
      inflight.length = 0;
      if (sendError) throw sendError;
    };
    try {
      for await (const chunk of response) {
        const data = chunk as Buffer;
        for (let offset = 0; offset < data.length; ) {
          await this.waitUntilReady(entry, 1);
          if (entry.finished) return;
          const length = Math.min(
            BODY_CHUNK_BYTES,
            data.length - offset,
            entry.flowControlled ? entry.creditBytes : BODY_CHUNK_BYTES,
          );
          const piece = data.subarray(offset, offset + length);
          offset += length;
          if (entry.flowControlled) entry.creditBytes -= piece.byteLength;
          inflight.push(
            this.sendFrame(
              entry,
              encodeViewerHttpFrame({
                opcode: ViewerHttpOpcode.Data,
                requestId,
                payload: piece,
              }),
            ).catch((error: unknown) => {
              sendError = error instanceof Error ? error : new Error(String(error));
            }),
          );
          if (inflight.length >= MAX_INFLIGHT_FRAMES_PER_REQUEST) await flush();
        }
      }
      await flush();
      await this.waitUntilReady(entry, 0);
      if (!entry.finished) {
        await this.sendFrame(
          entry,
          encodeViewerHttpFrame({ opcode: ViewerHttpOpcode.End, requestId }),
        );
      }
    } catch {
      if (!entry.finished) {
        await this.waitUntilReady(entry, 0);
      }
      if (!entry.finished) {
        await this.sendFrame(
          entry,
          encodeViewerHttpFrame({ opcode: ViewerHttpOpcode.Reset, requestId }),
        ).catch(() => undefined);
      }
    } finally {
      this.finish(requestId, entry);
    }
  }

  private async waitUntilReady(entry: ActiveRequest, bytes: number): Promise<void> {
    while (
      !entry.finished &&
      (entry.paused || (entry.flowControlled && entry.creditBytes < bytes))
    ) {
      await new Promise<void>((resolve) => {
        entry.wake = resolve;
      });
    }
  }

  private sendFrame(entry: ActiveRequest, frame: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const source = entry.owner.source;
      let queue = this.sourceQueues.get(source);
      if (!queue) {
        queue = { pending: [], inflight: 0 };
        this.sourceQueues.set(source, queue);
      }
      queue.pending.push({ entry, frame, resolve, reject });
      this.drainFrames(source, queue);
    });
  }

  private drainFrames(source: object, queue: SourceQueue): void {
    while (queue.inflight < MAX_INFLIGHT_FRAMES_PER_SOURCE && queue.pending.length > 0) {
      const next = queue.pending.shift()!;
      if (next.entry.finished) {
        next.reject(new Error("Viewer HTTP stream closed"));
        continue;
      }
      queue.inflight += 1;
      void next.entry.owner
        .emitBinary(next.frame)
        .then(next.resolve, (error: unknown) =>
          next.reject(error instanceof Error ? error : new Error(String(error))),
        )
        .finally(() => {
          queue.inflight -= 1;
          this.drainFrames(source, queue);
        });
    }
    if (queue.inflight === 0 && queue.pending.length === 0) this.sourceQueues.delete(source);
  }

  private abort(requestId: string, entry: ActiveRequest): void {
    if (entry.finished) return;
    entry.cancelled = true;
    entry.request.destroy();
    entry.response?.destroy();
    this.finish(requestId, entry);
  }

  private finish(requestId: string, entry: ActiveRequest): void {
    if (entry.finished) return;
    entry.finished = true;
    this.requests.delete(requestId);
    entry.owner.signal.removeEventListener("abort", entry.onAbort);
    entry.wake?.();
    entry.wake = null;
    void entry.owner.release();
  }
}
