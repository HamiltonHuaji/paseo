import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

interface VerticalTabLabelInput {
  key: string;
  kind: WorkspaceTabDescriptor["kind"];
  label: string;
  ready: boolean;
}

interface ParsedVerticalTabLabel extends VerticalTabLabelInput {
  segments: string[];
}

export interface VerticalTabLabelPresentation {
  pathPrefix: string;
  label: string;
}

function parseEligiblePath(input: VerticalTabLabelInput): ParsedVerticalTabLabel | null {
  if (!input.ready || (input.kind !== "agent" && input.kind !== "terminal")) return null;
  const segments = input.label.split("/");
  if (segments.length < 2 || segments.some((segment) => segment.length === 0)) return null;
  return { ...input, segments };
}

function pathKey(segments: readonly string[]): string {
  return JSON.stringify(segments);
}

export function buildVerticalTabLabelPresentations(
  inputs: readonly VerticalTabLabelInput[],
): ReadonlyMap<string, VerticalTabLabelPresentation> {
  const parsed = inputs.flatMap((input) => {
    const path = parseEligiblePath(input);
    return path ? [path] : [];
  });
  const prefixCounts = new Map<string, number>();
  const leafCounts = new Map<string, number>();

  for (const item of parsed) {
    const leaf = item.segments.at(-1)!;
    leafCounts.set(leaf, (leafCounts.get(leaf) ?? 0) + 1);
    for (let depth = 1; depth < item.segments.length; depth += 1) {
      const key = pathKey(item.segments.slice(0, depth));
      prefixCounts.set(key, (prefixCounts.get(key) ?? 0) + 1);
    }
  }

  const presentations = new Map<string, VerticalTabLabelPresentation>();
  for (const item of parsed) {
    let prefixDepth = 0;
    for (let depth = 1; depth < item.segments.length; depth += 1) {
      if ((prefixCounts.get(pathKey(item.segments.slice(0, depth))) ?? 0) >= 2) {
        prefixDepth = depth;
      }
    }
    if (prefixDepth === 0 && (leafCounts.get(item.segments.at(-1)!) ?? 0) >= 2) {
      prefixDepth = item.segments.length - 1;
    }
    if (prefixDepth === 0) continue;

    presentations.set(item.key, {
      pathPrefix: `${item.segments.slice(0, prefixDepth).join("/")}/`,
      label: item.segments.slice(prefixDepth).join("/"),
    });
  }
  return presentations;
}
