const PIXELS_PER_WHEEL_LINE = 16;

export interface WorkspaceTabWheelDelta {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}

export interface WorkspaceTabScrollTarget {
  clientWidth: number;
  scrollWidth: number;
  scrollLeft: number;
}

export interface WorkspaceTabWheelEvent extends WorkspaceTabWheelDelta {
  ctrlKey: boolean;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

export function resolveWorkspaceTabWheelDelta(
  event: WorkspaceTabWheelDelta,
  pageWidth: number,
): number {
  const dominantDelta =
    Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (event.deltaMode === 1) {
    return dominantDelta * PIXELS_PER_WHEEL_LINE;
  }
  if (event.deltaMode === 2) {
    return dominantDelta * Math.max(0, pageWidth);
  }
  return dominantDelta;
}

export function scrollWorkspaceTabsWithWheel(
  target: WorkspaceTabScrollTarget,
  event: WorkspaceTabWheelEvent,
): boolean {
  if (event.defaultPrevented || event.ctrlKey) {
    return false;
  }

  const delta = resolveWorkspaceTabWheelDelta(event, target.clientWidth);
  const maxOffset = Math.max(0, target.scrollWidth - target.clientWidth);
  const nextOffset = Math.min(Math.max(0, target.scrollLeft + delta), maxOffset);
  if (nextOffset === target.scrollLeft) {
    return false;
  }

  target.scrollLeft = nextOffset;
  event.preventDefault();
  return true;
}

export function getWorkspaceTabRevealOffset(input: {
  currentOffset: number;
  viewportWidth: number;
  contentWidth: number;
  itemStart: number;
  itemEnd: number;
}): number {
  const maxOffset = Math.max(0, input.contentWidth - input.viewportWidth);
  const currentOffset = Math.min(Math.max(0, input.currentOffset), maxOffset);
  if (input.itemStart < currentOffset) {
    return Math.min(Math.max(0, input.itemStart), maxOffset);
  }
  if (input.itemEnd > currentOffset + input.viewportWidth) {
    return Math.min(Math.max(0, input.itemEnd - input.viewportWidth), maxOffset);
  }
  return currentOffset;
}
