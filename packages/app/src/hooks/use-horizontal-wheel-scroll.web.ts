import { useEffect, type RefObject } from "react";
import { scrollWorkspaceTabsWithWheel } from "@/screens/workspace/workspace-tab-scroll";

export function useHorizontalWheelScroll(scrollRef: RefObject<unknown>, enabled: boolean): void {
  useEffect(() => {
    const node = scrollRef.current as HTMLElement | null;
    if (!enabled || !node) return;

    const handleWheel = (event: WheelEvent) => {
      scrollWorkspaceTabsWithWheel(node, event);
    };

    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [enabled, scrollRef]);
}
