import MarkdownIt from "markdown-it";
import { describe, expect, it } from "vitest";
import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";
import { configureMarkdownMath as configureAndroidMarkdownMath } from "./configure-markdown-math.android";
import { configureMarkdownMath as configureNativeMarkdownMath } from "./configure-markdown-math.native";
import { configureMarkdownMath as configureWebMarkdownMath } from "./configure-markdown-math.web";

function childTokens(parser: MarkdownIt, source: string) {
  return parser.parse(source, {}).flatMap((token) => token.children ?? [token]);
}

function tokenTypes(parser: MarkdownIt, source: string): string[] {
  return childTokens(parser, source).map((token) => token.type);
}

describe.each([
  ["web", configureWebMarkdownMath],
  ["android", configureAndroidMarkdownMath],
] as const)("%s Markdown math parsing", (_platform, configure) => {
  const parser = configure(new MarkdownIt());

  it.each([
    ["$x^2$", "math_inline", "x^2"],
    [String.raw`\(x^2\)`, "math_inline", "x^2"],
    ["$$x^2$$", "math_block", "x^2\n"],
    [String.raw`\[x^2\]`, "math_block", "x^2\n"],
  ])("parses %s as %s", (source, type, content) => {
    expect(childTokens(parser, source)).toContainEqual(expect.objectContaining({ type, content }));
  });

  it("leaves currency, escaped dollars, inline code, and spaced delimiters as text", () => {
    expect(tokenTypes(parser, "$5 and $10")).not.toContain("math_inline");
    expect(tokenTypes(parser, String.raw`\$5`)).not.toContain("math_inline");
    expect(tokenTypes(parser, "`$x$`")).not.toContain("math_inline");
    expect(tokenTypes(parser, "$ x $")).not.toContain("math_inline");
  });
});

describe("native Markdown math parsing", () => {
  it("keeps math as source text on platforms without a renderer", () => {
    const parser = configureNativeMarkdownMath(new MarkdownIt());
    expect(tokenTypes(parser, "$x^2$")).not.toContain("math_inline");
    expect(parser.parse("$x^2$", {})[1]?.content).toBe("$x^2$");
  });
});

describe("assistant Markdown parser", () => {
  it("combines TeX tokens with the existing file URL allowance", () => {
    const parser = createAssistantMarkdownParser();
    expect(tokenTypes(parser, "$x^2$")).toContain("math_inline");
    expect(parser.validateLink("file:///tmp/result.png")).toBe(true);
    expect(parser.validateLink("javascript:alert(1)")).toBe(false);
  });
});
