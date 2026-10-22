import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View, type PressableStateCallbackType, type ViewStyle } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
  ProgressObservation,
  ProgressPlanSet,
  ProgressSegment,
} from "@getpaseo/protocol/experiments";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { Theme } from "@/styles/theme";
import { projectProgressCurrent } from "./experiment-progress-units";

interface ExperimentProgressScheduleProps {
  plan: ProgressPlanSet;
  observation: ProgressObservation | null;
}

interface DisplayTrack {
  label: string;
  segments: ProgressSegment[];
}

const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function ExperimentProgressSchedule({ plan, observation }: ExperimentProgressScheduleProps) {
  const unitPlans = plan.units;
  const [selectedUnit, setSelectedUnit] = useState(plan.sourceUnit);
  useEffect(() => {
    if (!unitPlans.some((candidate) => candidate.unit === selectedUnit)) {
      setSelectedUnit(plan.sourceUnit);
    }
  }, [plan.sourceUnit, selectedUnit, unitPlans]);
  const selectedPlan =
    unitPlans.find((candidate) => candidate.unit === selectedUnit) ?? unitPlans[0]!;
  const tracks = useMemo<DisplayTrack[]>(() => {
    if (selectedPlan.tracks) return selectedPlan.tracks;
    if (selectedPlan.segments) return [{ label: "Schedule", segments: selectedPlan.segments }];
    return [];
  }, [selectedPlan.segments, selectedPlan.tracks]);
  const current = observation
    ? projectProgressCurrent(observation.current, plan.sourceUnit, selectedPlan)
    : null;
  const ratio = current === null ? null : clamp(current / selectedPlan.total, 0, 1);
  const fillStyle = useMemo(
    () => [
      styles.actualFill,
      observation?.ended ? styles.actualFillEnded : null,
      percentWidth(ratio ?? 0),
    ],
    [observation?.ended, ratio],
  );
  const markerStyle = useMemo(
    () => [
      styles.actualMarker,
      observation?.ended ? styles.actualMarkerEnded : null,
      percentLeft(ratio ?? 0),
    ],
    [observation?.ended, ratio],
  );
  const remainingStyle = useMemo(
    () => [styles.remainingShade, remainingGeometry(ratio ?? 0)],
    [ratio],
  );
  const completionBoundaryStyle = useMemo(
    () => [styles.completionBoundary, percentLeft(ratio ?? 0)],
    [ratio],
  );
  let observationSummary = (
    <Text style={styles.mutedText}>Waiting for the first progress observation.</Text>
  );
  if (observation && current === null) {
    observationSummary = (
      <Text style={styles.mutedText}>Current position is unavailable in {selectedPlan.unit}.</Text>
    );
  } else if (observation && current !== null && ratio !== null) {
    observationSummary = (
      <Text style={styles.observationText}>
        {formatNumber(current)} / {formatNumber(selectedPlan.total)} {selectedPlan.unit}
        {` · ${Math.round(ratio * 100)}%`}
        {observation.ended ? " · ended" : ""}
      </Text>
    );
  }

  return (
    <View style={styles.container}>
      {unitPlans.length > 1 ? (
        <View style={styles.unitRow}>
          <Text style={styles.unitLabel}>Progress unit</Text>
          <DropdownMenu>
            <DropdownMenuTrigger
              style={unitTriggerStyle}
              accessibilityLabel={`Progress unit: ${selectedPlan.unit}`}
            >
              <Text style={styles.unitTriggerText}>{selectedPlan.unit}</Text>
              <ThemedChevronDown size={14} uniProps={mutedIconMapping} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" width={180}>
              {unitPlans.map((candidate) => (
                <ProgressUnitMenuItem
                  key={candidate.unit}
                  unit={candidate.unit}
                  selected={candidate.unit === selectedPlan.unit}
                  onSelect={setSelectedUnit}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
      ) : null}
      <View style={styles.axisRow}>
        <View style={styles.labelSpacer} />
        <View style={styles.axisLabels}>
          <Text style={styles.axisText}>0</Text>
          <Text style={styles.axisText}>
            {formatNumber(selectedPlan.total)} {selectedPlan.unit}
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
                  segmentGeometry(segment, selectedPlan.total),
                ]}
              >
                <Text style={styles.segmentLabel} numberOfLines={1}>
                  {segment.label}
                </Text>
              </View>
            ))}
            {ratio !== null && ratio < 1 ? (
              <View pointerEvents="none" style={remainingStyle} />
            ) : null}
            {ratio !== null && ratio > 0 && ratio < 1 ? (
              <View pointerEvents="none" style={completionBoundaryStyle} />
            ) : null}
          </View>
        </View>
      ))}
      <View style={styles.trackRow}>
        <Text style={styles.trackLabel} numberOfLines={1}>
          Actual
        </Text>
        <View style={styles.actualTrack}>
          <View style={fillStyle} />
          {current !== null ? <View style={markerStyle} /> : null}
        </View>
      </View>
      <View style={styles.observationRow}>
        <View style={styles.labelSpacer} />
        <View style={styles.observationTextBlock}>
          {observationSummary}
          {observation?.phase ? <Text style={styles.mutedText}>{observation.phase}</Text> : null}
          {observation?.message ? (
            <Text style={styles.mutedText}>{observation.message}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function ProgressUnitMenuItem({
  unit,
  selected,
  onSelect,
}: {
  unit: string;
  selected: boolean;
  onSelect: (unit: string) => void;
}) {
  const handleSelect = useCallback(() => onSelect(unit), [onSelect, unit]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {unit}
    </DropdownMenuItem>
  );
}

function unitTriggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.unitTrigger, pressed ? styles.unitTriggerPressed : null];
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

function remainingGeometry(ratio: number): ViewStyle {
  return inlineUnistylesStyle({ left: `${ratio * 100}%`, right: 0 });
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
  unitRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  unitLabel: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  unitTrigger: {
    minHeight: 28,
    minWidth: 120,
    paddingHorizontal: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
  },
  unitTriggerPressed: { backgroundColor: theme.colors.surface2 },
  unitTriggerText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
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
  remainingShade: {
    position: "absolute",
    top: 0,
    bottom: 0,
    backgroundColor: theme.colors.surface0,
    opacity: theme.opacity[50],
  },
  completionBoundary: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: theme.colors.accentForeground,
    opacity: theme.opacity[50],
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
    backgroundColor: theme.colors.accent,
    borderRadius: theme.borderRadius.md,
  },
  actualFillEnded: { backgroundColor: theme.colors.statusSuccess },
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
  actualMarkerEnded: { backgroundColor: theme.colors.statusSuccess },
  observationRow: { flexDirection: "row", gap: theme.spacing[2] },
  observationTextBlock: { flex: 1, gap: theme.spacing[1] },
  observationText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  mutedText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
