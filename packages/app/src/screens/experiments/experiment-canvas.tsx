import { useMemo, useCallback } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  ExperimentAttempt,
  ExperimentBoardPlacement,
  ExperimentDetail,
  ExperimentRecord,
} from "@getpaseo/protocol/experiments";
import { StatusBadge } from "@/components/ui/status-badge";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { BoardCanvas } from "@/components/board-canvas";
import {
  progressUnit,
  resolveAttemptProgressState,
  selectCardProgressAttempts,
} from "./experiment-progress-state";
import {
  boardNodes,
  boardSizes,
  toBoardPlacement,
  fromBoardPlacement,
} from "./experiment-canvas-layout";

export function ExperimentCanvas(props: {
  experiments: ExperimentRecord[];
  detailByExperiment: Map<string, ExperimentDetail>;
  storedPlacements: ExperimentBoardPlacement[];
  selectedExperiment: string | null;
  onSelectExperiment: (id: string) => void;
  onClearSelection: () => void;
  onPersistPlacement: (placement: ExperimentBoardPlacement) => void;
}) {
  const nodes = useMemo(() => boardNodes(props.experiments), [props.experiments]);
  const sizes = useMemo(
    () => boardSizes(props.experiments, props.detailByExperiment),
    [props.experiments, props.detailByExperiment],
  );
  const placements = useMemo(
    () => props.storedPlacements.map(toBoardPlacement),
    [props.storedPlacements],
  );
  const persist = useCallback(
    (p: Parameters<typeof fromBoardPlacement>[0]) =>
      props.onPersistPlacement(fromBoardPlacement(p)),
    [props],
  );
  const renderContent = useCallback(
    (id: string) => {
      const record = props.experiments.find((value) => value.id === id)!;
      const detail = props.detailByExperiment.get(id);
      const progress = detail ? selectCardProgressAttempts(detail).at(-1) : null;
      return (
        <>
          <Text style={styles.cardDescription} numberOfLines={3}>
            {record.description}
          </Text>
          <View style={styles.badges}>
            {record.goal ? <StatusBadge label={record.goal} /> : null}
            {detail ? (
              <StatusBadge label={detail.attempts.length + " attempts"} variant="muted" />
            ) : null}
            {record.conclusion ? <StatusBadge label="concluded" variant="success" /> : null}
          </View>
          {progress ? <CardAttemptProgress attempt={progress} /> : null}
        </>
      );
    },
    [props.experiments, props.detailByExperiment],
  );
  const renderHover = useCallback(
    (id: string) => {
      const detail = props.detailByExperiment.get(id);
      const attempts = detail ? selectCardProgressAttempts(detail) : [];
      return attempts.length > 1 ? (
        <>
          <Text style={styles.cardProgressHoverTitle}>Unfinished attempts</Text>
          {attempts.map((attempt) => (
            <CardAttemptProgress key={attempt.id} attempt={attempt} />
          ))}
        </>
      ) : null;
    },
    [props.detailByExperiment],
  );
  return (
    <BoardCanvas
      {...props}
      experiments={nodes}
      sizes={sizes}
      storedPlacements={placements}
      onPersistPlacement={persist}
      renderContent={renderContent}
      renderHover={renderHover}
    />
  );
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

function percentageWidth(ratio: number): ViewStyle {
  return inlineUnistylesStyle({ width: `${ratio * 100}%` });
}
function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
const styles = StyleSheet.create((theme) => ({
  cardDescription: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1] },
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
  cardProgressHoverTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
}));
