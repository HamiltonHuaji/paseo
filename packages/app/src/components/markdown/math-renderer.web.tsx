import React, { useMemo } from "react";
import { renderToString } from "katex";
// Installs KaTeX's document-level handler that restores TeX in copied selections.
// oxlint-disable-next-line import/no-unassigned-import
import "katex/contrib/copy-tex";
import "./math-renderer.web.css";
import type { MarkdownMathProps } from "./math-renderer.types";

export type { MarkdownMathProps } from "./math-renderer.types";

interface RenderedMath {
  kind: "rendered";
  markup: { __html: string };
}

interface SourceMath {
  kind: "source";
}

type MathRender = RenderedMath | SourceMath;

function renderMath(content: string, displayMode: boolean): MathRender {
  try {
    const html = renderToString(content, {
      displayMode,
      maxExpand: 1_000,
      maxSize: 50,
      output: "htmlAndMathml",
      strict: "warn",
      throwOnError: true,
      trust: false,
    });
    return { kind: "rendered", markup: { __html: html } };
  } catch {
    return { kind: "source" };
  }
}

function MathSource({ content, displayMode }: MarkdownMathProps) {
  if (displayMode) {
    return (
      <pre
        className="paseo-markdown-math-source paseo-markdown-math-source--block"
        data-paseo-math-fallback="block"
      >
        <code>{content}</code>
      </pre>
    );
  }

  return (
    <code
      className="paseo-markdown-math-source paseo-markdown-math-source--inline"
      data-paseo-math-fallback="inline"
    >
      {content}
    </code>
  );
}

export function MarkdownMath({ content, displayMode }: MarkdownMathProps) {
  const rendered = useMemo(() => renderMath(content, displayMode), [content, displayMode]);

  if (rendered.kind === "source") {
    return <MathSource content={content} displayMode={displayMode} />;
  }

  if (displayMode) {
    return (
      <div
        className="paseo-markdown-math paseo-markdown-math--block"
        data-pmono=""
        data-paseo-markdown-math="block"
        dangerouslySetInnerHTML={rendered.markup}
      />
    );
  }

  return (
    <span
      className="paseo-markdown-math paseo-markdown-math--inline"
      data-pmono=""
      data-paseo-markdown-math="inline"
      dangerouslySetInnerHTML={rendered.markup}
    />
  );
}
