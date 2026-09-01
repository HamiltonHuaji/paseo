import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type PointerEvent as RNPointerEvent,
  type ViewStyle,
} from "react-native";
import { Grip, Maximize2 } from "lucide-react-native";
import Svg, { Polygon, Polyline } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
  ExperimentAttempt,
  ExperimentBoardPlacement,
  ExperimentDetail,
  ExperimentRecord,
} from "@getpaseo/protocol/experiments";
import { StatusBadge } from "@/components/ui/status-badge";
import { isWeb } from "@/constants/platform";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { Theme } from "@/styles/theme";
import {
  EXPERIMENT_CANVAS_GRID_SIZE,
  buildAutomaticLayout,
  canvasDimensions,
  fallbackPlacement,
  orthogonalRoute,
  resolvePlacement,
  type ResolvedPlacement,
} from "./experiment-canvas-layout";
import {
  progressUnit,
  resolveAttemptProgressState,
  selectCardProgressAttempts,
} from "./experiment-progress-state";

const GRID_SIZE = EXPERIMENT_CANVAS_GRID_SIZE;
const MIN_WIDTH = 9;
const MIN_HEIGHT = 6;
const ThemedGrip = withUnistyles(Grip);
const ThemedMaximize2 = withUnistyles(Maximize2);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface CanvasCamera {
  x: number;
  y: number;
}

interface ExperimentCanvasProps {
  experiments: ExperimentRecord[];
  detailByExperiment: Map<string, ExperimentDetail>;
  storedPlacements: ExperimentBoardPlacement[];
  selectedExperiment: string | null;
  onSelectExperiment: (experiment: string) => void;
  onClearSelection: () => void;
  onPersistPlacement: (placement: ExperimentBoardPlacement) => void;
}

