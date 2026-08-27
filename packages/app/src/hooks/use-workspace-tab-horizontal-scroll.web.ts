import { useEffect, type RefObject } from "react";
import type { WorkspaceTabRevealTarget } from "@/hooks/use-workspace-tab-horizontal-scroll";
import {
  getWorkspaceTabRevealOffset,
  scrollWorkspaceTabsWithWheel,
} from "@/screens/workspace/workspace-tab-scroll";

export function useWorkspaceTabHorizontalScroll(
  scrollRef: RefObject<unknown>,
  enabled: boolean,
  revealTarget: WorkspaceTabRevealTarget | null,
): void {
  const revealKey = revealTarget?.key ?? null;
  const revealStart = revealTarget?.start ?? null;
  const revealEnd = revealTarget?.end ?? null;

  useEffect(() => {
    const node = scrollRef.current as HTMLElement | null;
    if (!enabled || !node) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      scrollWorkspaceTabsWithWheel(node, event);
    };
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [enabled, scrollRef]);

  useEffect(() => {
    const node = scrollRef.current as HTMLElement | null;
    if (!enabled || !node || revealStart === null || revealEnd === null) {
      return;
    }

    const nextOffset = getWorkspaceTabRevealOffset({
      currentOffset: node.scrollLeft,
      viewportWidth: node.clientWidth,
      contentWidth: node.scrollWidth,
      itemStart: revealStart,
      itemEnd: revealEnd,
    });
    if (nextOffset !== node.scrollLeft) {
      node.scrollLeft = nextOffset;
    }
  }, [enabled, revealEnd, revealKey, revealStart, scrollRef]);
}
