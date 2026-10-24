import equal from "fast-deep-equal/es6";
import { z } from "zod";

export function isStoredObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeyPaths(issues: readonly z.core.$ZodIssue[]): PropertyKey[][] {
  const paths: PropertyKey[][] = [];
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) paths.push([...issue.path, key]);
    } else if (issue.code === "invalid_union") {
      for (const branch of issue.errors) {
        for (const path of unknownKeyPaths(branch)) paths.push([...issue.path, ...path]);
      }
    }
  }
  return paths;
}

function unknownUnionFields(branches: readonly (readonly z.core.$ZodIssue[])[]) {
  const unknownPaths = branches.map(unknownKeyPaths);
  for (const branch of branches) {
    const candidate = unknownFields(branch);
    if (candidate?.every((path) => unknownToEveryBranch(path, unknownPaths))) return candidate;
  }
  return null;
}

function unknownToEveryBranch(path: PropertyKey[], branches: PropertyKey[][][]): boolean {
  return branches.every((paths) =>
    paths.some(
      (unknown) =>
        unknown.length <= path.length && unknown.every((part, index) => path[index] === part),
    ),
  );
}

function unknownFields(issues: readonly z.core.$ZodIssue[]): PropertyKey[][] | null {
  const paths: PropertyKey[][] = [];
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) paths.push([...issue.path, key]);
    } else if (issue.code === "invalid_union") {
      // A permissive union alternative must not erase another branch's known
      // fields to manufacture a successful parse (for example a whole draft).
      const branch = unknownUnionFields(issue.errors);
      if (!branch) return null;
      for (const path of branch) paths.push([...issue.path, ...path]);
    } else return null;
  }
  return paths;
}

/** Read only understood fields. The storage owner keeps the original JSON for writes. */
export function parseStoredValue<Value>(
  schema: z.ZodType<Value>,
  raw: unknown,
  key: string,
): Value {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const paths = unknownFields(result.error.issues);
  if (paths?.length) {
    const projected: unknown = JSON.parse(JSON.stringify(raw));
    for (const path of paths) {
      let parent: unknown = projected;
      for (const segment of path.slice(0, -1)) {
        if (typeof parent !== "object" || parent === null) break;
        parent = Reflect.get(parent, segment);
      }
      if (typeof parent === "object" && parent !== null) {
        Reflect.deleteProperty(parent, path[path.length - 1]);
      }
    }
    const known = schema.safeParse(projected);
    if (known.success) return known.data;
  }
  throw new Error(`Cannot read saved ${key}; original data was retained`);
}

function matchingIndex(before: unknown[], item: unknown, index: number): number {
  if (isStoredObject(item)) {
    for (const key of ["id", "key"]) {
      if (typeof item[key] === "string")
        return before.findIndex((entry) => isStoredObject(entry) && entry[key] === item[key]);
    }
    if (typeof item.sourceId === "string" && typeof item.windowId === "string") {
      return before.findIndex(
        (entry) =>
          isStoredObject(entry) &&
          entry.sourceId === item.sourceId &&
          entry.windowId === item.windowId,
      );
    }
  }
  const unchanged = before.findIndex((entry) => equal(entry, item));
  return unchanged >= 0 ? unchanged : index;
}

/** Add a validated migration's fields without discarding fields it could not interpret. */
export function overlayStoredValue(raw: unknown, next: unknown): unknown {
  if (Array.isArray(raw) && Array.isArray(next)) {
    return next.map((item, index) =>
      overlayStoredValue(raw[matchingIndex(raw, item, index)], item),
    );
  }
  if (!isStoredObject(raw) || !isStoredObject(next)) return next;
  const merged = { ...raw };
  for (const key of Object.keys(next)) {
    Object.defineProperty(merged, key, {
      value: overlayStoredValue(raw[key], next[key]),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return merged;
}

/** Persist understood edits in the same document, retaining fields outside the reader's view. */
export function mergeStoredEdits(raw: unknown, before: unknown, after: unknown): unknown {
  if (equal(before, after)) return raw;
  if (Array.isArray(raw) && Array.isArray(before) && Array.isArray(after)) {
    return after.map((item, index) => {
      const previous = matchingIndex(before, item, index);
      return mergeStoredEdits(raw[previous], before[previous], item);
    });
  }
  if (!isStoredObject(raw) || !isStoredObject(before) || !isStoredObject(after)) return after;
  const merged = { ...raw };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Object.hasOwn(after, key)) delete merged[key];
    else
      Object.defineProperty(merged, key, {
        value: mergeStoredEdits(raw[key], before[key], after[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
  }
  return merged;
}
