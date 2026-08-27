import React from "react";
import { MarkdownTextSpan } from "@/components/markdown-text";
import type { MarkdownMathProps } from "./math-renderer.types";

export type { MarkdownMathProps } from "./math-renderer.types";

export function MarkdownMath({ content }: MarkdownMathProps) {
  return <MarkdownTextSpan>{content}</MarkdownTextSpan>;
}
