import React, { type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { ASTNode } from "react-native-markdown-display";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMarkdownMathRules } from "./math-rules";
import { MarkdownMath, type MarkdownMathProps } from "./math-renderer";

const mocks = vi.hoisted(() => ({
  copied: vi.fn(),
  copyToClipboard: vi.fn<() => Promise<void>>(),
  error: vi.fn(),
}));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ copied: mocks.copied, error: mocks.error, show: vi.fn() }),
}));

vi.mock("@/utils/copy-to-clipboard", () => ({
  copyToClipboard: mocks.copyToClipboard,
}));

const KATEX_STYLESHEET_PATH = "/katex-0.17.0/katex.min.css";
const KATEX_MAIN_FONT_PATH = "/katex-0.17.0/fonts/KaTeX_Main-Regular.woff2";

interface MountedMath {
  host: HTMLDivElement;
  root: Root;
}

const mounted: MountedMath[] = [];
const injectedStyles: HTMLStyleElement[] = [];
let katexStylesheet: HTMLLinkElement | null = null;

function loadKaTeXStylesheet(): Promise<HTMLLinkElement> {
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = KATEX_STYLESHEET_PATH;
    link.addEventListener("load", () => resolve(link), { once: true });
    link.addEventListener(
      "error",
      () => {
        link.remove();
        reject(new Error(`Unable to load ${KATEX_STYLESHEET_PATH}`));
      },
      { once: true },
    );
    document.head.appendChild(link);
  });
}

function mountMath(props: MarkdownMathProps): HTMLDivElement {
  return mountRenderedMath(<MarkdownMath {...props} />);
}

function mountRenderedMath(rendered: ReactNode): HTMLDivElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(rendered));
  mounted.push({ host, root });
  return host;
}

function markdownAstNode(type: string, content = ""): ASTNode {
  return {
    type,
    sourceType: type,
    key: `${type}-key`,
    content,
    markup: "",
    tokenIndex: 0,
    index: 0,
    attributes: {},
    children: [],
  };
}

function mountMathFromMarkdownRenderer({
  color,
  content,
  displayMode,
}: {
  color: string;
  content: string;
  displayMode: boolean;
}): HTMLDivElement {
  const math = markdownAstNode(displayMode ? "math_block" : "math_inline", content);
  const renderMath = createMarkdownMathRules()[math.type];
  if (renderMath === undefined) {
    throw new Error(`Missing render rule for ${math.type}`);
  }
  const rendered = renderMath(
    math,
    [],
    [markdownAstNode("paragraph"), markdownAstNode("body")],
    {},
    { color },
  );
  const host = mountRenderedMath(rendered);
  // RN Web paragraphs are flex Views without a text color. Text siblings get
  // their semantic color from inheritedStyles, while an unstyled custom DOM
  // child otherwise falls through to this browser default.
  host.style.color = "rgb(0, 0, 0)";
  return host;
}

beforeAll(async () => {
  katexStylesheet = await loadKaTeXStylesheet();
});

afterAll(() => {
  katexStylesheet?.remove();
});

beforeEach(() => {
  mocks.copied.mockReset();
  mocks.copyToClipboard.mockReset();
  mocks.copyToClipboard.mockResolvedValue(undefined);
  mocks.error.mockReset();
});

afterEach(() => {
  for (const { host, root } of mounted.splice(0)) {
    flushSync(() => root.unmount());
    host.remove();
  }
  for (const style of injectedStyles.splice(0)) {
    style.remove();
  }
});

