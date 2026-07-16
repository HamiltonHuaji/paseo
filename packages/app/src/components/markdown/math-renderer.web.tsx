import React, { useCallback, useMemo } from "react";
import { renderToString } from "katex";
// Installs KaTeX's document-level handler that restores TeX in copied selections.
// oxlint-disable-next-line import/no-unassigned-import
import "katex/contrib/copy-tex";
import { useToast } from "@/contexts/toast-context";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
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

const COPY_FORMULA_LABEL = "Copy formula";

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

function getMathClipboardText(content: string, displayMode: boolean): string {
  return displayMode ? `$$${content}$$` : `$${content}$`;
}

function hasDocumentSelection(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed && selection.toString().length > 0;
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
  const toast = useToast();
  const rendered = useMemo(() => renderMath(content, displayMode), [content, displayMode]);
  const copyFormula = useCallback(() => {
    void copyToClipboard(getMathClipboardText(content, displayMode))
      .then(() => toast.copied())
      .catch(() => toast.error("Copy failed"));
  }, [content, displayMode, toast]);
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (hasDocumentSelection()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      copyFormula();
    },
    [copyFormula],
  );
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      copyFormula();
    },
    [copyFormula],
  );

  if (rendered.kind === "source") {
    return <MathSource content={content} displayMode={displayMode} />;
  }

  if (displayMode) {
    return (
      <div
        aria-label={`${COPY_FORMULA_LABEL}: ${content}`}
        className="paseo-markdown-math paseo-markdown-math--block"
        data-pmono=""
        data-paseo-markdown-math="block"
        dangerouslySetInnerHTML={rendered.markup}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        title={COPY_FORMULA_LABEL}
      />
    );
  }

  return (
    <span
      aria-label={`${COPY_FORMULA_LABEL}: ${content}`}
      className="paseo-markdown-math paseo-markdown-math--inline"
      data-pmono=""
      data-paseo-markdown-math="inline"
      dangerouslySetInnerHTML={rendered.markup}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      title={COPY_FORMULA_LABEL}
    />
  );
}
