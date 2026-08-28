import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PointerEvent as RNPointerEvent,
  type ViewStyle,
} from "react-native";
import { Grip, Maximize2 } from "lucide-react-native";
import Svg, { Polygon, Polyline } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
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

const GRID_SIZE = EXPERIMENT_CANVAS_GRID_SIZE;
const PAN_MARGIN = GRID_SIZE * 12;
const MIN_WIDTH = 9;
const MIN_HEIGHT = 6;
const ThemedGrip = withUnistyles(Grip);
const ThemedMaximize2 = withUnistyles(Maximize2);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

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
  const horizontalScrollRef = useRef<ScrollView>(null);
  const verticalScrollRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef({ x: 0, y: 0 });
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
  const measuredDimensions = useMemo(() => canvasDimensions(placements), [placements]);
  // A shrinking bottom edge changes the outer ScrollView offset while its last card is dragged.
  const [minimumDimensions, setMinimumDimensions] = useState(measuredDimensions);
  const dimensions = useMemo(
    () => ({
      width: Math.max(measuredDimensions.width, minimumDimensions.width),
      height: Math.max(measuredDimensions.height, minimumDimensions.height),
    }),
    [measuredDimensions, minimumDimensions],
  );
  const surfaceDimensions = useMemo(
    () => ({
      width: dimensions.width + PAN_MARGIN * 2,
      height: dimensions.height + PAN_MARGIN * 2,
    }),
    [dimensions.height, dimensions.width],
  );
  useEffect(() => {
    setMinimumDimensions((current) => ({
      width: Math.max(current.width, measuredDimensions.width),
      height: Math.max(current.height, measuredDimensions.height),
    }));
  }, [measuredDimensions.height, measuredDimensions.width]);
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
  const canvasStyle = useMemo(
    () => [
      styles.canvas,
      geometryStyle({ width: surfaceDimensions.width, height: surfaceDimensions.height }),
    ],
    [surfaceDimensions.height, surfaceDimensions.width],
  );
  const contentLayerStyle = useMemo(
    () => [
      styles.contentLayer,
      geometryStyle({
        left: PAN_MARGIN,
        top: PAN_MARGIN,
        width: dimensions.width,
        height: dimensions.height,
      }),
    ],
    [dimensions.height, dimensions.width],
  );
  const handleHorizontalScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current.x = event.nativeEvent.contentOffset.x;
  }, []);
  const handleVerticalScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffsetRef.current.y = event.nativeEvent.contentOffset.y;
  }, []);
  useEffect(() => {
    scrollOffsetRef.current = { x: PAN_MARGIN, y: PAN_MARGIN };
    horizontalScrollRef.current?.scrollTo({ x: PAN_MARGIN, animated: false });
    verticalScrollRef.current?.scrollTo({ y: PAN_MARGIN, animated: false });
  }, []);
  const canvasPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
        onPanResponderGrant: () => {
          panOriginRef.current = { ...scrollOffsetRef.current };
        },
        onPanResponderMove: (_, gesture) => {
          horizontalScrollRef.current?.scrollTo({
            x: Math.max(0, panOriginRef.current.x - gesture.dx),
            animated: false,
          });
          verticalScrollRef.current?.scrollTo({
            y: Math.max(0, panOriginRef.current.y - gesture.dy),
            animated: false,
          });
        },
      }),
    [],
  );
  const handleCanvasPointerDown = useWebPointerDrag({
    onGrant: () => {
      panOriginRef.current = { ...scrollOffsetRef.current };
    },
    onMove: ({ dx, dy }) => {
      horizontalScrollRef.current?.scrollTo({
        x: Math.max(0, panOriginRef.current.x - dx),
        animated: false,
      });
      verticalScrollRef.current?.scrollTo({
        y: Math.max(0, panOriginRef.current.y - dy),
        animated: false,
      });
    },
    onRelease: ({ dx, dy }) => {
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) onClearSelection();
    },
  });

  return (
    <ScrollView
      ref={verticalScrollRef}
      style={styles.viewport}
      contentContainerStyle={styles.verticalViewportContent}
      onScroll={handleVerticalScroll}
      scrollEventThrottle={16}
    >
      <ScrollView
        ref={horizontalScrollRef}
        horizontal
        contentContainerStyle={styles.viewportContent}
        onScroll={handleHorizontalScroll}
        scrollEventThrottle={16}
      >
        <View style={canvasStyle}>
          <View
            style={styles.panSurface}
            onPointerDown={handleCanvasPointerDown}
            {...(!isWeb ? canvasPanResponder.panHandlers : {})}
          />
          <GridLines width={surfaceDimensions.width} height={surfaceDimensions.height} />
          <View pointerEvents="box-none" style={contentLayerStyle}>
            <ThemedLineageOverlay
              experiments={experiments}
              placements={placements}
              width={dimensions.width}
              height={dimensions.height}
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
      </ScrollView>
    </ScrollView>
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
  const cardStyle = useMemo(
    () => [
      styles.card,
      selected && styles.cardSelected,
      placementStyle(placement),
      inlineUnistylesStyle({ zIndex: selected ? 3 : 2 }),
    ],
    [placement, selected],
  );
  const latestProgress = detail ? latestProgressAttempt(detail) : null;
  const progressPlan = latestProgress?.progressPlans;
  const sourcePlan = progressPlan?.units.find((plan) => plan.unit === progressPlan.sourceUnit);
  const progressRatio = latestProgress?.progress
    ? clamp(
        latestProgress.progress.current / (sourcePlan?.total ?? latestProgress.progress.total ?? 1),
        0,
        1,
      )
    : null;
  const handleSelect = useCallback(() => onSelect(experiment.id), [experiment.id, onSelect]);

  return (
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
        {progressRatio !== null && latestProgress ? (
          <View style={styles.cardProgressBlock}>
            <View style={styles.cardProgressTrack}>
              <View style={[styles.cardProgressFill, percentageWidth(progressRatio)]} />
            </View>
            <Text style={styles.cardProgressText} numberOfLines={1}>
              {latestProgress.shortDescription} · {formatNumber(latestProgress.progress!.current)}
              {progressPlan ? ` ${progressPlan.sourceUnit}` : ""}
            </Text>
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
  );
}

function GridLines({ width, height }: { width: number; height: number }) {
  const columns = Math.ceil(width / GRID_SIZE);
  const rows = Math.ceil(height / GRID_SIZE);
  return (
    <View style={styles.grid} pointerEvents="none">
      {Array.from({ length: columns + 1 }, (_, index) => (
        <View
          key={`column:${index}`}
          style={[styles.gridVertical, geometryStyle({ left: index * GRID_SIZE })]}
        />
      ))}
      {Array.from({ length: rows + 1 }, (_, index) => (
        <View
          key={`row:${index}`}
          style={[styles.gridHorizontal, geometryStyle({ top: index * GRID_SIZE })]}
        />
      ))}
    </View>
  );
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

function latestProgressAttempt(detail: ExperimentDetail) {
  return detail.attempts
    .toReversed()
    .find(
      (attempt) =>
        attempt.progress !== null ||
        attempt.progressSource !== null ||
        Boolean(attempt.progressPlans),
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
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
  },
  verticalViewportContent: { alignItems: "flex-start" },
  viewportContent: { alignItems: "flex-start" },
  canvas: { position: "relative", backgroundColor: theme.colors.surface0 },
  panSurface: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  contentLayer: { position: "absolute", zIndex: 2 },
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
  card: {
    position: "absolute",
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
  cardProgressBlock: { marginTop: "auto", gap: theme.spacing[1] },
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
  cardProgressText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
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
