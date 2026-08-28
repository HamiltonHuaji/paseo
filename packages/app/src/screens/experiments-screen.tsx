import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type ViewStyle } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useIsFocused } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ExternalLink, GitBranch, Grid2X2, List, RefreshCw } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import type {
  ExperimentAttempt,
  ExperimentBoardPlacement,
  ExperimentDetail,
  ExperimentRecord,
  ProgressObservation,
  ResolvedViewerEntry,
} from "@getpaseo/protocol/experiments";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
  useHosts,
} from "@/runtime/host-runtime";
import { getDesktopHost } from "@/desktop/host";
import { openExternalUrl } from "@/utils/open-external-url";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { useFetchQueries, useFetchQuery } from "@/data/query";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { RelayHostConnection } from "@/types/host-connection";
import { ExperimentCanvas } from "@/screens/experiments/experiment-canvas";
import { ExperimentProgressSchedule } from "@/screens/experiments/experiment-progress-schedule";

const EMPTY_ATTEMPTS: ExperimentAttempt[] = [];
const EMPTY_EXPERIMENTS: ExperimentRecord[] = [];
const EXPERIMENT_VIEW_STORAGE_KEY = "experiment-board-view-mode";
type ExperimentViewMode = "list" | "canvas";
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedExternalLink = withUnistyles(ExternalLink, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

interface ExperimentsScreenProps {
  serverId: string;
  projectId: string;
}

export function ExperimentsScreen({ serverId, projectId }: ExperimentsScreenProps) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const queryClient = useQueryClient();
  const listQuery = useFetchQuery({
    queryKey: ["experiments", serverId, projectId],
    queryFn: async () => {
      if (!client) throw new Error("Daemon is unavailable");
      return (await client.listExperiments({ projectId, includeClosed: true })).experiments;
    },
    enabled: Boolean(client && connected && projectId),
    retry: false,
    dataShape: "list",
    staleTimeMs: 5_000,
  });
  const [selectedExperiment, setSelectedExperiment] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ExperimentViewMode>("list");
  const experiments = listQuery.data ?? EMPTY_EXPERIMENTS;
  const detailQueries = useFetchQueries<ExperimentDetail>(
    experiments.map((experiment) => ({
      queryKey: ["experiment", serverId, projectId, experiment.id],
      queryFn: async () => {
        if (!client) throw new Error("Daemon is unavailable");
        return (await client.getExperiment({ projectId, experiment: experiment.id })).detail;
      },
      enabled: Boolean(client && connected),
      retry: false,
      dataShape: "value",
      staleTimeMs: 5_000,
    })),
  );
  const detailByExperiment = useMemo(
    () =>
      new Map(
        experiments.flatMap((experiment, index) => {
          const detail = detailQueries[index]?.data;
          return detail ? ([[experiment.id, detail]] as const) : [];
        }),
      ),
    [detailQueries, experiments],
  );
  const experimentById = useMemo(
    () => new Map(experiments.map((experiment) => [experiment.id, experiment])),
    [experiments],
  );

  useEffect(() => {
    if (!selectedExperiment || !experiments.some((item) => item.id === selectedExperiment)) {
      setSelectedExperiment(experiments[0]?.id ?? null);
    }
  }, [experiments, selectedExperiment]);

  const groups = useMemo(() => groupExperiments(experiments), [experiments]);
  const boardLayoutQuery = useFetchQuery({
    queryKey: ["experiment-board-layout", serverId, projectId],
    queryFn: async () => {
      if (!client) throw new Error("Daemon is unavailable");
      return (await client.getExperimentBoardLayout({ projectId })).placements;
    },
    enabled: Boolean(client && connected && projectId && viewMode === "canvas"),
    retry: false,
    dataShape: "list",
    staleTimeMs: 5_000,
  });
  useEffect(() => {
    void AsyncStorage.getItem(`${EXPERIMENT_VIEW_STORAGE_KEY}:${serverId}:${projectId}`)
      .then((stored) => {
        if (stored === "list" || stored === "canvas") setViewMode(stored);
        return undefined;
      })
      .catch(() => undefined);
  }, [projectId, serverId]);
  const changeViewMode = useCallback(
    (next: ExperimentViewMode) => {
      setViewMode(next);
      void AsyncStorage.setItem(
        `${EXPERIMENT_VIEW_STORAGE_KEY}:${serverId}:${projectId}`,
        next,
      ).catch(() => undefined);
    },
    [projectId, serverId],
  );
  const persistPlacement = useCallback(
    (placement: ExperimentBoardPlacement) => {
      if (!client) return;
      void client
        .updateExperimentBoardLayout({ projectId, placements: [placement] })
        .then(() =>
          queryClient.setQueryData<ExperimentBoardPlacement[]>(
            ["experiment-board-layout", serverId, projectId],
            (current) => mergePlacement(current ?? [], placement),
          ),
        )
        .catch(() => undefined);
    },
    [client, projectId, queryClient, serverId],
  );
  const refetchList = listQuery.refetch;
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchList(),
        queryClient.refetchQueries({ queryKey: ["experiment", serverId, projectId] }),
        queryClient.refetchQueries({ queryKey: ["experiment-viewers", serverId, projectId] }),
        queryClient.refetchQueries({
          queryKey: ["experiment-board-layout", serverId, projectId],
        }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [projectId, queryClient, refetchList, serverId]);
  const handleRefresh = useCallback(() => void refreshAll(), [refreshAll]);
  const viewOptions = useMemo(
    () => [
      { value: "list" as const, label: "List", icon: List },
      { value: "canvas" as const, label: "Canvas", icon: Grid2X2 },
    ],
    [],
  );
  const headerAction = useMemo(
    () => (
      <View style={styles.headerActions}>
        <SegmentedControl
          options={viewOptions}
          value={viewMode}
          onValueChange={changeViewMode}
          size="sm"
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={RefreshCw}
          onPress={handleRefresh}
          loading={refreshing}
        >
          Refresh
        </Button>
      </View>
    ),
    [changeViewMode, handleRefresh, refreshing, viewMode, viewOptions],
  );

  return (
    <View style={styles.container}>
      <MenuHeader title="Experiments" rightContent={headerAction} />
      <ScrollView contentContainerStyle={styles.content}>
        {!connected ? <Message text="Host is offline." /> : null}
        {listQuery.isLoading ? <ThemedLoadingSpinner /> : null}
        {listQuery.error ? <Message text={errorMessage(listQuery.error)} error /> : null}
        {groups.length === 0 && !listQuery.isLoading && !listQuery.error ? (
          <Message text="No experiments in this project." />
        ) : null}
        <View style={styles.board}>
          {viewMode === "list" ? (
            <View style={styles.listColumn}>
              {groups.map(([goal, goalExperiments]) => (
                <View key={goal} style={styles.goalGroup}>
                  <Text style={styles.goalTitle}>{goal}</Text>
                  <View style={styles.card}>
                    {goalExperiments.map((experiment, index) => (
                      <ExperimentRow
                        key={experiment.id}
                        experiment={experiment}
                        detail={detailByExperiment.get(experiment.id) ?? null}
                        basedOn={
                          experiment.basedOn
                            ? (experimentById.get(experiment.basedOn) ?? null)
                            : null
                        }
                        selected={experiment.id === selectedExperiment}
                        bordered={index > 0}
                        onSelect={setSelectedExperiment}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.canvasColumn}>
              {boardLayoutQuery.error ? (
                <Message text={errorMessage(boardLayoutQuery.error)} error />
              ) : null}
              <ExperimentCanvas
                experiments={experiments}
                detailByExperiment={detailByExperiment}
                storedPlacements={boardLayoutQuery.data ?? []}
                selectedExperiment={selectedExperiment}
                onSelectExperiment={setSelectedExperiment}
                onPersistPlacement={persistPlacement}
              />
            </View>
          )}
          {selectedExperiment && client ? (
            <ExperimentDetailPanel
              serverId={serverId}
              projectId={projectId}
              experiment={selectedExperiment}
              experimentById={experimentById}
              onSelectExperiment={setSelectedExperiment}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function ExperimentRow({
  experiment,
  detail,
  basedOn,
  selected,
  bordered,
  onSelect,
}: {
  experiment: ExperimentRecord;
  detail: ExperimentDetail | null;
  basedOn: ExperimentRecord | null;
  selected: boolean;
  bordered: boolean;
  onSelect: (experiment: string) => void;
}) {
  const onPress = useCallback(() => onSelect(experiment.id), [experiment.id, onSelect]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const attempts = detail?.attempts ?? null;
  const progressAttempt = attempts ? findLatestProgressAttempt(attempts) : null;
  const updatedAt = latestMeaningfulUpdateAt(experiment, attempts ?? []);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={onPress}
      style={[styles.experimentRow, bordered && styles.rowBorder, selected && styles.selectedRow]}
    >
      <Text style={styles.rowTitle}>{experiment.shortDescription}</Text>
      <Text style={styles.rowHint} numberOfLines={2}>
        {experiment.description}
      </Text>
      <View style={styles.metaRow}>
        {attempts ? (
          <StatusBadge label={formatAttemptCount(attempts.length)} variant="muted" />
        ) : null}
        {progressAttempt?.progress ? (
          <StatusBadge
            label={`${formatProgress(progressAttempt.progress)}${progressAttempt.progress.ended ? " · ended" : ""}`}
            variant={progressAttempt.progress.ended ? "success" : "warning"}
          />
        ) : null}
        {experiment.conclusion ? <StatusBadge label="concluded" variant="success" /> : null}
      </View>
      <View style={styles.metaRow}>
        {experiment.basedOn ? (
          <Text style={styles.meta} numberOfLines={1}>
            based on {basedOn?.shortDescription ?? experiment.basedOn}
          </Text>
        ) : null}
        <Text style={styles.meta}>updated {formatTimestamp(updatedAt)}</Text>
      </View>
    </Pressable>
  );
}

function ExperimentDetailPanel({
  serverId,
  projectId,
  experiment,
  experimentById,
  onSelectExperiment,
}: {
  serverId: string;
  projectId: string;
  experiment: string;
  experimentById: Map<string, ExperimentRecord>;
  onSelectExperiment: (experiment: string) => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const detailQuery = useFetchQuery({
    queryKey: ["experiment", serverId, projectId, experiment],
    queryFn: async () => {
      if (!client) throw new Error("Daemon is unavailable");
      return (await client.getExperiment({ projectId, experiment })).detail;
    },
    enabled: Boolean(client),
    retry: false,
    dataShape: "value",
    staleTimeMs: 5_000,
  });
  const [selectedAttempt, setSelectedAttempt] = useState<string | null>(null);
  const attempts = detailQuery.data?.attempts ?? EMPTY_ATTEMPTS;
  const involvedAgents = useSessionStore(
    useShallow((state) => {
      const agents = state.sessions[serverId]?.agents;
      if (!agents) return [];
      return [...agents.values()]
        .map((agent) => ({
          agent,
          touch: agent.experimentTouches?.find((touch) => touch.experiment === experiment),
        }))
        .filter((entry) => entry.touch !== undefined)
        .sort((left, right) =>
          (right.touch?.lastTouchedAt ?? "").localeCompare(left.touch?.lastTouchedAt ?? ""),
        );
    }),
  );

  useEffect(() => {
    if (!selectedAttempt || !attempts.some((attempt) => attempt.id === selectedAttempt)) {
      setSelectedAttempt(attempts.at(-1)?.id ?? null);
    }
  }, [attempts, selectedAttempt]);
  const basedOnId = detailQuery.data?.experiment.basedOn ?? null;
  const selectBasedOn = useCallback(() => {
    if (basedOnId) onSelectExperiment(basedOnId);
  }, [basedOnId, onSelectExperiment]);

  const attempt = attempts.find((item) => item.id === selectedAttempt) ?? null;
  if (detailQuery.isLoading) return <ThemedLoadingSpinner />;
  if (detailQuery.error) return <Message text={errorMessage(detailQuery.error)} error />;
  if (!detailQuery.data) return null;
  const experimentRecord = detailQuery.data.experiment;
  const basedOn = experimentRecord.basedOn
    ? (experimentById.get(experimentRecord.basedOn) ?? null)
    : null;

  return (
    <View style={styles.detailColumn}>
      <View style={styles.detailHeader}>
        <Text style={styles.detailTitle}>{experimentRecord.shortDescription}</Text>
        <View style={styles.metaRow}>
          {experimentRecord.goal ? <StatusBadge label={experimentRecord.goal} /> : null}
          {experimentRecord.conclusion ? <StatusBadge label="concluded" variant="success" /> : null}
        </View>
      </View>
      <Text style={styles.description}>{experimentRecord.description}</Text>
      {experimentRecord.basedOn ? (
        <Button variant="ghost" size="xs" leftIcon={GitBranch} onPress={selectBasedOn}>
          Based on {basedOn?.shortDescription ?? experimentRecord.basedOn}
        </Button>
      ) : null}
      {experimentRecord.conclusion ? (
        <View style={styles.summaryBlock}>
          <Text style={styles.sectionTitle}>Conclusion</Text>
          <Text style={styles.summaryText}>{experimentRecord.conclusion}</Text>
        </View>
      ) : null}
      <View style={styles.compactFields}>
        <LabeledValue label="Storage" value={formatBlobPath(experimentRecord.blobRelpath)} />
        <LabeledValue label="Created" value={formatTimestamp(experimentRecord.createdAt)} />
        <LabeledValue label="Updated" value={formatTimestamp(experimentRecord.updatedAt)} />
      </View>
      {involvedAgents.length > 0 ? (
        <View style={styles.involvedAgents}>
          <Text style={styles.sectionTitle}>Agents</Text>
          <View style={styles.attemptTabs}>
            {involvedAgents.map(({ agent, touch }) => (
              <InvolvedAgentButton
                key={agent.id}
                serverId={serverId}
                agent={agent}
                attempt={touch?.attempt ?? null}
              />
            ))}
          </View>
        </View>
      ) : null}
      {attempts.length === 0 ? <Message text="No attempts yet." /> : null}
      <View style={styles.attemptTabs}>
        {attempts.map((item) => (
          <AttemptSelector
            key={item.id}
            attempt={item}
            selected={item.id === selectedAttempt}
            onSelect={setSelectedAttempt}
          />
        ))}
      </View>
      {attempt ? (
        <AttemptPanel serverId={serverId} projectId={projectId} attempt={attempt} />
      ) : null}
    </View>
  );
}

function InvolvedAgentButton({
  serverId,
  agent,
  attempt,
}: {
  serverId: string;
  agent: Agent;
  attempt: string | null;
}) {
  const onPress = useCallback(() => {
    router.push(buildHostAgentDetailRoute(serverId, agent.id, agent.workspaceId));
  }, [agent.id, agent.workspaceId, serverId]);
  return (
    <Button size="xs" variant="ghost" onPress={onPress}>
      {agent.title ?? agent.id.slice(0, 8)} · {agent.status}
      {attempt ? ` · ${attempt}` : ""}
    </Button>
  );
}

function AttemptSelector({
  attempt,
  selected,
  onSelect,
}: {
  attempt: ExperimentAttempt;
  selected: boolean;
  onSelect: (attempt: string) => void;
}) {
  const onPress = useCallback(() => onSelect(attempt.id), [attempt.id, onSelect]);
  return (
    <Button size="xs" variant={selected ? "secondary" : "ghost"} onPress={onPress}>
      {attempt.shortDescription}
    </Button>
  );
}

function AttemptPanel({
  serverId,
  projectId,
  attempt,
}: {
  serverId: string;
  projectId: string;
  attempt: ExperimentAttempt;
}) {
  const client = useHostRuntimeClient(serverId);
  const hosts = useHosts();
  const runtime = useHostRuntimeSnapshot(serverId);
  const host = hosts.find((candidate) => candidate.serverId === serverId);
  const activeConnection = host?.connections.find(
    (connection) => connection.id === runtime?.activeConnectionId,
  );
  const isFocused = useIsFocused();
  const [observation, setObservation] = useState(attempt.progress);
  const [progressError, setProgressError] = useState(attempt.progressError);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setObservation(attempt.progress);
    setProgressError(attempt.progressError);
  }, [attempt.id, attempt.progress, attempt.progressError]);

  const refresh = useCallback(async () => {
    if (!client || !attempt.progressSource) return null;
    setRefreshing(true);
    try {
      const result = await client.refreshExperimentProgress({ projectId, attempt: attempt.id });
      setObservation(result.observation);
      setProgressError(result.error);
      return result;
    } catch (error) {
      setProgressError(errorMessage(error));
      return null;
    } finally {
      setRefreshing(false);
    }
  }, [attempt.id, attempt.progressSource, client, projectId]);
  const handleRefresh = useCallback(() => void refresh(), [refresh]);

  useEffect(() => {
    if (!client || !isFocused || !attempt.progressSource || observation?.ended) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const result = await refresh().catch(() => null);
      if (!cancelled && result?.nextRefreshAfterMs) {
        timer = setTimeout(() => void poll(), result.nextRefreshAfterMs);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [attempt.id, attempt.progressSource, client, isFocused, observation?.ended, refresh]);

  const viewerQuery = useFetchQuery({
    queryKey: ["experiment-viewers", serverId, projectId, attempt.id],
    queryFn: async () => {
      if (!client) throw new Error("Daemon is unavailable");
      return (await client.resolveExperimentViewers({ projectId, target: { attempt: attempt.id } }))
        .entries;
    },
    enabled: Boolean(client),
    retry: false,
    dataShape: "list",
    staleTimeMs: 5_000,
  });
  const ratio = progressRatio(observation);
  const progressFillStyle = useMemo(
    () => [
      styles.progressFill,
      inlineUnistylesStyle<ViewStyle>({ width: `${Math.round(ratio * 100)}%` }),
    ],
    [ratio],
  );
  let progressContent = null;
  if (attempt.progressPlan) {
    progressContent = (
      <ExperimentProgressSchedule plan={attempt.progressPlan} observation={observation} />
    );
  } else if (observation) {
    progressContent = (
      <View style={styles.progressBlock}>
        <View style={styles.progressTrack}>
          <View style={progressFillStyle} />
        </View>
        <Text style={styles.meta}>
          {formatProgress(observation)}
          {observation.ended ? " · ended" : ""}
          {` · refreshed ${new Date(observation.refreshedAt).toLocaleString()}`}
        </Text>
        {observation.message ? <Text style={styles.description}>{observation.message}</Text> : null}
      </View>
    );
  } else if (attempt.progressSource) {
    progressContent = <Text style={styles.meta}>Waiting for the first progress observation.</Text>;
  }

  return (
    <View style={styles.attemptPanel}>
      <View style={styles.attemptHeader}>
        <View style={styles.flexOne}>
          <Text style={styles.attemptTitle}>{attempt.shortDescription}</Text>
          <Text style={styles.description}>{attempt.purpose}</Text>
        </View>
        {attempt.progressSource ? (
          <Button variant="ghost" size="xs" onPress={handleRefresh} loading={refreshing}>
            Refresh progress
          </Button>
        ) : null}
      </View>
      {progressContent}
      {progressError ? <Text style={styles.errorText}>{progressError}</Text> : null}
      {attempt.resultSummary ? (
        <View style={styles.summaryBlock}>
          <Text style={styles.sectionTitle}>Result</Text>
          <Text style={styles.summaryText}>{attempt.resultSummary}</Text>
        </View>
      ) : null}
      <AttemptFields attempt={attempt} />
      {viewerQuery.isLoading ? <Text style={styles.meta}>Loading viewers…</Text> : null}
      {viewerQuery.error ? (
        <Text style={styles.errorText}>{errorMessage(viewerQuery.error)}</Text>
      ) : null}
      {viewerQuery.data?.length ? (
        <View style={styles.viewerBlock}>
          <Text style={styles.sectionTitle}>Viewers</Text>
          {viewerQuery.data.map((entry) => (
            <ViewerEntry
              key={entry.name}
              entry={entry}
              directUrl={client?.resolveDirectHttpUrl(entry.url) ?? null}
              serverId={serverId}
              relayConnection={activeConnection?.type === "relay" ? activeConnection : null}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ViewerEntry({
  entry,
  directUrl,
  serverId,
  relayConnection,
}: {
  entry: ResolvedViewerEntry;
  directUrl: string | null;
  serverId: string;
  relayConnection: RelayHostConnection | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const usable = entry.available && (directUrl !== null || relayConnection !== null);
  const onPress = useCallback(() => {
    void (async () => {
      setError(null);
      try {
        if (directUrl) {
          await openExternalUrl(directUrl);
          return;
        }
        if (!relayConnection) return;
        const tunnel = getDesktopHost()?.tunnel?.ensure;
        if (!tunnel) throw new Error("Relay viewers require the Paseo desktop app");
        const { origin } = await tunnel({
          serverId,
          connection: relayConnection,
          target: { type: "service", name: "viewers" },
        });
        await openExternalUrl(`${origin}${entry.url}`);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    })();
  }, [directUrl, entry.url, relayConnection, serverId]);
  return (
    <Pressable disabled={!usable} onPress={onPress} style={styles.viewerRow}>
      <ThemedExternalLink size={14} />
      <Text style={usable ? styles.viewerName : styles.meta}>{entry.name}</Text>
      {!entry.available && entry.unavailableReason ? (
        <Text style={styles.meta}>{entry.unavailableReason}</Text>
      ) : null}
      {!directUrl && !relayConnection ? (
        <Text style={styles.meta}>open from desktop or connect directly</Text>
      ) : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </Pressable>
  );
}

function AttemptFields({ attempt }: { attempt: ExperimentAttempt }) {
  const fields = [
    ["W&B", attempt.wandbId],
    ["Job", attempt.jobId],
    ["Output", attempt.outputDir],
    ["Storage", formatBlobPath(attempt.blobRelpath)],
    ["Started", attempt.startedAt ? formatTimestamp(attempt.startedAt) : null],
    ["Ended", attempt.endedAt ? formatTimestamp(attempt.endedAt) : null],
  ].filter((field): field is [string, string] => Boolean(field[1]));
  if (fields.length === 0) return null;
  return (
    <View style={styles.fields}>
      {fields.map(([label, value]) => (
        <View key={label} style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <Text style={styles.fieldValue} selectable>
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function LabeledValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} selectable>
        {value}
      </Text>
    </View>
  );
}

function Message({ text, error = false }: { text: string; error?: boolean }) {
  return <Text style={error ? styles.errorText : styles.emptyText}>{text}</Text>;
}

function groupExperiments(experiments: ExperimentRecord[]): Array<[string, ExperimentRecord[]]> {
  const groups = new Map<string, ExperimentRecord[]>();
  for (const experiment of experiments) {
    const goal = experiment.goal ?? "Ungrouped";
    const group = groups.get(goal) ?? [];
    group.push(experiment);
    groups.set(goal, group);
  }
  return [...groups.entries()];
}

function findLatestProgressAttempt(attempts: ExperimentAttempt[]): ExperimentAttempt | null {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];
    if (attempt?.progress || attempt?.progressSource) return attempt;
  }
  return null;
}

function latestMeaningfulUpdateAt(
  experiment: ExperimentRecord,
  attempts: ExperimentAttempt[],
): string {
  return attempts.reduce(
    (latest, attempt) => (attempt.updatedAt > latest ? attempt.updatedAt : latest),
    experiment.updatedAt,
  );
}

function formatAttemptCount(count: number): string {
  return `${count} ${count === 1 ? "attempt" : "attempts"}`;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatBlobPath(blobRelpath: string): string {
  return `.paseo/v1/${blobRelpath}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function progressRatio(observation: ProgressObservation | null): number {
  if (!observation?.total || observation.total <= 0) return 0;
  return Math.max(0, Math.min(1, observation.current / observation.total));
}

function formatProgress(observation: ProgressObservation): string {
  return observation.total === null
    ? formatNumber(observation.current)
    : `${formatNumber(observation.current)} / ${formatNumber(observation.total)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mergePlacement(
  placements: ExperimentBoardPlacement[],
  next: ExperimentBoardPlacement,
): ExperimentBoardPlacement[] {
  return [...placements.filter((placement) => placement.experiment !== next.experiment), next];
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: {
    padding: { xs: theme.spacing[3], md: theme.spacing[6] },
    gap: theme.spacing[4],
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  board: { flexDirection: { xs: "column", lg: "row" }, gap: theme.spacing[6] },
  listColumn: { flex: 1, minWidth: 0, gap: theme.spacing[6] },
  canvasColumn: { flex: 3, minWidth: 0, gap: theme.spacing[2] },
  detailColumn: {
    flex: 2,
    minWidth: 0,
    gap: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[4],
    alignSelf: "flex-start",
  },
  detailHeader: { gap: theme.spacing[2] },
  goalGroup: { gap: theme.spacing[2] },
  goalTitle: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  card: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
  },
  experimentRow: { padding: theme.spacing[4], gap: theme.spacing[1] },
  selectedRow: { backgroundColor: theme.colors.surface2 },
  rowBorder: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  rowTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  rowHint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  detailTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
  },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  attemptTabs: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  involvedAgents: { gap: theme.spacing[2] },
  attemptPanel: { gap: theme.spacing[4], paddingTop: theme.spacing[2] },
  attemptHeader: { flexDirection: "row", alignItems: "flex-start", gap: theme.spacing[3] },
  attemptTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  flexOne: { flex: 1, minWidth: 0, gap: theme.spacing[1] },
  progressBlock: { gap: theme.spacing[2] },
  progressTrack: {
    height: 6,
    backgroundColor: theme.colors.surface3,
    borderRadius: theme.borderRadius.full,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  fields: { gap: theme.spacing[2] },
  compactFields: { gap: theme.spacing[1] },
  fieldRow: { flexDirection: "row", gap: theme.spacing[3] },
  fieldLabel: { width: 64, color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  fieldValue: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  summaryBlock: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
  },
  summaryText: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  viewerBlock: { gap: theme.spacing[2] },
  sectionTitle: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  viewerRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  viewerName: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  emptyText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  errorText: { color: theme.colors.statusDanger, fontSize: theme.fontSize.sm },
}));