describe("MarkdownMath", () => {
  it("renders inline formulas as accessible KaTeX HTML and MathML", () => {
    const host = mountMath({ content: String.raw`x^2 + y^2`, displayMode: false });
    const math = host.querySelector<HTMLElement>("[data-paseo-markdown-math='inline']");

    expect(math?.tagName).toBe("SPAN");
    expect(math?.querySelector(".katex-html")?.getAttribute("aria-hidden")).toBe("true");
    expect(math?.querySelector(".katex-mathml math")).not.toBeNull();
    expect(math?.querySelector("annotation")?.textContent).toBe(String.raw`x^2 + y^2`);
    expect(window.getComputedStyle(math as HTMLElement).display).toBe("inline");
    expect(window.getComputedStyle(math as HTMLElement).verticalAlign).toBe("baseline");
  });

  it("renders display formulas in a horizontally scrollable block", () => {
    const host = mountMath({
      content: String.raw`\sum_{n=1}^{\infty} \frac{1}{n^2}`,
      displayMode: true,
    });
    const math = host.querySelector<HTMLElement>("[data-paseo-markdown-math='block']");

    expect(math?.tagName).toBe("DIV");
    expect(math?.querySelector(":scope > .katex-display")).not.toBeNull();
    expect(window.getComputedStyle(math as HTMLElement).display).toBe("block");
    expect(window.getComputedStyle(math as HTMLElement).overflowX).toBe("auto");
    expect(
      window.getComputedStyle(math?.querySelector(":scope > .katex-display") as HTMLElement)
        .minWidth,
    ).toBe("max-content");
  });

  it("applies the markdown renderer's inherited foreground to inline and display formulas", () => {
    const cases = [
      { color: "rgb(25, 30, 35)", displayMode: false },
      { color: "rgb(230, 235, 240)", displayMode: true },
    ];

    for (const testCase of cases) {
      const host = mountMathFromMarkdownRenderer({
        ...testCase,
        content: String.raw`\sqrt{x}`,
      });
      const math = host.querySelector<HTMLElement>("[data-paseo-markdown-math]");
      const visibleLeaf = math?.querySelector<HTMLElement>(".katex-html .mathnormal");
      const stretchySvg = math?.querySelector<SVGElement>(".katex-html svg");

      expect(window.getComputedStyle(math as HTMLElement).color).toBe(testCase.color);
      expect(window.getComputedStyle(visibleLeaf as HTMLElement).color).toBe(testCase.color);
      expect(window.getComputedStyle(stretchySvg as SVGElement).fill).toBe(testCase.color);
    }
  });

  it("loads bundled KaTeX fonts under the app-wide UI font override", async () => {
    const style = document.createElement("style");
    style.textContent =
      "#math-font-root *:not([data-pmono]):not([data-pmono] *){font-family:Arial;}";
    document.head.appendChild(style);
    injectedStyles.push(style);

    const host = mountMath({ content: String.raw`\sqrt{x}`, displayMode: false });
    host.id = "math-font-root";
    const math = host.querySelector<HTMLElement>("[data-paseo-markdown-math='inline']");

    const fontResponse = await fetch(KATEX_MAIN_FONT_PATH);
    const fontBytes = await fontResponse.arrayBuffer();
    const loadedFaces = await document.fonts.load("16px KaTeX_Main", "x");

    expect(math?.getAttribute("data-pmono")).toBe("");
    expect(fontResponse.status).toBe(200);
    expect(fontBytes.byteLength).toBe(26_272);
    expect(loadedFaces.map((face) => face.family)).toContain("KaTeX_Main");
    expect(
      window.getComputedStyle(math?.querySelector(".katex") as HTMLElement).fontFamily,
    ).toContain("KaTeX_Main");
  });

  it("shows invalid TeX as inert source text", () => {
    const content = String.raw`\notARealCommand{<img src=x onerror=alert(1)>}`;
    const host = mountMath({ content, displayMode: false });
    const fallback = host.querySelector<HTMLElement>("[data-paseo-math-fallback='inline']");

    expect(fallback?.textContent).toBe(content);
    expect(host.querySelector(".katex")).toBeNull();
    expect(host.querySelector("img")).toBeNull();
  });

  it("keeps HTML-looking text inert inside valid formulas", () => {
    const content = String.raw`\text{<img src=x onerror=alert(1)>}`;
    const host = mountMath({ content, displayMode: false });

    expect(host.querySelector(".katex")).not.toBeNull();
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("copies surrounding prose with formulas restored to TeX source", () => {
    const content = String.raw`x^2 + y^2`;
    const host = mountMath({ content, displayMode: false });
    host.prepend(document.createTextNode("Before "));
    host.append(document.createTextNode(" after"));

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(host);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const clipboardData = new DataTransfer();
    const copyEvent = new ClipboardEvent("copy", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    });
    document.dispatchEvent(copyEvent);

    expect(copyEvent.defaultPrevented).toBe(true);
    expect(clipboardData.getData("text/plain")).toBe(`Before $${content}$ after`);
    expect(clipboardData.getData("text/html")).toContain("katex");
    selection?.removeAllRanges();
  });

  it("copies an inline formula as delimited TeX when clicked", async () => {
    const content = String.raw`E = mc^2`;
    const host = mountMath({ content, displayMode: false });
    const math = host.querySelector<HTMLElement>("[data-paseo-markdown-math='inline']");

    math?.click();

    await vi.waitFor(() => {
      expect(mocks.copyToClipboard).toHaveBeenCalledWith(`$${content}$`);
      expect(mocks.copied).toHaveBeenCalledOnce();
    });
    expect(math?.getAttribute("role")).toBe("button");
    expect(math?.getAttribute("tabindex")).toBe("0");
    expect(math?.getAttribute("aria-label")).toBe(`Copy formula: ${content}`);
    expect(math?.getAttribute("title")).toBe("Copy formula");
    expect(window.getComputedStyle(math as HTMLElement).cursor).toBe("copy");
  });

  it("does not replace drag-selection behavior with click-to-copy", () => {
    const host = mountMath({ content: String.raw`x + y`, displayMode: false });
    const math = host.querySelector<HTMLElement>("[data-paseo-markdown-math='inline']");
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(math as HTMLElement);
    selection?.removeAllRanges();
    selection?.addRange(range);

    math?.click();

    expect(mocks.copyToClipboard).not.toHaveBeenCalled();
    selection?.removeAllRanges();
  });

  it("copies a display formula with display delimiters from the keyboard", async () => {
    const content = String.raw`\int_0^1 x^2\,dx`;
    const host = mountMath({ content, displayMode: true });
    const math = host.querySelector<HTMLElement>("[data-paseo-markdown-math='block']");
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });

    math?.dispatchEvent(event);

    await vi.waitFor(() => {
      expect(mocks.copyToClipboard).toHaveBeenCalledWith(`$$${content}$$`);
      expect(mocks.copied).toHaveBeenCalledOnce();
    });
    expect(event.defaultPrevented).toBe(true);
  });
});
