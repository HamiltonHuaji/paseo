import React, { useMemo } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";
import type { WorkMetrics } from "@getpaseo/protocol/work-objects";
import { WorkDataQueryResultSchema, type WorkDataSeries } from "@getpaseo/protocol/work-data";
import { useFetchQuery } from "@/data/query";
import type { Theme } from "@/styles/theme";
import { dataPath, errorMessage, useWorks } from "./context";
import { workStyles as styles } from "./styles";

type Panel = WorkMetrics["panels"][number];
export function Metrics({ value }: { value: WorkMetrics }) {
  return (
    <View style={styles.stack}>
      {value.panels.map((panel) => (
        <MetricPanel key={panel.id} panel={panel} />
      ))}
    </View>
  );
}

function MetricPanel({ panel }: { panel: Panel }) {
  const { serverId, projectId, active, connected, readData } = useWorks();
  const queryInput = {
    series: panel.series.map((series) => series.key),
    x: panel.x,
    range: panel.range,
    mode: panel.display === "line" ? "series" : "summary",
  };
  const query = useFetchQuery({
    queryKey: ["works-data", serverId, projectId, panel.source, queryInput],
    queryFn: async ({ signal }) =>
      WorkDataQueryResultSchema.parse(
        await readData(
          `${dataPath(projectId, panel.source.objectId, panel.source.source)}/query?q=${encodeURIComponent(JSON.stringify(queryInput))}`,
          signal,
        ),
      ),
    enabled: active && connected,
    retry: false,
    dataShape: "value",
    staleTimeMs: 10_000,
    refetchInterval: active && connected ? 15_000 : false,
  });
  return (
    <View style={styles.section}>
      <Text style={styles.title}>
        {panel.title ??
          panel.series.map((series) => series.label ?? series.key.join(" / ")).join(", ")}
      </Text>
      {query.isPending ? <Text style={styles.meta}>Loading metrics…</Text> : null}
      {query.error ? <Text style={styles.error}>{errorMessage(query.error)}</Text> : null}
      {query.data?.error ? <Text style={styles.error}>{query.data.error}</Text> : null}
      {query.data && !query.data.caughtUp ? <Text style={styles.meta}>Reading data…</Text> : null}
      {query.data && panel.display === "line" ? (
        <ThemedMetricPlot
          series={query.data.series}
          log={panel.scale === "log"}
          uniProps={plotPalette}
        />
      ) : null}
      {query.data?.series.map((series, index) => (
        <Text key={JSON.stringify(series.key)} style={styles.meta}>
          {panel.series[index]?.label ?? series.key.join(" / ")}:{" "}
          {series.status === "available"
            ? formatMetric(series[panel.statistic ?? "last"])
            : metricStatus(series.status)}
        </Text>
      ))}
      {panel.display === "line" ? (
        <Text style={styles.meta}>
          {axisLabel(panel)}
          {panel.scale === "log" ? " · logarithmic Y" : ""}
        </Text>
      ) : null}
    </View>
  );
}

function axisLabel(panel: Panel): string {
  if (panel.x?.kind === "metric") return panel.x.key.join(" / ");
  return panel.x?.kind === "time" ? "Time (Unix seconds)" : "Step";
}
function metricStatus(status: WorkDataSeries["status"]): string {
  if (status === "non_numeric") return "not numeric";
  return status === "missing" ? "not recorded" : "no values in this range";
}
export function formatMetric(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 }).format(value);
}

export function plotGeometry(input: WorkDataSeries[], log: boolean) {
  let xMin = Infinity,
    xMax = -Infinity,
    yMin = Infinity,
    yMax = -Infinity,
    excluded = 0;
  const paths = input.map((series) => {
    const runs: [number, number][][] = [[]];
    for (const [x, raw] of series.points ?? []) {
      if (log && raw <= 0) {
        excluded++;
        if (runs.at(-1)?.length) runs.push([]);
        continue;
      }
      const y = log ? Math.log10(raw) : raw;
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
      runs.at(-1)!.push([x, y]);
    }
    return runs.filter((run) => run.length > 0);
  });
  return { paths, xMin, xMax, yMin, yMax, excluded };
}

function MetricPlot({
  series,
  log,
  colors,
  axisColor,
}: {
  series: WorkDataSeries[];
  log: boolean;
  colors: string[];
  axisColor: string;
}) {
  const geometry = useMemo(() => plotGeometry(series, log), [series, log]);
  if (!Number.isFinite(geometry.xMin))
    return (
      <Text style={styles.meta}>
        {geometry.excluded ? "No positive values for logarithmic scale" : "No numeric history"}
      </Text>
    );
  const { xMin, xMax, yMin, yMax } = geometry;
  const project = ([x, y]: [number, number]): [number, number] => [
    48 + ((x - xMin) / (xMax - xMin || 1)) * 240,
    110 - ((y - yMin) / (yMax - yMin || 1)) * 92,
  ];
  return (
    <View>
      <Svg width="100%" height={142} viewBox="0 0 310 142" accessibilityLabel="Metric history">
        <Line x1={48} y1={14} x2={48} y2={112} stroke={axisColor} />
        <Line x1={48} y1={112} x2={290} y2={112} stroke={axisColor} />
        <SvgText x={44} y={20} fontSize={9} fill={axisColor} textAnchor="end">
          {formatMetric(log ? 10 ** yMax : yMax)}
        </SvgText>
        <SvgText x={44} y={112} fontSize={9} fill={axisColor} textAnchor="end">
          {formatMetric(log ? 10 ** yMin : yMin)}
        </SvgText>
        <SvgText x={48} y={130} fontSize={9} fill={axisColor}>
          {formatMetric(xMin)}
        </SvgText>
        <SvgText x={288} y={130} fontSize={9} fill={axisColor} textAnchor="end">
          {formatMetric(xMax)}
        </SvgText>
        {geometry.paths.flatMap((runs, index) =>
          runs.map((run) =>
            run.length === 1 ? (
              <Circle
                key={`${JSON.stringify(series[index]!.key)}:${run[0]!.join(":")}`}
                cx={project(run[0]!)[0]}
                cy={project(run[0]!)[1]}
                r={2}
                fill={colors[index % colors.length]}
              />
            ) : (
              <Polyline
                key={`${JSON.stringify(series[index]!.key)}:${run[0]!.join(":")}`}
                points={run.map((point) => project(point).join(",")).join(" ")}
                stroke={colors[index % colors.length]}
                strokeWidth={1.5}
                fill="none"
              />
            ),
          ),
        )}
      </Svg>
      {geometry.excluded ? (
        <Text style={styles.meta}>{geometry.excluded} nonpositive values omitted</Text>
      ) : null}
    </View>
  );
}
const ThemedMetricPlot = withUnistyles(MetricPlot);
const plotPalette = (theme: Theme) => ({
  colors: [
    theme.colors.accent,
    theme.colors.statusSuccess,
    theme.colors.statusWarning,
    theme.colors.statusDanger,
  ],
  axisColor: theme.colors.foregroundMuted,
});
