import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

interface Range {
  start: number;
  end: number;
  fenced: boolean;
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
      const start = node.position.start.offset!;
      ranges.push({
        start,
        end: node.position.end.offset!,
        fenced: node.type === "code" && /^[ \t]*(`{3,}|~{3,})/.test(source.slice(start)),
      });
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
  if (
    end < 0 ||
    ranges.some(
      (range) => range.start > start && range.start < end && (!marker.display || range.fenced),
    )
  )
    return null;
  let content = source.slice(start + marker.open.length, end);
  if (marker.display) {
    const prefix = source.slice(source.lastIndexOf("\n", start - 1) + 1, start);
    const quoteDepth = prefix.match(/>/g)?.length ?? 0;
    if (quoteDepth && /^[ \t>]*$/.test(prefix)) {
      content = content.replace(new RegExp(`\\n[ \t]*(?:>[ \t]*){${quoteDepth}}`, "g"), "\n");
    }
  }
  if (!content.trim()) return null;
  if (
    !marker.display &&
    (/\n|^\s|\s$/.test(content) || /\d/.test(source[end + marker.close.length] ?? ""))
  )
    return null;
  const delimiter = marker.display ? "$$" : "$";
  const normalized = marker.display ? compactDisplayMath(content) : content;
  return {
    end: end + marker.close.length,
    text: `${delimiter}${normalized}${delimiter}`,
    normalized,
    content,
  };
}
/** Keep currency and unfinished formula delimiters literal across streamed updates. */
export function normalizeMarkdownMath(
  source: string,
  onFormula?: (normalized: string, original: string, start: number, end: number) => void,
): string {
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
        onFormula?.(
          formula.normalized,
          formula.content,
          output.length,
          output.length + formula.text.length,
        );
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

// MD4C recognizes math spans after Markdown blocks. A physical newline can otherwise
// turn TeX's "=" / "+" / blank lines into headings, lists or separate paragraphs.
function compactDisplayMath(content: string): string {
  let output = "";
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === "\\" && i + 1 < content.length) output += char + content[++i];
    else if (char === "%") {
      // TeX comments consume their newline. Escaped percent signs were handled above.
      while (i < content.length && content[i] !== "\n") i++;
    } else output += char === "\n" || char === "\r" ? " " : char;
  }
  return output;
}
