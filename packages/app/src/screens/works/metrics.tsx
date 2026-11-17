import { useCallback, useState } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import type { WorkMetrics } from "@getpaseo/protocol/work-objects";
import { WorkDataQueryResultSchema } from "@getpaseo/protocol/work-data";
import { useFetchQuery } from "@/data/query";
import { dataPath, errorMessage, useWorks } from "./context";
import { ThemedMetricChart, chartPalette } from "./metric-chart";
import { workStyles as styles } from "./styles";

export { formatMetric, plotGeometry } from "./metric-chart-model";
type Panel = WorkMetrics["panels"][number];
export function Metrics({ value, preview = false }: { value: WorkMetrics; preview?: boolean }) {
  return (
    <View style={preview ? styles.stack : styles.metricGrid}>
      {value.panels.map((panel) => (
        <MetricPanel key={panel.id} panel={panel} preview={preview} />
      ))}
    </View>
  );
}

export function metricTitle(panel: Panel): string {
  return (
    panel.title ?? panel.series.map((series) => series.label ?? series.key.join("/")).join(", ")
  );
}

function MetricPanel({ panel, preview }: { panel: Panel; preview: boolean }) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width));
  }, []);
  const query = useMetricQuery(panel, width);
  const data = query.data;
  return (
    <View style={[styles.metricPanel, preview && styles.metricPreview]} onLayout={onLayout}>
      <View style={styles.chartHeader}>
        <Text style={styles.title} numberOfLines={preview ? 1 : undefined} selectable={!preview}>
          {metricTitle(panel)}
        </Text>
        <Text style={styles.chartCaption} numberOfLines={1}>
          {data?.runId ?? panel.source.source} · {scaleLabel(panel)}
          {data && !data.caughtUp ? " · Reading data…" : ""}
        </Text>
      </View>
      {query.isPending ? (
        <View style={styles.chartEmpty}>
          <Text style={styles.meta}>Loading metrics…</Text>
        </View>
      ) : null}
      {query.error || data?.error ? (
        <Text style={styles.error} numberOfLines={preview ? 2 : undefined}>
          {data?.error ?? errorMessage(query.error)}
        </Text>
      ) : null}
      {data ? (
        <ThemedMetricChart
          panel={panel}
          series={data.series}
          preview={preview}
          uniProps={chartPalette}
        />
      ) : null}
    </View>
  );
}

function scaleLabel(panel: Panel): string {
  if (panel.display !== "line") return "Summary";
  return panel.scale === "log" ? "Log scale" : "Linear scale";
}

function useMetricQuery(panel: Panel, width: number) {
  const { serverId, projectId, active, connected, readData } = useWorks();
  const line = panel.display === "line";
  const queryInput = {
    series: panel.series.map((series) => series.key),
    x: panel.x,
    range: panel.range,
    mode: line ? "series" : "summary",
    // Two samples per layout pixel keep both previews and detail plots bounded.
    maxPoints: line ? Math.max(1, Math.ceil(width * 2)) : undefined,
  };
  return useFetchQuery({
    queryKey: ["works-data", serverId, projectId, panel.source, queryInput],
    queryFn: async ({ signal }) =>
      WorkDataQueryResultSchema.parse(
        await readData(
          `${dataPath(projectId, panel.source.objectId, panel.source.source)}/query?q=${encodeURIComponent(JSON.stringify(queryInput))}`,
          signal,
        ),
      ),
    enabled: active && connected && (!line || width > 0),
    retry: false,
    dataShape: "value",
    staleTimeMs: 10_000,
    refetchInterval: active && connected ? 15_000 : false,
  });
}
