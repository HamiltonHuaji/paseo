import type { PropsWithChildren } from "react";
export function MarkdownMathCopy({
  children,
}: PropsWithChildren<{ sources: Readonly<Record<string, string>> }>) {
  return children;
}