export function ExperimentCanvas({
  experiments,
  detailByExperiment,
  storedPlacements,
  selectedExperiment,
  onSelectExperiment,
  onClearSelection,
  onPersistPlacement,
}: ExperimentCanvasProps) {
  const persisted = useMemo(
    () => new Map(storedPlacements.map((placement) => [placement.experiment, placement])),
    [storedPlacements],
  );
  const automatic = useMemo(
    () => buildAutomaticLayout(experiments, detailByExperiment),
    [detailByExperiment, experiments],
  );
  const [localPlacements, setLocalPlacements] = useState<Record<string, ResolvedPlacement>>({});
  const [camera, setCameraState] = useState<CanvasCamera>({ x: 0, y: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const cameraRef = useRef(camera);
  const viewportRef = useRef<View>(null);
  const pointerInsideViewportRef = useRef(false);
  const panOriginRef = useRef({ x: 0, y: 0 });
  const placements = useMemo(
    () =>
      new Map(
        experiments.map((experiment, index) => {
          const fallback = automatic.get(experiment.id) ?? fallbackPlacement(experiment.id, index);
          const stored = persisted.get(experiment.id);
          const placement = localPlacements[experiment.id] ?? resolvePlacement(stored, fallback);
          return [experiment.id, placement] as const;
        }),
      ),
    [automatic, experiments, localPlacements, persisted],
  );
  const worldDimensions = useMemo(() => canvasDimensions(placements), [placements]);
  const updateCamera = useCallback((next: CanvasCamera) => {
    cameraRef.current = next;
    setCameraState(next);
  }, []);
  const previewPlacement = useCallback((placement: ResolvedPlacement) => {
    setLocalPlacements((current) => ({ ...current, [placement.experiment]: placement }));
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
        transform: [{ translateX: camera.x }, { translateY: camera.y }],
      }),
    ],
    [camera.x, camera.y, worldDimensions.height, worldDimensions.width],
  );
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewportSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  }, []);
  useEffect(() => {
    if (!isWeb) return;
    const element = viewportRef.current as unknown as HTMLElement | null;
    if (!element) return;
    const handlePointerEnter = () => {
      pointerInsideViewportRef.current = true;
    };
    const handlePointerLeave = () => {
      pointerInsideViewportRef.current = false;
    };
    const handleWheel = (event: WheelEvent) => {
      if (!pointerInsideViewportRef.current && !element.matches(":hover")) return;
      if (event.cancelable) event.preventDefault();
      const current = cameraRef.current;
      updateCamera({ x: current.x - event.deltaX, y: current.y - event.deltaY });
    };
    element.addEventListener("pointerenter", handlePointerEnter);
    element.addEventListener("pointerleave", handlePointerLeave);
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      pointerInsideViewportRef.current = false;
      element.removeEventListener("pointerenter", handlePointerEnter);
      element.removeEventListener("pointerleave", handlePointerLeave);
      element.removeEventListener("wheel", handleWheel);
    };
  }, [updateCamera]);
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
            x: panOriginRef.current.x + gesture.dx,
            y: panOriginRef.current.y + gesture.dy,
          });
        },
      }),
    [updateCamera],
  );
  const handleCanvasPointerDown = useWebPointerDrag({
    onGrant: () => {
      panOriginRef.current = { ...cameraRef.current };
    },
    onMove: ({ dx, dy }) => {
      updateCamera({
        x: panOriginRef.current.x + dx,
        y: panOriginRef.current.y + dy,
      });
    },
    onRelease: ({ dx, dy }) => {
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) onClearSelection();
    },
  });

  return (
    <View ref={viewportRef} style={styles.viewport} onLayout={handleLayout}>
      <GridLines width={viewportSize.width} height={viewportSize.height} camera={camera} />
      <View
        style={styles.panSurface}
        onPointerDown={handleCanvasPointerDown}
        {...(!isWeb ? canvasPanResponder.panHandlers : {})}
      />
      <View pointerEvents="box-none" style={worldStyle}>
        <ThemedLineageOverlay
          experiments={experiments}
          placements={placements}
          width={worldDimensions.width}
          height={worldDimensions.height}
          uniProps={lineagePaletteMapping}
        />
        {experiments.map((experiment) => {
          const placement = placements.get(experiment.id);
          if (!placement) return null;
          return (
            <CanvasCard
              key={experiment.id}
              experiment={experiment}
              detail={detailByExperiment.get(experiment.id) ?? null}
              placement={placement}
              selected={experiment.id === selectedExperiment}
              onSelect={onSelectExperiment}
              onPreviewPlacement={previewPlacement}
              onCommitPlacement={commitPlacement}
            />
          );
        })}
      </View>
    </View>
  );
}

