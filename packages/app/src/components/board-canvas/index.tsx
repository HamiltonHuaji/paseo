import { PressHighlight } from "@/components/ui/press-highlight";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  PanResponder,
  Text,
  View,
  type LayoutChangeEvent,
  type PointerEvent as RNPointerEvent,
  type ViewStyle,
} from "react-native";
import { Grip, Maximize2 } from "lucide-react-native";
import Svg, { Path, Polygon } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { Theme } from "@/styles/theme";
import {
  BOARD_CANVAS_GRID_SIZE,
  canvasDimensions,
  orthogonalRoute,
  roundedRoutePath,
  resolveBoardPlacements,
  type ResolvedPlacement,
  type BoardNode,
  type BoardPlacement,
  type BoardSize,
} from "./layout";

import { canvasDragDelta, fitCanvasCamera, zoomCamera, type CanvasCamera } from "./camera";
import { CanvasControls } from "./controls";
import { useCanvasInput } from "./input";

const GRID_SIZE = BOARD_CANVAS_GRID_SIZE;
const MIN_WIDTH = 9;
const MIN_HEIGHT = 6;
const ThemedGrip = withUnistyles(Grip);
const ThemedMaximize2 = withUnistyles(Maximize2);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface BoardCanvasProps {
  active?: boolean;
  layoutRevision?: number;
  visibleIds?: Set<string>;
  experiments: BoardNode[];
  sizes: Map<string, BoardSize>;
  renderContent: (id: string) => ReactNode;
  renderHover?: (id: string) => ReactNode;
  storedPlacements: BoardPlacement[];
  selectedExperiment: string | null;
  focusRequest?: { id: string; revision: number };
  onSelectExperiment: (experiment: string) => void;
  onClearSelection: () => void;
  onPersistPlacement: (placement: BoardPlacement) => void;
}

