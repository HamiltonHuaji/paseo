import { Worker } from "node:worker_threads";
import {
  encodeEncryptedFrame,
  type EncryptedFrameEncoder,
  type EncryptedFrameRequest,
} from "@getpaseo/relay/e2ee";

const LARGE_FRAME_BYTES = 1024 * 1024;

export type RelayFrameWorkerRequest = Omit<EncryptedFrameRequest, "signal"> & { id: number };
export type RelayFrameWorkerResponse =
  | { id: number; data: string | ArrayBuffer }
  | { id: number; error: string };

interface PendingFrame {
  id: number;
  request: EncryptedFrameRequest;
  resolve: (data: string | ArrayBuffer) => void;
  reject: (error: Error) => void;
  onAbort: () => void;
}

/** One copied worker job at a time; waiting callers retain their existing send payload. */
export class RelayFrameEncoder {
  private worker: Worker | null = null;
  private active: PendingFrame | null = null;
  private readonly pending: PendingFrame[] = [];
  private nextId = 0;
  private stopped = false;
  private terminating: Promise<void> | null = null;
  private mustRetire = false;
  private closing: Promise<void> | null = null;

  readonly encode: EncryptedFrameEncoder = (request) => {
    if (this.stopped) throw new Error("Relay frame encoder closed");
    request.signal.throwIfAborted();
    const bytes =
      typeof request.data === "string" ? Buffer.byteLength(request.data) : request.data.byteLength;
    if (bytes < LARGE_FRAME_BYTES) {
      return encodeEncryptedFrame(request.sharedKey, request.data, request.binaryCiphertext);
    }
    return new Promise((resolve, reject) => {
      const job: PendingFrame = {
        id: ++this.nextId,
        request,
        resolve,
        reject,
        onAbort: () => this.cancel(job),
      };
      request.signal.addEventListener("abort", job.onAbort, { once: true });
      this.pending.push(job);
      if (request.signal.aborted) this.cancel(job);
      else this.pump();
    });
  };

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopped = true;
    const error = new Error("Relay frame encoder closed");
    if (this.active) this.finish(this.active, error);
    for (const job of this.pending.splice(0)) this.finish(job, error);
    const closing = this.terminateWorker();
    this.closing = closing;
    void closing.catch(() => {
      if (this.closing === closing) this.closing = null;
    });
    return closing;
  }

  private finish(job: PendingFrame, error?: Error, data?: string | ArrayBuffer): void {
    job.request.signal.removeEventListener("abort", job.onAbort);
    if (this.active === job) this.active = null;
    if (error) job.reject(error);
    else if (data !== undefined) job.resolve(data);
  }

  private cancel(job: PendingFrame): void {
    const error =
      job.request.signal.reason instanceof Error
        ? job.request.signal.reason
        : new Error("Relay frame encoding cancelled");
    if (this.active === job) {
      this.finish(job, error);
      // Stop CPU work and release its large buffers before admitting the next job.
      this.retireWorker();
    } else {
      const index = this.pending.indexOf(job);
      if (index !== -1) this.pending.splice(index, 1);
      this.finish(job, error);
    }
  }

  private pump(): void {
    if (this.stopped || this.active || this.terminating) return;
    if (this.mustRetire) {
      this.retireWorker();
      return;
    }
    const job = this.pending.shift();
    if (!job) {
      this.worker?.unref();
      return;
    }
    this.active = job;
    try {
      const worker = this.worker ?? this.startWorker();
      worker.ref();
      // Do not transfer the caller's ArrayBuffer: it may also belong to a client replica.
      const { data, sharedKey, binaryCiphertext } = job.request;
      worker.postMessage(
        {
          id: job.id,
          data,
          sharedKey,
          binaryCiphertext,
        } satisfies RelayFrameWorkerRequest,
        [],
      );
    } catch (error) {
      this.finish(
        job,
        error instanceof Error ? error : new Error("Cannot start relay frame encoder"),
      );
      this.retireWorker();
    }
  }

  private startWorker(): Worker {
    const source = import.meta.url.endsWith(".ts");
    const worker = new Worker(
      new URL(
        source ? "./relay-frame-encoder-worker.ts" : "./relay-frame-encoder-worker.js",
        import.meta.url,
      ),
      {
        execArgv: source ? ["--experimental-strip-types"] : [],
      },
    );
    this.worker = worker;
    worker.on("message", (message: RelayFrameWorkerResponse) => {
      if (this.worker !== worker || this.mustRetire) return;
      const job = this.active;
      if (!job || message.id !== job.id) return;
      if ("error" in message) this.finish(job, new Error(message.error));
      else this.finish(job, undefined, message.data);
      this.pump();
    });
    worker.on("error", (error) => {
      if (this.worker !== worker || this.mustRetire) return;
      if (this.active) this.finish(this.active, error);
      this.retireWorker();
    });
    worker.on("exit", (code) => {
      if (this.worker !== worker || this.terminating) return;
      this.worker = null;
      this.mustRetire = false;
      if (this.active) this.finish(this.active, new Error(`Relay frame encoder exited (${code})`));
      this.pump();
    });
    return worker;
  }

  private retireWorker(): void {
    // Failed retirement rejects queued sends and retains the handle for close/retry.
    void this.terminateWorker().catch(() => {});
  }

  private terminateWorker(): Promise<void> {
    if (this.terminating) return this.terminating;
    const worker = this.worker;
    if (!worker) {
      queueMicrotask(() => this.pump());
      return Promise.resolve();
    }
    this.mustRetire = true;
    const terminating = Promise.resolve()
      .then(() => worker.terminate())
      .then(() => {
        if (this.worker === worker) this.worker = null;
        this.mustRetire = false;
        return undefined;
      });
    this.terminating = terminating;
    void terminating.then(
      () => {
        if (this.terminating === terminating) this.terminating = null;
        this.pump();
        return undefined;
      },
      (error: unknown) => {
        if (this.terminating === terminating) this.terminating = null;
        const failure =
          error instanceof Error ? error : new Error("Cannot stop relay frame encoder");
        for (const job of this.pending.splice(0)) this.finish(job, failure);
      },
    );
    return terminating;
  }
}
