import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

interface Range {
  start: number;
  end: number;
}
const DELIMITERS = [
  { open: "\\[", close: "\\]", display: true },
  { open: "\\(", close: "\\)", display: false },
  { open: "$$", close: "$$", display: true },
  { open: "$", close: "$", display: false },
] as const;
function codeRanges(source: string): Range[] {
  const ranges: Range[] = [];
  function visit(node: Nodes) {
    if (
      ["code", "inlineCode", "link", "image", "definition"].includes(node.type) &&
      node.position
    ) {
      ranges.push({ start: node.position.start.offset!, end: node.position.end.offset! });
    } else if ("children" in node) node.children.forEach(visit);
  }
  visit(fromMarkdown(source));
  return ranges;
}
function formulaAt(
  source: string,
  start: number,
  marker: (typeof DELIMITERS)[number],
  ranges: Range[],
) {
  let end = source.indexOf(marker.close, start + marker.open.length);
  while (end >= 0 && source[end - 1] === "\\")
    end = source.indexOf(marker.close, end + marker.close.length);
  if (end < 0 || ranges.some((range) => range.start > start && range.start < end)) return null;
  const content = source.slice(start + marker.open.length, end);
  if (!content.trim()) return null;
  if (
    !marker.display &&
    (/\n|^\s|\s$/.test(content) || /\d/.test(source[end + marker.close.length] ?? ""))
  )
    return null;
  const delimiter = marker.display ? "$$" : "$";
  return { end: end + marker.close.length, text: `${delimiter}${content}${delimiter}` };
}
/** Keep currency and unfinished formula delimiters literal across streamed updates. */
export function normalizeMarkdownMath(source: string): string {
  if (!/[$\\]/.test(source)) return source;
  const ranges = codeRanges(source);
  let output = "";
  for (let i = 0; i < source.length; ) {
    const protectedRange = ranges.find((range) => range.start === i);
    if (protectedRange) {
      output += source.slice(i, protectedRange.end);
      i = protectedRange.end;
      continue;
    }
    const marker = DELIMITERS.find(({ open }) => source.startsWith(open, i));
    if (marker) {
      const formula = formulaAt(source, i, marker, ranges);
      if (formula) {
        output += formula.text;
        i = formula.end;
        continue;
      }
      output += marker.open.startsWith("$")
        ? marker.open.replaceAll("$", "\\$")
        : `\\${marker.open}`;
      i += marker.open.length;
      continue;
    }
    const width = source[i] === "\\" && i + 1 < source.length ? 2 : 1;
    output += source.slice(i, i + width);
    i += width;
  }
  return output;
}
