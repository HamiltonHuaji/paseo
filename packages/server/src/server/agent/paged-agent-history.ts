import type { AgentHistoryReader } from "./agent-sdk-types.js";
import type { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
} from "./agent-timeline-store-types.js";
import { limitAgentTimelineItemContent } from "./agent-timeline-content.js";
import { projectAgentMessages } from "./agent-messages/index.js";

// Positions belong to an epoch, not to the provider's total item count. Leave
// space on both sides so loading older pages never renumbers a visible anchor.
const HISTORY_ORIGIN = 2 ** 48;

interface PendingHistoryPage {
  controller: AbortController;
  promise: Promise<void>;
}

export class PagedAgentHistory {
  private reader: Promise<AgentHistoryReader> | null = null;
  private retiringReader: Promise<AgentHistoryReader> | null = null;
  private closingReader: Promise<void> | null = null;
  private pending: PendingHistoryPage | null = null;
  private closed = false;
  private waiters = 0;
  private cursor: string | undefined;
  private complete = false;
  private initialized = false;
  private minSeq = HISTORY_ORIGIN;
  private pendingRows: AgentTimelineRow[][] = [];
  private pendingRowCount = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  readonly epoch: string;

  constructor(
    private readonly agentId: string,
    private readonly store: InMemoryAgentTimelineStore,
    private readonly open: (signal: AbortSignal) => Promise<AgentHistoryReader>,
    private readonly timestamp: string,
  ) {
    store.initialize(agentId, { nextSeq: HISTORY_ORIGIN });
    this.epoch = store.getEpoch(agentId);
  }

  isCurrent(): boolean {
    return this.store.has(this.agentId) && this.store.getEpoch(this.agentId) === this.epoch;
  }

  get closedForReads(): boolean {
    return this.closed;
  }

  get idle(): boolean {
    return this.waiters === 0 && !this.pending && !this.retiringReader;
  }

  async fetch(
    options: AgentTimelineFetchOptions = {},
    signal?: AbortSignal,
  ): Promise<AgentTimelineFetchResult> {
    signal?.throwIfAborted();
    this.assertReadable();
    this.waiters += 1;
    clearTimeout(this.idleTimer);
    try {
      return await this.fetchPages(options, signal);
    } finally {
      this.waiters -= 1;
      if (this.waiters === 0) {
        if (this.pending) {
          this.pending.controller.abort();
          void this.closeReader();
        } else if (!this.closed) {
          this.idleTimer = setTimeout(() => {
            void this.closeReader();
          }, 5_000);
          this.idleTimer.unref();
        }
      }
    }
  }

  private async fetchPages(
    options: AgentTimelineFetchOptions,
    signal?: AbortSignal,
  ): Promise<AgentTimelineFetchResult> {
    let page: AgentTimelineFetchResult | undefined;
    let revision: number | undefined;
    for (;;) {
      signal?.throwIfAborted();
      this.assertReadable();
      const currentRevision = this.store.getRevision(this.agentId);
      if (!page || revision !== currentRevision) {
        page = this.store.fetch(this.agentId, options);
        revision = currentRevision;
      }
      const { all, limit, needsOlder, needsCursorHistory } = this.getPageProgress(options, page);
      // Native turn pages can contain very few visible rows. Reproject the
      // committed cache only once enough new rows could fill this request,
      // including one older row to resolve a merge across its boundary.
      const pendingCouldFillPage = needsCursorHistory
        ? options.cursor !== undefined && this.minSeq <= options.cursor.seq
        : this.pendingRowCount >= Math.max(1, limit - page.rows.length + 1);
      if (
        this.pendingRows.length &&
        (this.complete || (!all && needsOlder && pendingCouldFillPage))
      ) {
        this.commit();
        continue;
      }
      if (!needsOlder) return { ...page, hasOlder: page.hasOlder || !this.complete };
      await this.waitForPage(signal);
    }
  }

  private getPageProgress(options: AgentTimelineFetchOptions, page: AgentTimelineFetchResult) {
    const all = options.limit === 0;
    const limit = options.limit ?? 200;
    const committedMinSeq = page.window.minSeq || HISTORY_ORIGIN;
    const needsCursorHistory =
      options.direction === "after" &&
      !page.staleCursor &&
      (!options.cursor || options.cursor.seq < committedMinSeq);
    const selectsTail = options.direction !== "after" || page.staleCursor;
    const touchesOldestRow = page.rows.length < limit || page.startSeq === committedMinSeq;
    const needsOlder =
      !this.initialized ||
      (!this.complete && (all || needsCursorHistory || (selectsTail && touchesOldestRow)));
    return { all, limit, needsOlder, needsCursorHistory };
  }

