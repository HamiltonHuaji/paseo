import type { RefObject } from "react";

export interface WorkspaceTabRevealTarget {
  key: string;
  start: number;
  end: number;
}

export function useWorkspaceTabHorizontalScroll(
  _scrollRef: RefObject<unknown>,
  _enabled: boolean,
  _revealTarget: WorkspaceTabRevealTarget | null,
): void {}
