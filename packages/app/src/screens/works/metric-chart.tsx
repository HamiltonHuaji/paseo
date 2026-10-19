import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PointerEvent,
} from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";
import type { WorkMetrics } from "@getpaseo/protocol/work-objects";
import type { WorkDataSeries } from "@getpaseo/protocol/work-data";
import { Button } from "@/components/ui/button";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import {
  formatMetric,
  logTicks,
  nearestPoint,
  numericTicks,
  paddedDomain,
  plotGeometry,
} from "./metric-chart-model";
import { workStyles as styles } from "./styles";

type Panel = WorkMetrics["panels"][number];
type Geometry = ReturnType<typeof plotGeometry>;
type Sample = [number, number] | null;
interface ChartProps {
  panel: Panel;
  series: WorkDataSeries[];
  preview: boolean;
}
interface Palette {
  colors: string[];
  axisColor: string;
  gridColor: string;
  surfaceColor: string;
  fontSize: number;
  fontFamily: string;
}

function useChartState(panel: Panel, series: WorkDataSeries[]) {
  const [cursor, setCursor] = useState<number | null>(null);
  const pinned = useRef(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const active = useMemo(
    () =>
      series.map((entry) =>
        hidden.includes(JSON.stringify(entry.key)) ? { ...entry, points: [] } : entry,
      ),
    [series, hidden],
  );
  const geometry = useMemo(
    () => plotGeometry(active, panel.scale === "log"),
    [active, panel.scale],
  );
  const sortedPoints = useMemo(
    () => series.map((entry) => entry.points?.slice().sort((a, b) => a[0] - b[0])),
    [series],
  );
  const samples = useMemo(
    () => sortedPoints.map((points) => (cursor === null ? null : nearestPoint(points, cursor))),
    [sortedPoints, cursor],
  );
  const inspect = useCallback((x: number) => {
    if (!pinned.current) setCursor(x);
  }, []);
  const clear = useCallback(() => {
    setCursor(null);
    pinned.current = false;
  }, []);
  const leave = useCallback(() => {
    if (!pinned.current) setCursor(null);
  }, []);
  const pin = useCallback((x: number) => {
    pinned.current = !pinned.current;
    setCursor(pinned.current ? x : null);
  }, []);
  const toggle = useCallback(
    (key: string) =>
      setHidden((current) =>
        current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
      ),
    [],
  );
  return { cursor, hidden, geometry, samples, inspect, clear, leave, pin, toggle };
}
type ChartState = ReturnType<typeof useChartState>;

function MetricChart(props: ChartProps & Palette) {
  const { panel, series, preview } = props;
  const state = useChartState(panel, series);
  const hasHistory = Number.isFinite(state.geometry.xMin);
  return (
    <View style={styles.chartContent}>
      {panel.display === "line" && hasHistory ? <MetricPlot {...props} state={state} /> : null}
      {panel.display === "line" && !hasHistory ? (
        <View style={styles.chartEmpty}>
          <Text style={styles.meta}>{emptyMessage(series, state)}</Text>
        </View>
      ) : null}
      <ChartReadout {...props} state={state} />
      {!preview && state.geometry.excluded > 0 ? (
        <Text style={styles.chartCaption}>
          {state.geometry.excluded} invalid or nonpositive samples omitted
          {panel.scale === "log" ? " on log scale" : ""}
        </Text>
      ) : null}
    </View>
  );
}
function emptyMessage(series: WorkDataSeries[], state: ChartState): string {
  if (
    series.length > 0 &&
    series.every((entry) => state.hidden.includes(JSON.stringify(entry.key)))
  )
    return "Select a series below";
  if (state.geometry.excluded) return "No positive values for logarithmic scale";
  return "No numeric history";
}

function createAxes(
  geometry: Geometry,
  width: number,
  height: number,
  log: boolean,
  fontSize: number,
  preview: boolean,
) {
  const [xMin, xMax] =
    geometry.xMin === geometry.xMax
      ? [geometry.xMin - 1, geometry.xMax + 1]
      : [geometry.xMin, geometry.xMax];
  const [yMin, yMax] = paddedDomain(geometry.yMin, geometry.yMax);
  const yTicks = log ? logTicks(yMin, yMax) : numericTicks(yMin, yMax, preview ? 4 : 6);
  const yLabel = (value: number) => axisNumber(log ? 10 ** value : value);
  const left = Math.max(46, ...yTicks.map((value) => yLabel(value).length * fontSize * 0.62 + 12));
  const right = Math.max(20, axisNumber(xMax).length * fontSize * 0.31 + 4),
    top = 12,
    bottom = fontSize * 2 + 20;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = height - top - bottom;
  const ticks = numericTicks(xMin, xMax, Math.max(2, Math.floor(plotWidth / 85)));
  const xTicks = ticks.length < 2 ? [xMin, xMax] : ticks;
  const projectX = (x: number) => left + ((x - xMin) / (xMax - xMin)) * plotWidth;
  const projectY = (y: number) => top + (1 - (y - yMin) / (yMax - yMin)) * plotHeight;
  const xAt = (position: number) =>
    xMin + Math.max(0, Math.min(1, (position - left) / plotWidth)) * (xMax - xMin);
  return {
    xMin,
    xMax,
    left,
    right,
    top,
    bottom,
    height,
    width,
    xTicks,
    yTicks,
    yLabel,
    projectX,
    projectY,
    xAt,
  };
}
type Axes = ReturnType<typeof createAxes>;

function MetricPlot(props: ChartProps & Palette & { state: ChartState }) {
  const { panel, preview, fontSize, state } = props;
  const { pin, inspect } = state;
  const [width, setWidth] = useState(310);
  const height = preview ? 148 : 240;
  const axes = useMemo(
    () => createAxes(state.geometry, width, height, panel.scale === "log", fontSize, preview),
    [state.geometry, width, height, panel.scale, fontSize, preview],
  );
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    if (event.nativeEvent.layout.width > 0) setWidth(event.nativeEvent.layout.width);
  }, []);
  const onPress = useCallback(
    (event: GestureResponderEvent) => {
      let x = event.nativeEvent.locationX;
      if (isWeb) {
        const element = event.currentTarget as unknown as HTMLElement;
        x = event.nativeEvent.pageX - element.getBoundingClientRect().left - window.scrollX;
      }
      if (Number.isFinite(x)) pin(axes.xAt(x));
    },
    [pin, axes],
  );
  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      if (!isWeb) return;
      const element = event.currentTarget as unknown as HTMLElement;
      inspect(axes.xAt(event.nativeEvent.clientX - element.getBoundingClientRect().left));
    },
    [inspect, axes],
  );
  return (
    <Pressable
      onLayout={onLayout}
      onPress={onPress}
      onPointerMove={isWeb ? onPointerMove : undefined}
      onHoverOut={state.leave}
      accessibilityRole="button"
      accessibilityLabel={`Inspect ${panel.title ?? "metric history"}`}
      accessibilityHint="Point at the plot to read samples. Tap to pin a reading, tap again to release."
      style={styles.chartPlot}
    >
      <Svg
        pointerEvents="none"
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        accessibilityLabel="Metric history"
      >
        <ChartAxes {...props} axes={axes} />
        <SeriesPaths
          geometry={state.geometry}
          series={props.series}
          axes={axes}
          colors={props.colors}
        />
        <CursorMarkers {...props} axes={axes} />
      </Svg>
    </Pressable>
  );
}
type SvgProps = ChartProps & Palette & { state: ChartState; axes: Axes };
function ChartAxes({ panel, axes: a, axisColor, gridColor, fontSize, fontFamily }: SvgProps) {
  return (
    <>
      {a.yTicks.map((tick) => (
        <Line
          key={`grid-y-${tick}`}
          x1={a.left}
          x2={a.width - a.right}
          y1={a.projectY(tick)}
          y2={a.projectY(tick)}
          stroke={gridColor}
        />
      ))}
      {a.xTicks.map((tick) => (
        <Line
          key={`grid-x-${tick}`}
          x1={a.projectX(tick)}
          x2={a.projectX(tick)}
          y1={a.top}
          y2={a.height - a.bottom}
          stroke={gridColor}
          strokeDasharray="2 4"
        />
      ))}
      {a.yTicks.map((tick) => (
        <SvgText
          key={`label-y-${tick}`}
          x={a.left - 8}
          y={a.projectY(tick) + fontSize / 3}
          fontSize={fontSize}
          fontFamily={fontFamily}
          fill={axisColor}
          textAnchor="end"
        >
          {a.yLabel(tick)}
        </SvgText>
      ))}
      {a.xTicks.map((tick) => (
        <SvgText
          key={`label-x-${tick}`}
          x={a.projectX(tick)}
          y={a.height - a.bottom + fontSize + 6}
          fontSize={fontSize}
          fontFamily={fontFamily}
          fill={axisColor}
          textAnchor="middle"
        >
          {formatX(panel, tick, true, a.xMax - a.xMin)}
        </SvgText>
      ))}
      <SvgText
        x={(a.left + a.width - a.right) / 2}
        y={a.height - 2}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fill={axisColor}
        textAnchor="middle"
      >
        {axisLabel(panel)}
      </SvgText>
    </>
  );
}
// Keep long history paths out of cursor updates; only the cursor/readout changes on pointer movement.
function HistoryPaths({
  geometry,
  series,
  axes: a,
  colors,
}: Pick<SvgProps, "series" | "axes" | "colors"> & { geometry: Geometry }) {
  return (
    <>
      {geometry.paths.flatMap((runs, index) =>
        runs.map((run) => {
          const key = `${JSON.stringify(series[index]!.key)}:${run[0]!.join(":")}`;
          if (run.length === 1)
            return (
              <Circle
                key={key}
                cx={a.projectX(run[0]![0])}
                cy={a.projectY(run[0]![1])}
                r={3}
                fill={colors[index % colors.length]}
              />
            );
          return (
            <Polyline
              key={key}
              points={run.map(([x, y]) => `${a.projectX(x)},${a.projectY(y)}`).join(" ")}
              stroke={colors[index % colors.length]}
              strokeWidth={1.8}
              strokeLinejoin="round"
              strokeDasharray={index >= colors.length ? "5 3" : undefined}
              fill="none"
            />
          );
        }),
      )}
    </>
  );
}
const SeriesPaths = memo(HistoryPaths);
function CursorMarkers({
  state,
  series,
  panel,
  axes: a,
  colors,
  axisColor,
  surfaceColor,
}: SvgProps) {
  if (state.cursor === null) return null;
  const log = panel.scale === "log";
  return (
    <>
      <Line
        x1={a.projectX(state.cursor)}
        x2={a.projectX(state.cursor)}
        y1={a.top}
        y2={a.height - a.bottom}
        stroke={axisColor}
        strokeDasharray="4 3"
      />
      {state.samples.map((point, index) => {
        const key = JSON.stringify(series[index]!.key);
        if (!point || state.hidden.includes(key) || (log && point[1] <= 0)) return null;
        return (
          <Circle
            key={key}
            cx={a.projectX(point[0])}
            cy={a.projectY(log ? Math.log10(point[1]) : point[1])}
            r={3.5}
            fill={colors[index % colors.length]}
            stroke={surfaceColor}
            strokeWidth={1.5}
          />
        );
      })}
    </>
  );
}
function ChartReadout({
  panel,
  series,
  preview,
  colors,
  state,
}: ChartProps & Palette & { state: ChartState }) {
  const visible = preview ? series.slice(0, 2) : series;
  return (
    <View style={styles.chartReadout} testID={`metric-readout-${panel.id}`}>
      <View style={styles.between}>
        <Text style={[styles.chartCaption, styles.grow]} numberOfLines={1}>
          {state.cursor === null
            ? statisticLabel(panel)
            : `Nearest samples · ${axisLabel(panel)} ${formatX(panel, state.cursor)}`}
          {preview && series.length > visible.length
            ? ` · +${series.length - visible.length} in details`
            : ""}
        </Text>
        {!preview && panel.display === "line" ? (
          <Button variant="ghost" size="xs" onPress={state.clear} disabled={state.cursor === null}>
            Reset cursor
          </Button>
        ) : null}
      </View>
      {visible.map((entry, index) => (
        <SeriesRow
          key={JSON.stringify(entry.key)}
          entry={entry}
          label={panel.series[index]?.label ?? entry.key.join("/")}
          color={colors[index % colors.length]!}
          sample={state.samples[index] ?? null}
          inspecting={state.cursor !== null}
          panel={panel}
          hidden={state.hidden.includes(JSON.stringify(entry.key))}
          toggle={preview || panel.display !== "line" ? undefined : state.toggle}
          preview={preview}
        />
      ))}
    </View>
  );
}
function SeriesRow({
  entry,
  label,
  color,
  sample,
  inspecting,
  panel,
  hidden,
  toggle,
  preview,
}: {
  entry: WorkDataSeries;
  label: string;
  color: string;
  sample: Sample;
  inspecting: boolean;
  panel: Panel;
  hidden: boolean;
  toggle?: (key: string) => void;
  preview: boolean;
}) {
  const key = JSON.stringify(entry.key);
  const press = useCallback(() => toggle?.(key), [key, toggle]);
  const value = inspecting ? (sample?.[1] ?? null) : entry[panel.statistic ?? "last"];
  const swatchStyle = useMemo(
    () => [styles.metricSwatch, inlineUnistylesStyle({ backgroundColor: color })],
    [color],
  );
  const swatch = useMemo(() => <View style={swatchStyle} />, [swatchStyle]);
  const state = useMemo(() => ({ selected: !hidden }), [hidden]);
  return (
    <View style={[styles.chartSeries, hidden && styles.chartSeriesHidden]}>
      <View style={styles.grow}>
        {toggle ? (
          <Button
            variant="ghost"
            size="xs"
            style={styles.link}
            textStyle={styles.linkText}
            leftIcon={swatch}
            onPress={press}
            accessibilityLabel={`${hidden ? "Show" : "Hide"} ${label}`}
            accessibilityState={state}
          >
            {label}
          </Button>
        ) : (
          <View style={styles.metricLegend}>
            {swatch}
            <Text style={[styles.meta, styles.grow]} numberOfLines={1}>
              {label}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.chartValueColumn}>
        <Text style={styles.metricValue} selectable={!preview}>
          {seriesValue(entry.status, value)}
        </Text>
        {!preview ? (
          <Text style={styles.chartCaption}>{sampleCaption(panel, entry, inspecting, sample)}</Text>
        ) : null}
      </View>
    </View>
  );
}
function sampleCaption(
  panel: Panel,
  entry: WorkDataSeries,
  inspecting: boolean,
  sample: Sample,
): string {
  if (inspecting) return sample ? `${axisLabel(panel)} ${formatX(panel, sample[0])}` : "No sample";
  const latest = entry.points?.at(-1);
  if (latest && (!panel.statistic || panel.statistic === "last"))
    return `${axisLabel(panel)} ${formatX(panel, latest[0])}`;
  return `${entry.count.toLocaleString()} samples`;
}
function seriesValue(status: WorkDataSeries["status"], value: number | null): string {
  if (status === "available") return formatMetric(value);
  if (status === "non_numeric") return "Not numeric";
  return status === "missing" ? "Not recorded" : "No samples";
}
export function axisLabel(panel: Panel): string {
  if (panel.x?.kind === "metric") return panel.x.key.join("/");
  return panel.x?.kind === "time" ? "Time" : "Step";
}
function statisticLabel(panel: Panel): string {
  return { last: "Latest recorded", min: "Minimum", max: "Maximum", mean: "Mean" }[
    panel.statistic ?? "last"
  ];
}
function axisNumber(value: number): string {
  if (value === 0) return "0";
  if (Math.abs(value) < 0.001 || Math.abs(value) >= 1e6)
    return value.toExponential(1).replace(".0e", "e");
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 }).format(value);
}
function formatX(panel: Panel, value: number, tick = false, span = 0): string {
  if (panel.x?.kind !== "time") return tick ? axisNumber(value) : formatMetric(value);
  const date = new Date(value * 1000);
  if (!tick) return date.toLocaleString();
  if (span >= 86400) return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
export const ThemedMetricChart = withUnistyles(MetricChart);
export const chartPalette = (theme: Theme): Palette => ({
  colors: [
    theme.colors.accent,
    theme.colors.statusSuccess,
    theme.colors.statusWarning,
    theme.colors.statusDanger,
  ],
  axisColor: theme.colors.foregroundMuted,
  gridColor: theme.colors.border,
  surfaceColor: theme.colors.surface1,
  fontSize: theme.fontSize.sm,
  fontFamily: theme.fontFamily.mono,
});