export function BoardCanvas({
  active = true,
  layoutRevision = 0,
  visibleIds,
  experiments,
  sizes,
  renderContent,
  renderHover,
  storedPlacements,
  selectedExperiment,
  focusRequest,
  onSelectExperiment,
  onClearSelection,
  onPersistPlacement,
}: BoardCanvasProps) {
  const resolved = useMemo(
    () => resolveBoardPlacements(experiments, sizes, storedPlacements),
    [sizes, experiments, storedPlacements],
  );
  const [localPlacements, setLocalPlacements] = useState<Record<string, ResolvedPlacement>>({});
  // Accept an explicit layout reset without moving the user's canvas camera.
  useEffect(() => setLocalPlacements({}), [layoutRevision]);
  const [camera, setCameraState] = useState<CanvasCamera>({ x: 0, y: 0, zoom: 1 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const cameraRef = useRef(camera);
  const viewportRef = useRef<View>(null);
  const panOriginRef = useRef(camera);
  const placements = useMemo(
    () =>
      new Map(
        [...resolved].map(
          ([experiment, placement]) =>
            [experiment, localPlacements[experiment] ?? placement] as const,
        ),
      ),
    [localPlacements, resolved],
  );
  const visibleExperiments = useMemo(
    () => (visibleIds ? experiments.filter((node) => visibleIds.has(node.id)) : experiments),
    [experiments, visibleIds],
  );
  const worldDimensions = useMemo(() => canvasDimensions(placements), [placements]);
  const updateCamera = useCallback((next: CanvasCamera) => {
    cameraRef.current = next;
    setCameraState(next);
  }, []);
  const focusedRequest = useRef<typeof focusRequest>(undefined);
  useEffect(() => {
    if (!active || !focusRequest || focusedRequest.current === focusRequest) return;
    if (viewportSize.width <= 0 || viewportSize.height <= 0) return;
    const placement = placements.get(focusRequest.id);
    if (!placement) return;
    focusedRequest.current = focusRequest;
    const zoom = cameraRef.current.zoom;
    updateCamera({
      x: viewportSize.width / 2 - (placement.column + placement.width / 2) * GRID_SIZE * zoom,
      y: GRID_SIZE - placement.row * GRID_SIZE * zoom,
      zoom,
    });
  }, [active, focusRequest, placements, updateCamera, viewportSize]);
  const previewPlacement = useCallback((placement: ResolvedPlacement) => {
    setLocalPlacements((current) => ({ ...current, [placement.id]: placement }));
  }, []);
  const commitPlacement = useCallback(
    (placement: ResolvedPlacement) => {
      previewPlacement(placement);
      onPersistPlacement(placement);
    },
    [onPersistPlacement, previewPlacement],
  );
  const worldStyle = useMemo(
    () => [
      styles.world,
      geometryStyle({
        width: worldDimensions.width,
        height: worldDimensions.height,
        transformOrigin: "top left",
        transform: [{ translateX: camera.x }, { translateY: camera.y }, { scale: camera.zoom }],
      }),
    ],
    [camera.x, camera.y, camera.zoom, worldDimensions.height, worldDimensions.width],
  );
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!active) return;
      const { width, height } = event.nativeEvent.layout;
      setViewportSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    },
    [active],
  );
  const zoomViewport = useCallback(
    (zoom: number) => {
      updateCamera(
        zoomCamera(cameraRef.current, zoom, {
          x: viewportSize.width / 2,
          y: viewportSize.height / 2,
        }),
      );
    },
    [updateCamera, viewportSize],
  );
  const fitAll = useCallback(() => {
    const cards = visibleExperiments.flatMap((node) => {
      const placement = placements.get(node.id);
      return placement ? [placement] : [];
    });
    const next = fitCanvasCamera(cards, viewportSize);
    if (next) updateCamera(next);
  }, [visibleExperiments, placements, viewportSize, updateCamera]);
  const focusSelection = useCallback(() => {
    if (!selectedExperiment || (visibleIds && !visibleIds.has(selectedExperiment))) return;
    const card = placements.get(selectedExperiment);
    const next = fitCanvasCamera(card ? [card] : [], viewportSize);
    if (next) updateCamera(next);
  }, [selectedExperiment, visibleIds, placements, viewportSize, updateCamera]);
  useCanvasInput({
    active,
    viewportRef,
    cameraRef,
    updateCamera,
    onZoom: zoomViewport,
    onFit: fitAll,
    onFocus: focusSelection,
  });
  const canvasPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
        onPanResponderGrant: () => {
          panOriginRef.current = { ...cameraRef.current };
        },
        onPanResponderMove: (_, gesture) => {
          updateCamera({
            ...panOriginRef.current,
            x: panOriginRef.current.x + gesture.dx,
            y: panOriginRef.current.y + gesture.dy,
          });
        },
      }),
    [updateCamera],
  );
  const handleCanvasPointerDown = useWebPointerDrag({
    enabled: active,
    onGrant: () => {
      panOriginRef.current = { ...cameraRef.current };
      if (isWeb)
        (viewportRef.current as unknown as HTMLElement | null)?.focus({ preventScroll: true });
    },
    onMove: ({ dx, dy }) => {
      updateCamera({
        ...panOriginRef.current,
        x: panOriginRef.current.x + dx,
        y: panOriginRef.current.y + dy,
      });
    },
    onRelease: ({ dx, dy }) => {
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) onClearSelection();
    },
  });

  return (
    <View
      ref={viewportRef}
      style={styles.viewport}
      onLayout={handleLayout}
      testID="board-canvas"
      tabIndex={isWeb ? 0 : undefined}
    >
      <GridLines width={viewportSize.width} height={viewportSize.height} camera={camera} />
      <View
        style={styles.panSurface}
        testID="canvas-pan-surface"
        onPointerDown={handleCanvasPointerDown}
        {...(!isWeb ? canvasPanResponder.panHandlers : {})}
      />
      <View pointerEvents="box-none" style={worldStyle} testID="canvas-world">
        <ThemedLineageOverlay
          experiments={visibleExperiments}
          placements={placements}
          width={worldDimensions.width}
          height={worldDimensions.height}
          uniProps={lineagePaletteMapping}
        />
        {experiments.map((experiment) => {
          if (visibleIds && !visibleIds.has(experiment.id)) return null;
          const placement = placements.get(experiment.id);
          if (!placement) return null;
          return (
            <CanvasCard
              key={experiment.id}
              active={active}
              zoom={camera.zoom}
              experiment={experiment}
              content={renderContent(experiment.id)}
              hoverContent={renderHover?.(experiment.id)}
              placement={placement}
              selected={experiment.id === selectedExperiment}
              onSelect={onSelectExperiment}
              onPreviewPlacement={previewPlacement}
              onCommitPlacement={commitPlacement}
            />
          );
        })}
      </View>
      <CanvasControls
        zoom={camera.zoom}
        canFit={visibleExperiments.length > 0}
        canFocus={
          !!selectedExperiment &&
          placements.has(selectedExperiment) &&
          (!visibleIds || visibleIds.has(selectedExperiment))
        }
        onZoom={zoomViewport}
        onFit={fitAll}
        onFocus={focusSelection}
      />
    </View>
  );
}

