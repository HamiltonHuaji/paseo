function getFenceDelimiter(line: string) {
  const match = /^( {0,3})(`{3,}|~{3,})/.exec(line);
  return match?.[2] ?? null;
}

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

export function splitMarkdownBlocks(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const blocks: string[] = [];
  let currentLines: string[] = [];
  let activeFenceCharacter: "`" | "~" | null = null;
  let activeFenceLength = 0;
  let activeMathDelimiter: MathBlockDelimiter | null = null;
  let sawBlockSeparator = false;

  for (const line of text.split("\n")) {
    const isBlankLine = line.trim().length === 0;

    if (!activeFenceCharacter && !activeMathDelimiter && isBlankLine) {
      if (currentLines.length > 0) {
        sawBlockSeparator = true;
      }
      continue;
    }

    if (!activeFenceCharacter && !activeMathDelimiter && sawBlockSeparator) {
      blocks.push(currentLines.join("\n"));
      currentLines = [];
      sawBlockSeparator = false;
    }

    currentLines.push(line);

    if (activeMathDelimiter) {
      if (closesMathBlock(line, activeMathDelimiter)) {
        activeMathDelimiter = null;
      }
      continue;
    }

    const fenceDelimiter = getFenceDelimiter(line);
    if (fenceDelimiter) {
      if (!activeFenceCharacter) {
        activeFenceCharacter = fenceDelimiter[0] as "`" | "~";
        activeFenceLength = fenceDelimiter.length;
        continue;
      }

      if (
        fenceDelimiter[0] === activeFenceCharacter &&
        fenceDelimiter.length >= activeFenceLength
      ) {
        activeFenceCharacter = null;
        activeFenceLength = 0;
      }
      continue;
    }

    if (activeFenceCharacter) {
      continue;
    }

    const mathDelimiter = getMathBlockDelimiter(line);
    if (
      mathDelimiter &&
      !closesMathBlock(line, mathDelimiter.delimiter, mathDelimiter.contentStart)
    ) {
      activeMathDelimiter = mathDelimiter.delimiter;
    }
  }

  if (currentLines.length > 0) {
    blocks.push(currentLines.join("\n"));
  }

  return blocks.filter((block) => block.length > 0);
}
