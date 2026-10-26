import { BOARD_CANVAS_GRID_SIZE, type ResolvedPlacement } from "./layout";

export interface CanvasCamera {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export const MIN_CANVAS_ZOOM = 0.1;
export const MAX_CANVAS_ZOOM = 3;
export const CANVAS_ZOOM_STEP = 1.25;

export function zoomCamera(camera: CanvasCamera, zoom: number, anchor: CanvasPoint): CanvasCamera {
  const nextZoom = Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
  const ratio = nextZoom / camera.zoom;
  return {
    x: anchor.x - (anchor.x - camera.x) * ratio,
    y: anchor.y - (anchor.y - camera.y) * ratio,
    zoom: nextZoom,
  };
}

export function fitCanvasCamera(
  cards: readonly ResolvedPlacement[],
  viewport: { width: number; height: number },
): CanvasCamera | null {
  if (cards.length === 0 || viewport.width <= 0 || viewport.height <= 0) return null;
  const grid = BOARD_CANVAS_GRID_SIZE;
  const left = Math.min(...cards.map((card) => card.column * grid));
  const top = Math.min(...cards.map((card) => card.row * grid));
  const right = Math.max(...cards.map((card) => (card.column + card.width) * grid));
  const bottom = Math.max(...cards.map((card) => (card.row + card.height) * grid));
  // Leave room for the fixed controls along the bottom of the viewport.
  const width = Math.max(1, viewport.width - 48);
  const height = Math.max(1, viewport.height - 96);
  const zoom = Math.max(
    MIN_CANVAS_ZOOM,
    Math.min(1, width / (right - left), height / (bottom - top)),
  );
  return {
    x: viewport.width / 2 - ((left + right) / 2) * zoom,
    y: (viewport.height - 48) / 2 - ((top + bottom) / 2) * zoom,
    zoom,
  };
}

export function canvasDragDelta(delta: { dx: number; dy: number }, zoom: number) {
  return { dx: delta.dx / zoom, dy: delta.dy / zoom };
}

export function canvasWheelDelta(
  event: { deltaX: number; deltaY: number; deltaMode: number },
  height: number,
) {
  let unit = 1;
  if (event.deltaMode === 1) unit = 16;
  if (event.deltaMode === 2) unit = height;
  return { x: event.deltaX * unit, y: event.deltaY * unit };
}
