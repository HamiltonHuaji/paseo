import { useCallback, type PropsWithChildren, type MouseEvent } from "react";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useToast } from "@/contexts/toast-context";

/** The engine renders MathML offline; retain TeX when copying or activating a formula. */
export function MarkdownMathCopy({
  children,
  sources,
}: PropsWithChildren<{ sources: Readonly<Record<string, string>> }>) {
  const toast = useToast();
  const copy = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!(event.target instanceof Element) || !window.getSelection()?.isCollapsed) return;
      const math = event.target.closest('[role="math"]');
      const normalized = math?.getAttribute("aria-label");
      const source = normalized == null ? null : (sources[normalized] ?? normalized);
      if (!source) return;
      event.preventDefault();
      event.stopPropagation();
      const display = math?.querySelector('math[display="block"]') !== null;
      const delimiter = display ? "$$" : "$";
      void copyToClipboard(`${delimiter}${source}${delimiter}`)
        .then(() => toast.copied())
        .catch(() => toast.error("Copy failed"));
    },
    [toast, sources],
  );
  return (
    <div onClick={copy} data-paseo-math-sources={JSON.stringify(sources)}>
      {children}
    </div>
  );
}
