import { createServer, type ServerResponse } from "node:http";
import type { DaemonClient } from "../daemon-client.js";
import type { ViewerHttpStream } from "../viewer-http-stream.js";

export interface LocalViewerHttpProxy {
  readonly origin: string;
  close(): Promise<void>;
}

type ViewerResponse = Awaited<ReturnType<DaemonClient["fetchViewerHttp"]>> & {
  onData?: (bytes: number) => void;
};

const REQUEST_HEADERS = [
  "accept",
  "cache-control",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "range",
] as const;

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out/i.test(message) ? 504 : 502;
}

function sendProxyError(res: ServerResponse, status: number): void {
  if (res.destroyed) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(status === 504 ? "Viewer request timed out" : "Viewer is temporarily unavailable");
}

export async function createLocalViewerHttpProxy(input: {
  fetch: (request: {
    method: "GET" | "HEAD";
    path: string;
    headers: Record<string, string>;
    signal: AbortSignal;
  }) => Promise<ViewerResponse>;
  onRequestError?: (error: unknown) => void;
  host?: string;
  port?: number;
}): Promise<LocalViewerHttpProxy> {
  const host = input.host ?? "127.0.0.1";
  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    const method = req.method;
    const path = req.url ?? "/";
    if (path !== "/" && !path.startsWith("/view/")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const headers: Record<string, string> = {};
    for (const name of REQUEST_HEADERS) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const cancellation = new AbortController();
    let stream: ViewerHttpStream | null = null;
    let completed = false;
    let waitingForDrain = false;
    let pendingConsumedBytes = 0;
    const reportError = (error: unknown) => {
      try {
        input.onRequestError?.(error);
      } catch {
        // Diagnostic failures must not interrupt the local HTTP listener.
      }
    };
    const cancelStream = () => {
      try {
        stream?.cancel();
      } catch {
        stream?.abort();
      }
    };
    const onClose = () => {
      if (completed) return;
      completed = true;
      cancellation.abort();
      cancelStream();
    };
    res.once("close", onClose);
    void (async () => {
      try {
        const upstream = await input.fetch({
          method,
          path,
          headers,
          signal: cancellation.signal,
        });
        stream = upstream.stream;
        if (cancellation.signal.aborted || res.destroyed) {
          onClose();
          // The browser may have gone away while response headers were in flight.
          // onClose already ran then, before this stream existed.
          cancelStream();
          return;
        }
        const writeHeaders = () => {
          if (!res.headersSent) res.writeHead(upstream.status, upstream.headers);
        };
        stream.setHandlers({
          onData: (data) => {
            try {
              upstream.onData?.(data.byteLength);
              writeHeaders();
              if (!res.write(Buffer.from(data)) || waitingForDrain) {
                pendingConsumedBytes += data.byteLength;
                if (!waitingForDrain) {
                  waitingForDrain = true;
                  stream?.pause();
                  res.once("drain", () => {
                    waitingForDrain = false;
                    if (completed) return;
                    try {
                      stream?.consumed(pendingConsumedBytes);
                      pendingConsumedBytes = 0;
                      stream?.resume();
                    } catch (error) {
                      reportError(error);
                      onClose();
                      res.destroy();
                    }
                  });
                }
              } else {
                stream?.consumed(data.byteLength);
              }
            } catch (error) {
              reportError(error);
              onClose();
              res.destroy();
            }
          },
          onEnd: () => {
            completed = true;
            try {
              writeHeaders();
              res.end();
            } catch (error) {
              reportError(error);
              res.destroy();
            }
          },
          onReset: () => {
            completed = true;
            reportError(new Error(`Viewer HTTP stream reset: ${path}`));
            sendProxyError(res, 502);
          },
        });
      } catch (error) {
        if (cancellation.signal.aborted || res.destroyed) return;
        completed = true;
        reportError(error);
        sendProxyError(res, errorStatus(error));
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Viewer HTTP proxy did not bind a TCP port");
  }
  return {
    origin: `http://${host}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}