function CanvasCard({
  active,
  zoom,
  experiment,
  content,
  hoverContent,
  placement,
  selected,
  onSelect,
  onPreviewPlacement,
  onCommitPlacement,
}: {
  active: boolean;
  zoom: number;
  experiment: BoardNode;
  content: ReactNode;
  hoverContent?: ReactNode;
  placement: ResolvedPlacement;
  selected: boolean;
  onSelect: (experiment: string) => void;
  onPreviewPlacement: (placement: ResolvedPlacement) => void;
  onCommitPlacement: (placement: ResolvedPlacement) => void;
}) {
  const placementRef = useRef(placement);
  const gestureOriginRef = useRef(placement);
  const zoomRef = useRef(zoom);
  const gestureZoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const previewRef = useRef(onPreviewPlacement);
  const commitRef = useRef(onCommitPlacement);
  placementRef.current = placement;
  previewRef.current = onPreviewPlacement;
  commitRef.current = onCommitPlacement;

  const dragResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
        onPanResponderGrant: () => {
          gestureOriginRef.current = placementRef.current;
          gestureZoomRef.current = zoomRef.current;
        },
        onPanResponderMove: (_, gesture) => {
          previewRef.current(
            movePlacement(
              gestureOriginRef.current,
              canvasDragDelta(gesture, gestureZoomRef.current),
              false,
            ),
          );
        },
        onPanResponderRelease: (_, gesture) => {
          if (Math.abs(gesture.dx) < 3 && Math.abs(gesture.dy) < 3) onSelect(experiment.id);
          else
            commitRef.current(
              movePlacement(
                gestureOriginRef.current,
                canvasDragDelta(gesture, gestureZoomRef.current),
                true,
              ),
            );
        },
        onPanResponderTerminate: (_, gesture) => {
          commitRef.current(
            movePlacement(
              gestureOriginRef.current,
              canvasDragDelta(gesture, gestureZoomRef.current),
              true,
            ),
          );
        },
      }),
    [experiment.id, onSelect],
  );
  const handleDragPointerDown = useWebPointerDrag({
    enabled: active,
    onGrant: () => {
      gestureOriginRef.current = placementRef.current;
      gestureZoomRef.current = zoomRef.current;
    },
    onMove: (gesture) => {
      previewRef.current(
        movePlacement(
          gestureOriginRef.current,
          canvasDragDelta(gesture, gestureZoomRef.current),
          false,
        ),
      );
    },
    onRelease: (gesture) => {
      if (Math.abs(gesture.dx) < 3 && Math.abs(gesture.dy) < 3) onSelect(experiment.id);
      else
        commitRef.current(
          movePlacement(
            gestureOriginRef.current,
            canvasDragDelta(gesture, gestureZoomRef.current),
            true,
          ),
        );
    },
  });
  const resizeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          gestureOriginRef.current = placementRef.current;
          gestureZoomRef.current = zoomRef.current;
        },
        onPanResponderMove: (_, gesture) => {
          previewRef.current(
            resizePlacement(
              gestureOriginRef.current,
              canvasDragDelta(gesture, gestureZoomRef.current),
              false,
            ),
          );
        },
        onPanResponderRelease: (_, gesture) => {
          commitRef.current(
            resizePlacement(
              gestureOriginRef.current,
              canvasDragDelta(gesture, gestureZoomRef.current),
              true,
            ),
          );
        },
        onPanResponderTerminate: (_, gesture) => {
          commitRef.current(
            resizePlacement(
              gestureOriginRef.current,
              canvasDragDelta(gesture, gestureZoomRef.current),
              true,
            ),
          );
        },
      }),
    [],
  );
  const handleResizePointerDown = useWebPointerDrag({
    enabled: active,
    onGrant: () => {
      gestureOriginRef.current = placementRef.current;
      gestureZoomRef.current = zoomRef.current;
    },
    onMove: (gesture) => {
      previewRef.current(
        resizePlacement(
          gestureOriginRef.current,
          canvasDragDelta(gesture, gestureZoomRef.current),
          false,
        ),
      );
    },
    onRelease: (gesture) => {
      commitRef.current(
        resizePlacement(
          gestureOriginRef.current,
          canvasDragDelta(gesture, gestureZoomRef.current),
          true,
        ),
      );
    },
  });
  const [isHovered, setIsHovered] = useState(false);
  const containerStyle = useMemo(
    () => [
      styles.cardContainer,
      placementStyle(placement),
      inlineUnistylesStyle({ zIndex: cardZIndex(isHovered, selected) }),
    ],
    [isHovered, placement, selected],
  );
  const cardStyle = useMemo(() => [styles.card, selected && styles.cardSelected], [selected]);
  const handleSelect = useCallback(() => onSelect(experiment.id), [experiment.id, onSelect]);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  return (
    <PressHighlight
      style={containerStyle}
      onHoverIn={handlePointerEnter}
      onHoverOut={handlePointerLeave}
      accessible={false}
    >
      <View style={cardStyle}>
        <View
          style={styles.cardHeader}
          testID={`canvas-card-drag-${experiment.id}`}
          onPointerDown={handleDragPointerDown}
          {...(!isWeb ? dragResponder.panHandlers : {})}
        >
          <ThemedGrip size={14} uniProps={mutedIconMapping} />
          <Text style={styles.cardTitle} numberOfLines={1}>
            {experiment.title}
          </Text>
        </View>
        <PressHighlight
          style={styles.cardBody}
          onPress={handleSelect}
          accessibilityRole="button"
          accessibilityLabel={experiment.title}
          testID={`canvas-card-open-${experiment.id}`}
        >
          {content}
        </PressHighlight>
        <View
          style={styles.resizeHandle}
          testID={`canvas-card-resize-${experiment.id}`}
          onPointerDown={handleResizePointerDown}
          {...(!isWeb ? resizeResponder.panHandlers : {})}
        >
          <ThemedMaximize2 size={13} uniProps={mutedIconMapping} />
        </View>
      </View>
      {hoverContent && isHovered ? (
        <View style={styles.cardProgressHoverPanel}>{hoverContent}</View>
      ) : null}
    </PressHighlight>
  );
}

