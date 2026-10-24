function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Apply understood edits without rewriting fields omitted by a persisted-record parser. */
export function mergePersistedRecord(
  raw: unknown,
  previous: unknown,
  next: unknown,
  arrayItemKey: string | ((value: Record<string, unknown>) => unknown) = "id",
): unknown {
  if (JSON.stringify(previous) === JSON.stringify(next)) return raw;
  // A newly understood object can already contain fields from a newer writer.
  if (previous === undefined && isObject(raw) && isObject(next)) previous = {};
  if (Array.isArray(raw) && Array.isArray(previous) && Array.isArray(next)) {
    const remaining = new Set(previous.map((_, index) => index));
    const itemKey = (value: Record<string, unknown>) =>
      typeof arrayItemKey === "string" ? value[arrayItemKey] : arrayItemKey(value);
    return next.map((value) => {
      const key = isObject(value) ? itemKey(value) : undefined;
      const matches = [...remaining].filter((index) => {
        const old: unknown = previous[index];
        return key !== undefined && isObject(old)
          ? JSON.stringify(itemKey(old)) === JSON.stringify(key)
          : JSON.stringify(old) === JSON.stringify(value);
      });
      if (matches.length === 0) return value;
      const index = matches[0]!;
      remaining.delete(index);
      return mergePersistedRecord(raw[index], previous[index], value, arrayItemKey);
    });
  }
  if (!isObject(raw) || !isObject(previous) || !isObject(next)) return next;
  const result = { ...raw };
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (!Object.hasOwn(next, key)) {
      delete result[key];
    } else {
      // Define rather than assign: arbitrary JSON dictionaries can contain __proto__.
      Object.defineProperty(result, key, {
        value: mergePersistedRecord(raw[key], previous[key], next[key], arrayItemKey),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return result;
}
