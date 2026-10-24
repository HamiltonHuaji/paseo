// Install counts live in the website KV. The all-time counter predates the daily record and
// stays the "All time" number; the daily record keeps the last 60 days for the shorter windows.
export type InstallWindow = "week" | "month" | "all";
export type InstallCounts = Record<InstallWindow, number>;
/** UTC day (YYYY-MM-DD) to installs that day. */
export type DailyInstalls = Record<string, number>;

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_KEPT = 60;
const WINDOW_DAYS = { week: 7, month: 30 } as const;

const totalKey = (id: string) => `plugin-installs:${id}`;
const dailyKey = (id: string) => `plugin-installs-daily:${id}`;

export async function recordClientInstall({
  cache,
  id,
  ip,
}: {
  cache: KVNamespace;
  id: string;
  ip: string | null;
}): Promise<void> {
  if (!ip) return;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const key = `plugin-installs-client:${id}:${hash}`;
  if ((await cache.get(key)) !== null) return;
  await recordInstall(cache, id, new Date());
  await cache.put(key, "1", { expirationTtl: 3600 });
}

export async function recordInstall(cache: KVNamespace, id: string, now: Date): Promise<void> {
  const [total, daily] = await Promise.all([cache.get(totalKey(id)), readDaily(cache, id)]);
  const nextTotal = parseTotal(total, id) + 1;
  if (!Number.isSafeInteger(nextTotal)) throw new Error(`Invalid saved ${totalKey(id)}`);
  const nextDaily = addInstall(daily, now);
  await Promise.all([
    cache.put(totalKey(id), String(nextTotal)),
    cache.put(dailyKey(id), JSON.stringify(nextDaily)),
  ]);
}

export async function readInstallCounts(
  cache: KVNamespace | null,
  ids: string[],
  now: Date,
): Promise<Record<string, InstallCounts>> {
  const entries = await Promise.all(
    ids.map(async (id) => {
      if (!cache) return [id, countInstalls({}, 0, now)] as const;
      const [total, daily] = await Promise.all([cache.get(totalKey(id)), readDaily(cache, id)]);
      return [id, countInstalls(daily, parseTotal(total, id), now)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function addInstall(daily: DailyInstalls, now: Date): DailyInstalls {
  const oldest = utcDay(now, DAYS_KEPT - 1);
  const kept = Object.fromEntries(Object.entries(daily).filter(([day]) => day >= oldest));
  const today = utcDay(now, 0);
  kept[today] = (kept[today] ?? 0) + 1;
  if (!Number.isSafeInteger(kept[today])) throw new Error("Invalid saved daily install count");
  return kept;
}

export function countInstalls(daily: DailyInstalls, total: number, now: Date): InstallCounts {
  return {
    week: installsSince(daily, utcDay(now, WINDOW_DAYS.week - 1)),
    month: installsSince(daily, utcDay(now, WINDOW_DAYS.month - 1)),
    all: total,
  };
}

function installsSince(daily: DailyInstalls, oldest: string): number {
  return Object.entries(daily).reduce(
    (sum, [day, count]) => (day >= oldest ? sum + count : sum),
    0,
  );
}

function utcDay(now: Date, daysBefore: number): string {
  return new Date(now.getTime() - daysBefore * DAY_MS).toISOString().slice(0, 10);
}

async function readDaily(cache: KVNamespace, id: string): Promise<DailyInstalls> {
  const text = await cache.get(dailyKey(id));
  if (text === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Invalid saved ${dailyKey(id)}; original data was retained`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid saved ${dailyKey(id)}; original data was retained`);
  }
  const entries = Object.entries(value);
  if (!entries.every(isDailyEntry)) {
    throw new Error(`Unsupported saved ${dailyKey(id)}; original data was retained`);
  }
  return Object.fromEntries(entries);
}

function isDailyEntry(entry: [string, unknown]): entry is [string, number] {
  const [day, count] = entry;
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day &&
    typeof count === "number" &&
    Number.isSafeInteger(count) &&
    count >= 0
  );
}

function parseTotal(value: string | null, id: string): number {
  if (value === null) return 0;
  const count = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid saved ${totalKey(id)}; original data was retained`);
  }
  return count;
}
