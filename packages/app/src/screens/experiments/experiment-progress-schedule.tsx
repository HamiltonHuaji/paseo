import { useMemo } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  ProgressObservation,
  ProgressPlan,
  ProgressSegment,
} from "@getpaseo/protocol/experiments";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

interface ExperimentProgressScheduleProps {
  plan: ProgressPlan;
  observation: ProgressObservation | null;
}

interface DisplayTrack {
  label: string;
  segments: ProgressSegment[];
}

export function ExperimentProgressSchedule({ plan, observation }: ExperimentProgressScheduleProps) {
  const tracks = useMemo<DisplayTrack[]>(() => {
    if (plan.tracks) return plan.tracks;
    if (plan.segments) return [{ label: "Schedule", segments: plan.segments }];
    return [];
  }, [plan.segments, plan.tracks]);
  const current = observation?.current ?? 0;
  const ratio = clamp(current / plan.total, 0, 1);
  const fillStyle = useMemo(() => [styles.actualFill, percentWidth(ratio)], [ratio]);
  const markerStyle = useMemo(() => [styles.actualMarker, percentLeft(ratio)], [ratio]);

  return (
    <View style={styles.container}>
      <View style={styles.axisRow}>
        <View style={styles.labelSpacer} />
        <View style={styles.axisLabels}>
          <Text style={styles.axisText}>0</Text>
          <Text style={styles.axisText}>
            {formatNumber(plan.total)} {plan.unit}
          </Text>
        </View>
      </View>
      {tracks.map((track) => (
        <View key={trackKey(track)} style={styles.trackRow}>
          <Text style={styles.trackLabel} numberOfLines={1}>
            {track.label}
          </Text>
          <View style={styles.track}>
            {track.segments.map((segment, segmentIndex) => (
              <View
                key={`${segment.start}:${segment.end}:${segment.label}`}
                style={[
                  styles.segment,
                  segmentIndex % 2 === 0 ? styles.segmentEven : styles.segmentOdd,
                  segmentGeometry(segment, plan.total),
                ]}
              >
                <Text style={styles.segmentLabel} numberOfLines={1}>
                  {segment.label}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
      <View style={styles.trackRow}>
        <Text style={styles.trackLabel} numberOfLines={1}>
          Actual
        </Text>
        <View style={styles.actualTrack}>
          <View style={fillStyle} />
          {observation ? <View style={markerStyle} /> : null}
        </View>
      </View>
      <View style={styles.observationRow}>
        <View style={styles.labelSpacer} />
        <View style={styles.observationTextBlock}>
          {observation ? (
            <Text style={styles.observationText}>
              {formatNumber(observation.current)} / {formatNumber(plan.total)} {plan.unit}
              {` · ${Math.round(ratio * 100)}%`}
              {observation.ended ? " · ended" : ""}
            </Text>
          ) : (
            <Text style={styles.mutedText}>Waiting for the first progress observation.</Text>
          )}
          {observation?.phase ? <Text style={styles.mutedText}>{observation.phase}</Text> : null}
          {observation?.message ? (
            <Text style={styles.mutedText}>{observation.message}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function segmentGeometry(segment: ProgressSegment, total: number): ViewStyle {
  return inlineUnistylesStyle({
    left: `${clamp(segment.start / total, 0, 1) * 100}%`,
    width: `${clamp((segment.end - segment.start) / total, 0, 1) * 100}%`,
  });
}

function percentWidth(ratio: number): ViewStyle {
  return inlineUnistylesStyle({ width: `${ratio * 100}%` });
}

function percentLeft(ratio: number): ViewStyle {
  return inlineUnistylesStyle({ left: `${ratio * 100}%` });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function trackKey(track: DisplayTrack): string {
  return `${track.label}:${track.segments.map((segment) => `${segment.start}-${segment.end}-${segment.label}`).join("|")}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

const styles = StyleSheet.create((theme) => ({
  container: { gap: theme.spacing[2] },
  axisRow: { flexDirection: "row", alignItems: "center" },
  labelSpacer: { width: 84 },
  axisLabels: { flex: 1, flexDirection: "row", justifyContent: "space-between" },
  axisText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  trackRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  trackLabel: {
    width: 76,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
  },
  track: {
    flex: 1,
    height: 32,
    position: "relative",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  segment: {
    position: "absolute",
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  segmentEven: { backgroundColor: theme.colors.accent },
  segmentOdd: { backgroundColor: theme.colors.accentBright },
  segmentLabel: {
    color: theme.colors.accentForeground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  actualTrack: {
    flex: 1,
    height: 18,
    position: "relative",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  actualFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius.md,
  },
  actualMarker: {
    position: "absolute",
    top: 2,
    width: 12,
    height: 12,
    marginLeft: -6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    borderWidth: 2,
    borderColor: theme.colors.surface0,
  },
  observationRow: { flexDirection: "row", gap: theme.spacing[2] },
  observationTextBlock: { flex: 1, gap: theme.spacing[1] },
  observationText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  mutedText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