  private async waitForPage(signal?: AbortSignal): Promise<void> {
    if (!this.pending) {
      const controller = new AbortController();
      const operation = { controller, promise: this.readPage(controller.signal) };
      this.pending = operation;
      void operation.promise
        .finally(() => {
          if (this.pending === operation) this.pending = null;
        })
        .catch(() => {});
    }
    const pending = this.pending;
    try {
      if (!signal) return await pending.promise;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          signal.removeEventListener("abort", abort);
          reject(signal.reason);
        };
        signal.addEventListener("abort", abort, { once: true });
        pending.promise.then(
          () => {
            signal.removeEventListener("abort", abort);
            return resolve();
          },
          (error) => {
            signal.removeEventListener("abort", abort);
            reject(error);
          },
        );
        if (signal.aborted) abort();
      });
    } catch (error) {
      // A replacement reader may arrive while the last abandoned read is still
      // closing. It waits for that cleanup, then starts its own page operation.
      if (pending.controller.signal.aborted && !signal?.aborted && !this.closed) return;
      throw error;
    }
  }

  private async readPage(signal: AbortSignal): Promise<void> {
    // A failed close keeps ownership of the old helper. Confirm its exit before
    // opening a replacement, including after an abandoned request is retried.
    if (this.retiringReader) await this.closeReader();
    try {
      signal.throwIfAborted();
      this.assertReadable();
      this.reader ??= this.open(signal);
      const reader = await this.reader;
      signal.throwIfAborted();
      const page = await reader.readBefore(this.cursor, signal);
      signal.throwIfAborted();
      this.assertReadable();
      if (page.nextCursor && page.nextCursor === this.cursor)
        throw new Error("Provider repeated a history cursor");
      const entries = page.entries.flatMap((entry) =>
        projectAgentMessages(entry.item).map((item) => Object.assign({}, entry, { item })),
      );
      const firstSeq = this.minSeq - entries.length;
      this.pendingRowCount += entries.length;
      this.pendingRows.unshift(
        entries.map((entry, index) =>
          Object.assign({}, entry, {
            seq: firstSeq + index,
            item: limitAgentTimelineItemContent(entry.item),
            timestamp: entry.timestamp ?? this.timestamp,
          }),
        ),
      );
      this.minSeq = firstSeq;
      this.cursor = page.nextCursor ?? undefined;
      this.complete = page.nextCursor === null;
      this.initialized = true;
    } catch (error) {
      if (this.reader) await this.closeReader();
      else if (this.closingReader) await this.closingReader;
      throw error;
    }
  }

  private commit(): void {
    if (!this.pendingRows.length) return;
    this.assertReadable();
    const current = this.store.fetch(this.agentId, { limit: 0 });
    this.store.initialize(this.agentId, {
      epoch: this.epoch,
      nextSeq: current.window.nextSeq,
      rows: [...this.pendingRows.flat(), ...current.rows],
    });
    this.pendingRows = [];
    this.pendingRowCount = 0;
  }

  private closeReader(): Promise<void> {
    if (this.closingReader) return this.closingReader;
    const reader = this.retiringReader ?? this.reader;
    if (!reader) return Promise.resolve();
    this.reader = null;
    this.retiringReader = reader;
    const closing = reader.then(
      (value) => value.close(),
      () => undefined,
    );
    this.closingReader = closing;
    void closing.then(
      () => {
        this.retiringReader = null;
        this.closingReader = null;
        return undefined;
      },
      () => {
        // Retain a helper whose termination failed so close() or the next read
        // can retry; the failed attempt still rejects its explicit callers.
        this.closingReader = null;
      },
    );
    return closing;
  }

  private assertReadable(): void {
    if (this.closed) throw new Error("History reader is closed");
    if (!this.isCurrent())
      throw new Error("History changed while loading; retry the timeline request");
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.idleTimer);
    this.pending?.controller.abort();
    await Promise.all([this.closeReader(), this.pending?.promise.catch(() => {})]);
  }
}