function CanvasCard({
  experiment,
  detail,
  placement,
  selected,
  onSelect,
  onPreviewPlacement,
  onCommitPlacement,
}: {
  experiment: ExperimentRecord;
  detail: ExperimentDetail | null;
  placement: ResolvedPlacement;
  selected: boolean;
  onSelect: (experiment: string) => void;
  onPreviewPlacement: (placement: ResolvedPlacement) => void;
  onCommitPlacement: (placement: ResolvedPlacement) => void;
}) {
  const placementRef = useRef(placement);
  const gestureOriginRef = useRef(placement);
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
        },
        onPanResponderMove: (_, gesture) => {
          previewRef.current(movePlacement(gestureOriginRef.current, gesture, false));
        },
        onPanResponderRelease: (_, gesture) => {
          if (Math.abs(gesture.dx) < 3 && Math.abs(gesture.dy) < 3) onSelect(experiment.id);
          else commitRef.current(movePlacement(gestureOriginRef.current, gesture, true));
        },
        onPanResponderTerminate: (_, gesture) => {
          commitRef.current(movePlacement(gestureOriginRef.current, gesture, true));
        },
      }),
    [experiment.id, onSelect],
  );
  const handleDragPointerDown = useWebPointerDrag({
    onGrant: () => {
      gestureOriginRef.current = placementRef.current;
    },
    onMove: (gesture) => {
      previewRef.current(movePlacement(gestureOriginRef.current, gesture, false));
    },
    onRelease: (gesture) => {
      if (Math.abs(gesture.dx) < 3 && Math.abs(gesture.dy) < 3) onSelect(experiment.id);
      else commitRef.current(movePlacement(gestureOriginRef.current, gesture, true));
    },
  });
  const resizeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          gestureOriginRef.current = placementRef.current;
        },
        onPanResponderMove: (_, gesture) => {
          previewRef.current(resizePlacement(gestureOriginRef.current, gesture, false));
        },
        onPanResponderRelease: (_, gesture) => {
          commitRef.current(resizePlacement(gestureOriginRef.current, gesture, true));
        },
        onPanResponderTerminate: (_, gesture) => {
          commitRef.current(resizePlacement(gestureOriginRef.current, gesture, true));
        },
      }),
    [],
  );
  const handleResizePointerDown = useWebPointerDrag({
    onGrant: () => {
      gestureOriginRef.current = placementRef.current;
    },
    onMove: (gesture) => {
      previewRef.current(resizePlacement(gestureOriginRef.current, gesture, false));
    },
    onRelease: (gesture) => {
      commitRef.current(resizePlacement(gestureOriginRef.current, gesture, true));
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
  const progressAttempts = detail ? selectCardProgressAttempts(detail) : [];
  const primaryProgressAttempt = progressAttempts.at(-1) ?? null;
  const handleSelect = useCallback(() => onSelect(experiment.id), [experiment.id, onSelect]);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  return (
    <View
      style={containerStyle}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <View style={cardStyle}>
        <View
          style={styles.cardHeader}
          onPointerDown={handleDragPointerDown}
          {...(!isWeb ? dragResponder.panHandlers : {})}
        >
          <ThemedGrip size={14} uniProps={mutedIconMapping} />
          <Text style={styles.cardTitle} numberOfLines={1}>
            {experiment.shortDescription}
          </Text>
        </View>
        <Pressable style={styles.cardBody} onPress={handleSelect}>
          <Text style={styles.cardDescription} numberOfLines={3}>
            {experiment.description}
          </Text>
          <View style={styles.badges}>
            {experiment.goal ? <StatusBadge label={experiment.goal} /> : null}
            {detail ? (
              <StatusBadge label={`${detail.attempts.length} attempts`} variant="muted" />
            ) : null}
            {experiment.conclusion ? <StatusBadge label="concluded" variant="success" /> : null}
          </View>
          {primaryProgressAttempt ? (
            <View style={styles.cardProgressList}>
              <CardAttemptProgress attempt={primaryProgressAttempt} />
            </View>
          ) : null}
        </Pressable>
        <View
          style={styles.resizeHandle}
          onPointerDown={handleResizePointerDown}
          {...(!isWeb ? resizeResponder.panHandlers : {})}
        >
          <ThemedMaximize2 size={13} uniProps={mutedIconMapping} />
        </View>
      </View>
      {progressAttempts.length > 1 ? (
        <View
          pointerEvents="none"
          style={[
            styles.cardProgressHoverPanel,
            isHovered ? styles.cardProgressHoverPanelVisible : null,
          ]}
        >
          <Text style={styles.cardProgressHoverTitle}>Unfinished attempts</Text>
          {progressAttempts.map((attempt) => (
            <CardAttemptProgress key={attempt.id} attempt={attempt} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function cardZIndex(isHovered: boolean, selected: boolean): number {
  if (isHovered) return 4;
  if (selected) return 3;
  return 2;
}

function CardAttemptProgress({ attempt }: { attempt: ExperimentAttempt }) {
  const state = resolveAttemptProgressState(attempt);
  const observation = attempt.progress;
  const status = cardProgressStatus(attempt, state.kind);
  return (
    <View style={styles.cardProgressRow}>
      <Text
        style={[
          styles.cardProgressText,
          attempt.progressError ? styles.cardProgressTextError : null,
        ]}
        numberOfLines={1}
      >
        {attempt.shortDescription} · {status}
      </Text>
      <View style={styles.cardProgressTrack}>
        <CardProgressTrackFill state={state} hasObservation={observation !== null} />
      </View>
    </View>
  );
}

function cardProgressStatus(
  attempt: ExperimentAttempt,
  kind: ReturnType<typeof resolveAttemptProgressState>["kind"],
): string {
  const observation = attempt.progress;
  if (!observation) return attempt.progressError ? "unavailable" : "unknown";
  const unit = progressUnit(attempt);
  const value = formatNumber(observation.current);
  const suffix = unit ? ` ${unit}` : "";
  if (kind === "indeterminate") return `${value}${suffix} · total unknown`;
  const state = resolveAttemptProgressState(attempt);
  const total = state.total === null ? "?" : formatNumber(state.total);
  let ending = "";
  if (kind === "ended") ending = " · ended";
  else if (attempt.progressError) ending = " · stale";
  return `${value} / ${total}${suffix}${ending}`;
}

function CardProgressTrackFill({
  state,
  hasObservation,
}: {
  state: ReturnType<typeof resolveAttemptProgressState>;
  hasObservation: boolean;
}) {
  if (state.ratio !== null) {
    return (
      <View
        style={[
          styles.cardProgressFill,
          state.kind === "ended" ? styles.cardProgressFillEnded : null,
          percentageWidth(state.ratio),
        ]}
      />
    );
  }
  return state.kind === "indeterminate" && hasObservation ? (
    <View style={styles.cardProgressIndeterminate} />
  ) : null;
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
  const verticalLines = gridLinePositions(width, camera.x);
  const horizontalLines = gridLinePositions(height, camera.y);
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

function gridLinePositions(viewportLength: number, cameraOffset: number): number[] {
  const first = positiveModulo(cameraOffset, GRID_SIZE) - GRID_SIZE;
  const count = Math.ceil(viewportLength / GRID_SIZE) + 2;
  return Array.from({ length: count }, (_, index) => first + index * GRID_SIZE);
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

interface LineageOverlayProps {
  experiments: ExperimentRecord[];
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
  const routes = experiments.flatMap((experiment) => {
    if (!experiment.basedOn) return [];
    const source = placements.get(experiment.basedOn);
    const target = placements.get(experiment.id);
    if (!source || !target) return [];
    return [{ experiment: experiment.id, route: orthogonalRoute(source, target) }];
  });
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
        <Polyline
          key={experiment}
          points={route.points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke={lineColor}
          strokeWidth={1.5}
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
  onGrant,
  onMove,
  onRelease,
}: {
  onGrant: () => void;
  onMove: (delta: DragDelta) => void;
  onRelease: (delta: DragDelta) => void;
}): (event: RNPointerEvent) => void {
  const callbacksRef = useRef({ onGrant, onMove, onRelease });
  callbacksRef.current = { onGrant, onMove, onRelease };

  return useCallback((event: RNPointerEvent) => {
    if (!isWeb || event.nativeEvent.button !== 0) return;
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
      if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, []);
}

function percentageWidth(ratio: number): ViewStyle {
  return inlineUnistylesStyle({ width: `${ratio * 100}%` });
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
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
  cardDescription: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1] },
  cardProgressList: { marginTop: "auto", gap: theme.spacing[2] },
  cardProgressRow: { gap: theme.spacing[1] },
  cardProgressTrack: {
    height: 6,
    overflow: "hidden",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
  },
  cardProgressFill: {
    height: "100%",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  cardProgressFillEnded: { backgroundColor: theme.colors.statusSuccess },
  cardProgressIndeterminate: {
    width: "24%",
    height: "100%",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    opacity: theme.opacity[50],
  },
  cardProgressText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  cardProgressTextError: { color: theme.colors.statusDanger },
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
    opacity: theme.opacity[0],
  },
  cardProgressHoverPanelVisible: { opacity: theme.opacity[100] },
  cardProgressHoverTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
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
