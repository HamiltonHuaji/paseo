import { request, type ClientRequest, type IncomingMessage } from "node:http";
import {
  encodeViewerHttpFrame,
  ViewerHttpOpcode,
  type ViewerHttpFrame,
} from "@getpaseo/protocol/binary-frames/index";
import type { OwnedOperation } from "../session/owned-subscriptions/index.js";
import type { ServiceProxySubsystem } from "../service-proxy.js";

const BODY_CHUNK_BYTES = 64 * 1024;
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
  resume: (() => void) | null;
  started: boolean;
  finished: boolean;
  cancelled: boolean;
  onAbort: () => void;
}

export class ViewerHttpRequestCancelledError extends Error {
  constructor() {
    super("Viewer HTTP request cancelled");
    this.name = "ViewerHttpRequestCancelledError";
  }
}

export class ViewerHttpController {
  private readonly requests = new Map<string, ActiveRequest>();

  constructor(private readonly serviceProxy: ServiceProxySubsystem | null) {}

  async open(
    input: ViewerRequest,
    owner: OwnedOperation,
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
      paused: true,
      resume: null,
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
    } else if (frame.opcode === ViewerHttpOpcode.Pause) {
      entry.paused = true;
    } else if (frame.opcode === ViewerHttpOpcode.Resume) {
      entry.paused = false;
      entry.resume?.();
      entry.resume = null;
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
    try {
      for await (const chunk of response) {
        const data = chunk as Buffer;
        for (let offset = 0; offset < data.length; offset += BODY_CHUNK_BYTES) {
          await this.waitUntilResumed(entry);
          if (entry.finished) return;
          await entry.owner.emitBinary(
            encodeViewerHttpFrame({
              opcode: ViewerHttpOpcode.Data,
              requestId,
              payload: data.subarray(offset, offset + BODY_CHUNK_BYTES),
            }),
          );
        }
      }
      await this.waitUntilResumed(entry);
      if (!entry.finished) {
        await entry.owner.emitBinary(
          encodeViewerHttpFrame({ opcode: ViewerHttpOpcode.End, requestId }),
        );
      }
    } catch {
      if (!entry.finished) {
        await this.waitUntilResumed(entry);
      }
      if (!entry.finished) {
        await entry.owner
          .emitBinary(encodeViewerHttpFrame({ opcode: ViewerHttpOpcode.Reset, requestId }))
          .catch(() => undefined);
      }
    } finally {
      this.finish(requestId, entry);
    }
  }

  private async waitUntilResumed(entry: ActiveRequest): Promise<void> {
    if (!entry.paused || entry.finished) return;
    await new Promise<void>((resolve) => {
      entry.resume = resolve;
    });
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
    entry.resume?.();
    entry.resume = null;
    void entry.owner.release();
  }
}