function cardZIndex(isHovered: boolean, selected: boolean): number {
  if (isHovered) return 4;
  if (selected) return 3;
  return 2;
}

function GridLines({
  width,
  height,
  camera,
}: {
  width: number;
  height: number;
  camera: CanvasCamera;
}) {
  // Show coarser world-grid intervals at overview scales, rather than a dense grey fill.
  const gridStep =
    GRID_SIZE * camera.zoom * Math.max(1, 2 ** Math.ceil(Math.log2(0.5 / camera.zoom)));
  const verticalLines = gridLinePositions(width, camera.x, gridStep);
  const horizontalLines = gridLinePositions(height, camera.y, gridStep);
  return (
    <View style={styles.grid} pointerEvents="none">
      {verticalLines.map((left) => (
        <View key={`column:${left}`} style={[styles.gridVertical, geometryStyle({ left })]} />
      ))}
      {horizontalLines.map((top) => (
        <View key={`row:${top}`} style={[styles.gridHorizontal, geometryStyle({ top })]} />
      ))}
    </View>
  );
}

function gridLinePositions(viewportLength: number, cameraOffset: number, step: number): number[] {
  const first = positiveModulo(cameraOffset, step) - step;
  const count = Math.ceil(viewportLength / step) + 2;
  return Array.from({ length: count }, (_, index) => first + index * step);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

interface LineageOverlayProps {
  experiments: BoardNode[];
  placements: Map<string, ResolvedPlacement>;
  width: number;
  height: number;
  lineColor: string;
}

function LineageOverlay({
  experiments,
  placements,
  width,
  height,
  lineColor,
}: LineageOverlayProps) {
  const routes = useMemo(() => {
    const visibleIds = new Set(experiments.map((node) => node.id));
    const obstacles = [...placements.values()].filter((card) => visibleIds.has(card.id));
    return experiments.flatMap((experiment) => {
      if (!experiment.basedOn) return [];
      const source = placements.get(experiment.basedOn);
      const target = placements.get(experiment.id);
      if (!source || !target || !visibleIds.has(source.id)) return [];
      return [{ experiment: experiment.id, route: orthogonalRoute(source, target, obstacles) }];
    });
  }, [experiments, placements]);
  return (
    <Svg
      width={width}
      height={height}
      style={styles.lineageOverlay}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {routes.map(({ experiment, route }) => (
        <Path
          key={experiment}
          testID={`canvas-edge-${experiment}`}
          d={roundedRoutePath(route.points)}
          fill="none"
          stroke={lineColor}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {routes.map(({ experiment, route }) => (
        <Polygon
          key={`${experiment}:arrow`}
          points={arrowPoints(route.end, route.direction)}
          fill={lineColor}
        />
      ))}
    </Svg>
  );
}

const ThemedLineageOverlay = withUnistyles(LineageOverlay);
const lineagePaletteMapping = (theme: Theme) => ({ lineColor: theme.colors.foregroundMuted });

function movePlacement(
  placement: ResolvedPlacement,
  gesture: DragDelta,
  snapToGrid: boolean,
): ResolvedPlacement {
  const columnDelta = gesture.dx / GRID_SIZE;
  const rowDelta = gesture.dy / GRID_SIZE;
  return {
    ...placement,
    column: Math.max(0, placement.column + (snapToGrid ? Math.round(columnDelta) : columnDelta)),
    row: Math.max(0, placement.row + (snapToGrid ? Math.round(rowDelta) : rowDelta)),
  };
}

function resizePlacement(
  placement: ResolvedPlacement,
  gesture: DragDelta,
  snapToGrid: boolean,
): ResolvedPlacement {
  const widthDelta = gesture.dx / GRID_SIZE;
  const heightDelta = gesture.dy / GRID_SIZE;
  return {
    ...placement,
    width: Math.max(
      MIN_WIDTH,
      placement.width + (snapToGrid ? Math.round(widthDelta) : widthDelta),
    ),
    height: Math.max(
      MIN_HEIGHT,
      placement.height + (snapToGrid ? Math.round(heightDelta) : heightDelta),
    ),
  };
}

function placementStyle(placement: ResolvedPlacement): ViewStyle {
  return geometryStyle({
    left: placement.column * GRID_SIZE,
    top: placement.row * GRID_SIZE,
    width: placement.width * GRID_SIZE,
    height: placement.height * GRID_SIZE,
  });
}

function geometryStyle(style: ViewStyle): ViewStyle {
  return inlineUnistylesStyle(style);
}

interface DragDelta {
  dx: number;
  dy: number;
}

function useWebPointerDrag({
  enabled,
  onGrant,
  onMove,
  onRelease,
}: {
  enabled: boolean;
  onGrant: () => void;
  onMove: (delta: DragDelta) => void;
  onRelease: (delta: DragDelta) => void;
}): (event: RNPointerEvent) => void {
  const callbacksRef = useRef({ onGrant, onMove, onRelease });
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!enabled) cleanupRef.current?.();
    return () => cleanupRef.current?.();
  }, [enabled]);
  callbacksRef.current = { onGrant, onMove, onRelease };

  return useCallback(
    (event: RNPointerEvent) => {
      if (!isWeb || !enabled || event.nativeEvent.button !== 0) return;
      cleanupRef.current?.();
      const element = event.currentTarget as unknown as HTMLElement | null;
      if (!element) return;
      const pointerId = event.nativeEvent.pointerId;
      const startX = event.nativeEvent.clientX;
      const startY = event.nativeEvent.clientY;
      let latest = { dx: 0, dy: 0 };
      callbacksRef.current.onGrant();
      event.preventDefault();
      event.stopPropagation();
      try {
        element.setPointerCapture?.(pointerId);
      } catch {
        // Window listeners still own the drag if capture races with pointer release.
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        latest = { dx: moveEvent.clientX - startX, dy: moveEvent.clientY - startY };
        if (moveEvent.cancelable) moveEvent.preventDefault();
        callbacksRef.current.onMove(latest);
      };
      const finish = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;
        cleanup();
        callbacksRef.current.onRelease(latest);
      };
      const cleanup = () => {
        cleanupRef.current = null;
        if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      };
      cleanupRef.current = cleanup;

      window.addEventListener("pointermove", handlePointerMove, { passive: false });
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [enabled],
  );
}

interface Point {
  x: number;
  y: number;
}

function arrowPoints(end: Point, direction: "left" | "right" | "up" | "down"): string {
  const size = 7;
  if (direction === "right") {
    return `${end.x},${end.y} ${end.x - size},${end.y - size / 2} ${end.x - size},${end.y + size / 2}`;
  }
  if (direction === "left") {
    return `${end.x},${end.y} ${end.x + size},${end.y - size / 2} ${end.x + size},${end.y + size / 2}`;
  }
  if (direction === "down") {
    return `${end.x},${end.y} ${end.x - size / 2},${end.y - size} ${end.x + size / 2},${end.y - size}`;
  }
  return `${end.x},${end.y} ${end.x - size / 2},${end.y + size} ${end.x + size / 2},${end.y + size}`;
}

const styles = StyleSheet.create((theme) => ({
  viewport: {
    flex: 1,
    minHeight: { xs: 360, md: 480 },
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
  },
  panSurface: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  world: { position: "absolute", left: 0, top: 0, zIndex: 2 },
  grid: { ...StyleSheet.absoluteFillObject },
  gridVertical: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: theme.colors.borderAccent,
  },
  gridHorizontal: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: theme.colors.borderAccent,
  },
  lineageOverlay: { position: "absolute", left: 0, top: 0 },
  cardContainer: { position: "absolute", overflow: "visible" },
  card: {
    flex: 1,
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  cardSelected: { borderColor: theme.colors.accent, borderWidth: 2 },
  cardHeader: {
    height: 34,
    paddingHorizontal: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  cardTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  cardBody: { flex: 1, padding: theme.spacing[3], gap: theme.spacing[2] },
  cardProgressHoverPanel: {
    position: "absolute",
    left: "100%",
    top: 0,
    width: 280,
    marginLeft: theme.spacing[2],
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  resizeHandle: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
}));
