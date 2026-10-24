import type {
  FetchAgentTimelineCursor,
  FetchAgentTimelineOptions,
  FetchAgentTimelinePayload,
} from "./daemon-client.js";

const PAGE_SIZE = 200;
// Older hosts can spend several minutes restoring a writer before their first
// bounded read. This patience does not change new-host interaction budgets.
export const HISTORY_REQUEST_TIMEOUT_MS = 900_000;

function pageLimit(remaining: number): number {
  return Math.min(remaining, PAGE_SIZE);
}

function remainingTime(deadline: number | null, timeout: number): number {
  if (deadline === null) return timeout;
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Timed out while reading complete history");
  return remaining;
}

function hasMore(page: FetchAgentTimelinePayload, backwards: boolean): boolean {
  return backwards ? page.hasOlder : page.hasNewer;
}

function continuation(page: FetchAgentTimelinePayload, backwards: boolean) {
  return backwards ? page.startCursor : page.endCursor;
}

function checkContinuation(
  page: FetchAgentTimelinePayload,
  cursor: FetchAgentTimelineCursor,
  backwards: boolean,
): void {
  if (page.epoch !== cursor.epoch || page.reset) {
    throw new Error("History changed while reading; retry the request");
  }
  if (!hasMore(page, backwards)) return;
  const next = continuation(page, backwards);
  if (
    !next ||
    next.epoch !== cursor.epoch ||
    (backwards ? next.seq >= cursor.seq : next.seq <= cursor.seq)
  ) {
    throw new Error("Host returned history without advancing its cursor");
  }
}

function extendWindow(
  result: FetchAgentTimelinePayload,
  page: FetchAgentTimelinePayload,
  backwards: boolean,
): FetchAgentTimelinePayload {
  return {
    ...result,
    agent: page.agent,
    startCursor: backwards ? (page.startCursor ?? result.startCursor) : result.startCursor,
    endCursor: backwards ? result.endCursor : (page.endCursor ?? result.endCursor),
    hasOlder: backwards ? page.hasOlder : result.hasOlder,
    hasNewer: backwards ? result.hasNewer : page.hasNewer,
    window: {
      minSeq: Math.min(result.window.minSeq, page.window.minSeq),
      maxSeq: Math.max(result.window.maxSeq, page.window.maxSeq),
      nextSeq: Math.max(result.window.nextSeq, page.window.nextSeq),
    },
  };
}

// Full reads keep their public result shape, while each wire request is bounded.
// This also works with older hosts and avoids their relay/client message limits.
export async function fetchTimelinePages(
  fetchPage: (options: FetchAgentTimelineOptions) => Promise<FetchAgentTimelinePayload>,
  options: FetchAgentTimelineOptions,
): Promise<FetchAgentTimelinePayload> {
  const direction = options.direction ?? (options.cursor ? "after" : "tail");
  const limit = options.limit ?? (direction === "after" ? 0 : PAGE_SIZE);
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error("History limit must be a nonnegative integer");
  }
  const timeout = options.timeout ?? HISTORY_REQUEST_TIMEOUT_MS;
  if (limit > 0 && limit <= PAGE_SIZE) return fetchPage({ ...options, timeout });

  const deadline = timeout > 0 ? Date.now() + timeout : null;
  let remaining = limit === 0 ? Number.POSITIVE_INFINITY : limit;
  let page = await fetchPage({ ...options, timeout, limit: pageLimit(remaining) });
  const backwards = direction !== "after" || page.reset;
  const pages = [page.entries];
  let result = page;
  remaining -= page.entries.length;
  while (hasMore(page, backwards) && remaining > 0) {
    const cursor = continuation(page, backwards);
    if (!cursor) throw new Error("Host returned history without a continuation cursor");
    const timeRemaining = remainingTime(deadline, timeout);
    page = await fetchPage({
      ...options,
      requestId: undefined,
      direction: backwards ? "before" : "after",
      cursor,
      limit: pageLimit(remaining),
      timeout: timeRemaining,
    });
    checkContinuation(page, cursor, backwards);
    pages.push(page.entries);
    remaining -= page.entries.length;
    result = extendWindow(result, page, backwards);
  }
  return { ...result, entries: (backwards ? pages.toReversed() : pages).flat() };
}
