import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { ASTNode } from "react-native-markdown-display";
import tokensToAST from "react-native-markdown-display/src/lib/util/tokensToAST";
import { describe, expect, it } from "vitest";
import { configureMarkdownMath as configureNativeMarkdownMath } from "./configure-markdown-math.native";
import { createMarkdownParser } from "./parser";

function flattenTokens(tokens: readonly Token[]): Token[] {
  return tokens.flatMap((token) => [token, ...flattenTokens(token.children ?? [])]);
}

function mathTokens(source: string) {
  return flattenTokens(createMarkdownParser().parse(source, {}))
    .filter((token) => token.type === "math_inline" || token.type === "math_block")
    .map((token) => ({
      type: token.type,
      content: token.content,
      markup: token.markup,
      block: token.block,
    }));
}

function flattenAst(nodes: readonly ASTNode[]): ASTNode[] {
  return nodes.flatMap((node) => [node, ...flattenAst(node.children ?? [])]);
}

describe("createMarkdownParser", () => {
  it("parses dollar and bracket inline math into math_inline tokens", () => {
    expect(mathTokens("$x + 1$ and \\(y\\)")).toEqual([
      { type: "math_inline", content: "x + 1", markup: "$", block: false },
      { type: "math_inline", content: "y", markup: "\\(", block: false },
    ]);
  });

  it("parses dollar and bracket display math into math_block tokens", () => {
    expect(mathTokens("$$\nx + 1\n$$\n\n\\[\ny + 1\n\\]")).toEqual([
      { type: "math_block", content: "x + 1\n", markup: "$$", block: true },
      { type: "math_block", content: "y + 1\n", markup: "\\[", block: true },
    ]);
  });

  it("preserves math token names through react-native-markdown-display's AST conversion", () => {
    const parser = createMarkdownParser();
    const ast = tokensToAST(parser.parse("$x$\n\n$$\ny\n$$", {}));

    expect(
      flattenAst(ast)
        .filter((node) => node.type === "math_inline" || node.type === "math_block")
        .map((node) => ({
          type: node.type,
          sourceType: node.sourceType,
          content: node.content,
        })),
    ).toEqual([
      { type: "math_inline", sourceType: "math_inline", content: "x" },
      { type: "math_block", sourceType: "math_block", content: "y\n" },
    ]);
  });

  it("does not treat escaped dollars or ordinary currency as math", () => {
    const escapedDollarTokens = flattenTokens(
      createMarkdownParser().parse(String.raw`Cost \$5 and $x$.`, {}),
    ).filter((token) => token.type === "text" || token.type === "math_inline");

    expect(
      escapedDollarTokens.map((token) => ({ type: token.type, content: token.content })),
    ).toEqual([
      { type: "text", content: "Cost $5 and " },
      { type: "math_inline", content: "x" },
      { type: "text", content: "." },
    ]);
    expect(mathTokens(String.raw`Cost \$5 and $x$.`)).toEqual([
      { type: "math_inline", content: "x", markup: "$", block: false },
    ]);
    expect(mathTokens("Tickets cost $5 and $10 today.")).toEqual([]);
  });

  it("does not parse math delimiters inside inline or fenced code", () => {
    const source = "`$x$`\n\n```tex\n$$\ny\n$$\n```";
    const tokens = flattenTokens(createMarkdownParser().parse(source, {}));

    expect(mathTokens(source)).toEqual([]);
    expect(
      tokens
        .filter((token) => token.type === "code_inline" || token.type === "fence")
        .map((token) => ({ type: token.type, content: token.content })),
    ).toEqual([
      { type: "code_inline", content: "$x$" },
      { type: "fence", content: "$$\ny\n$$\n" },
    ]);
  });

  it("leaves incomplete inline and bracket math as text while accepting a streaming dollar block", () => {
    expect(mathTokens("$x")).toEqual([]);
    expect(mathTokens("\\(x")).toEqual([]);
    expect(mathTokens("\\[\nx")).toEqual([]);
    expect(mathTokens("$$\nx")).toEqual([
      { type: "math_block", content: "x", markup: "$$", block: true },
    ]);
  });

  it("keeps ordinary Markdown tokenization intact", () => {
    const tokens = flattenTokens(
      createMarkdownParser().parse("# Title\n\n**bold** [link](https://example.com)", {}),
    );

    expect(tokens.map((token) => token.type)).toEqual([
      "heading_open",
      "inline",
      "text",
      "heading_close",
      "paragraph_open",
      "inline",
      "text",
      "strong_open",
      "text",
      "strong_close",
      "text",
      "link_open",
      "text",
      "link_close",
      "paragraph_close",
    ]);
  });

  it("keeps the unused HTML render callback escaped", () => {
    expect(createMarkdownParser().render("Unsafe $<img src=x onerror=alert(1)>$.")).toBe(
      "<p>Unsafe &lt;img src=x onerror=alert(1)&gt;.</p>\n",
    );
  });

  it("only permits file links for the session parser option", () => {
    const sharedParser = createMarkdownParser();
    const sessionParser = createMarkdownParser({ allowFileLinks: true });

    expect(sharedParser.validateLink("file:///tmp/example.md")).toBe(false);
    expect(sessionParser.validateLink("file:///tmp/example.md")).toBe(true);
    expect(sessionParser.validateLink("javascript:alert(1)")).toBe(false);
  });

  it("leaves math syntax untouched in the native configuration", () => {
    const parser = configureNativeMarkdownMath(new MarkdownIt());

    expect(flattenTokens(parser.parse("$x$\n\n$$\ny\n$$", {})).map((token) => token.type)).toEqual([
      "paragraph_open",
      "inline",
      "text",
      "paragraph_close",
      "paragraph_open",
      "inline",
      "text",
      "softbreak",
      "text",
      "softbreak",
      "text",
      "paragraph_close",
    ]);
  });
});
