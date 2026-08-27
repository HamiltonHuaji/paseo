import MarkdownIt from "markdown-it";

const markdownBlockParser = new MarkdownIt();

type MathBlockDelimiter = "$$" | "\\[";

function getMathBlockDelimiter(line: string): {
  delimiter: MathBlockDelimiter;
  contentStart: number;
} | null {
  const match = /^( {0,3})(\$\$|\\\[)/.exec(line);
  if (!match?.[2]) {
    return null;
  }

  return {
    delimiter: match[2] as MathBlockDelimiter,
    contentStart: match[0].length,
  };
}

function closesMathBlock(line: string, delimiter: MathBlockDelimiter, contentStart = 0): boolean {
  const closingDelimiter = delimiter === "$$" ? "$$" : "\\]";
  return line.trimEnd().slice(contentStart).endsWith(closingDelimiter);
}

function getFenceDelimiter(line: string): string | null {
  return /^(?: {0,3})(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
}

interface ActiveBlockDelimiterState {
  fenceCharacter: "`" | "~" | null;
  fenceLength: number;
  mathDelimiter: MathBlockDelimiter | null;
}

function advanceActiveBlockDelimiter(
  line: string,
  state: ActiveBlockDelimiterState,
): ActiveBlockDelimiterState {
  if (state.mathDelimiter) {
    return closesMathBlock(line, state.mathDelimiter) ? { ...state, mathDelimiter: null } : state;
  }

  const fenceDelimiter = getFenceDelimiter(line);
  if (fenceDelimiter) {
    if (!state.fenceCharacter) {
      return {
        ...state,
        fenceCharacter: fenceDelimiter[0] as "`" | "~",
        fenceLength: fenceDelimiter.length,
      };
    }
    return fenceDelimiter[0] === state.fenceCharacter && fenceDelimiter.length >= state.fenceLength
      ? { ...state, fenceCharacter: null, fenceLength: 0 }
      : state;
  }

  if (state.fenceCharacter) {
    return state;
  }

  const mathDelimiter = getMathBlockDelimiter(line);
  return mathDelimiter &&
    !closesMathBlock(line, mathDelimiter.delimiter, mathDelimiter.contentStart)
    ? { ...state, mathDelimiter: mathDelimiter.delimiter }
    : state;
}

export function splitMarkdownBlocks(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const blocks: string[] = [];
  let currentLines: string[] = [];
  let activeDelimiter: ActiveBlockDelimiterState = {
    fenceCharacter: null,
    fenceLength: 0,
    mathDelimiter: null,
  };
  let sawBlockSeparator = false;
  const lines = text.split("\n");
  const structuralBlankLines = getStructuralBlankLines(text, lines);

  for (const [index, line] of lines.entries()) {
    const isBlankLine = line.trim().length === 0;

    if (activeDelimiter.mathDelimiter && isBlankLine) {
      currentLines.push(line);
      continue;
    }

    if (isBlankLine && structuralBlankLines.has(index)) {
      currentLines.push(line);
      continue;
    }

    if (isBlankLine) {
      if (currentLines.length > 0) {
        sawBlockSeparator = true;
      }
      continue;
    }

    if (!activeDelimiter.fenceCharacter && !activeDelimiter.mathDelimiter && sawBlockSeparator) {
      blocks.push(currentLines.join("\n"));
      currentLines = [];
      sawBlockSeparator = false;
    }

    currentLines.push(line);
    activeDelimiter = advanceActiveBlockDelimiter(line, activeDelimiter);
  }

  if (currentLines.length > 0) {
    blocks.push(currentLines.join("\n"));
  }

  return blocks.filter((block) => block.length > 0);
}

function getStructuralBlankLines(text: string, lines: string[]): Set<number> {
  const blankLines = new Set<number>();
  for (const token of markdownBlockParser.parse(text, {})) {
    if (token.level !== 0 || !token.map) {
      continue;
    }
    const [start, end] = token.map;
    for (let index = start; index < end - 1; index += 1) {
      if (lines[index]?.trim().length === 0) {
        blankLines.add(index);
      }
    }
  }
  return blankLines;
}
