import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useIsFocused } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Grid2X2,
  List,
  RefreshCw,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
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
import { resolveAttemptExpanded } from "@/screens/experiments/experiment-attempt-expansion";

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
  embedded?: boolean;
  active?: boolean;
}

export function ExperimentsScreen({
  serverId,
  projectId,
  embedded = false,
  active = true,
}: ExperimentsScreenProps) {
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const queryClient = useQueryClient();
  const fetchEnabled = canFetchExperiments(active, Boolean(client), connected, Boolean(projectId));
  const listQuery = useFetchQuery({
    queryKey: ["experiments", serverId, projectId],
    queryFn: async () => {
      if (!client) throw new Error("Daemon is unavailable");
      return (await client.listExperiments({ projectId, includeClosed: true })).experiments;
    },
    enabled: fetchEnabled,
    retry: false,
    dataShape: "list",
    staleTimeMs: 5_000,
  });
  const [selectedExperiment, setSelectedExperiment] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ExperimentViewMode>("list");
  const [attemptExpansionById, setAttemptExpansionById] = useState<Record<string, boolean>>({});
  const canvasMode = viewMode === "canvas";
  const experiments = listQuery.data ?? EMPTY_EXPERIMENTS;
  const detailQueries = useFetchQueries<ExperimentDetail>(
    experiments.map((experiment) => ({
      queryKey: ["experiment", serverId, projectId, experiment.id],
      queryFn: async () => {
        if (!client) throw new Error("Daemon is unavailable");
        return (await client.getExperiment({ projectId, experiment: experiment.id })).detail;
      },
      enabled: fetchEnabled,
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
    if (selectedExperiment && !experiments.some((item) => item.id === selectedExperiment)) {
      setSelectedExperiment(null);
    }
  }, [experiments, selectedExperiment]);

  const groups = useMemo(() => groupExperiments(experiments), [experiments]);
  const boardLayoutQuery = useFetchQuery({
    queryKey: ["experiment-board-layout", serverId, projectId],
    queryFn: async () => {
      if (!client) throw new Error("Daemon is unavailable");
      return (await client.getExperimentBoardLayout({ projectId })).placements;
    },
    enabled: canFetchExperimentCanvas(fetchEnabled, viewMode),
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
  const clearSelection = useCallback(() => setSelectedExperiment(null), []);
  useEffect(() => {
    if (Platform.OS !== "android" || !embedded || !active) return;
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selectedExperiment) clearSelection();
      return true;
    });
    return () => handler.remove();
  }, [active, clearSelection, embedded, selectedExperiment]);
  const setAttemptExpanded = useCallback((attemptId: string, expanded: boolean) => {
    setAttemptExpansionById((current) => {
      if (current[attemptId] === expanded) return current;
      return { ...current, [attemptId]: expanded };
    });
  }, []);
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
      <ExperimentsHeader embedded={embedded} actions={headerAction} />
      <ScrollView
        contentContainerStyle={[styles.content, optionalStyle(canvasMode, styles.contentFill)]}
      >
        <EmbeddedExperimentsActions embedded={embedded} actions={headerAction} />
        {!connected ? <Message text="Host is offline." /> : null}
        {listQuery.isLoading ? <ThemedLoadingSpinner /> : null}
        {listQuery.error ? <Message text={errorMessage(listQuery.error)} error /> : null}
        {groups.length === 0 && !listQuery.isLoading && !listQuery.error ? (
          <Message text="No experiments in this project." />
        ) : null}
        <View style={[styles.board, optionalStyle(canvasMode, styles.boardFill)]}>
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
            <View style={[styles.canvasColumn, optionalStyle(canvasMode, styles.canvasColumnFill)]}>
              {boardLayoutQuery.error ? (
                <Message text={errorMessage(boardLayoutQuery.error)} error />
              ) : null}
              <ExperimentCanvas
                experiments={experiments}
                detailByExperiment={detailByExperiment}
                storedPlacements={boardLayoutQuery.data ?? []}
                selectedExperiment={selectedExperiment}
                onSelectExperiment={setSelectedExperiment}
                onClearSelection={clearSelection}
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
              attemptExpansionById={attemptExpansionById}
              onAttemptExpandedChange={setAttemptExpanded}
              active={active}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function ExperimentsHeader({ embedded, actions }: { embedded: boolean; actions: ReactNode }) {
  if (embedded) return null;
  return <MenuHeader title="Experiments" rightContent={actions} />;
}

function EmbeddedExperimentsActions({
  embedded,
  actions,
}: {
  embedded: boolean;
  actions: ReactNode;
}) {
  if (!embedded) return null;
  return <View style={styles.embeddedActions}>{actions}</View>;
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
  attemptExpansionById,
  onAttemptExpandedChange,
  active,
}: {
  serverId: string;
  projectId: string;
  experiment: string;
  experimentById: Map<string, ExperimentRecord>;
  onSelectExperiment: (experiment: string) => void;
  attemptExpansionById: Record<string, boolean>;
  onAttemptExpandedChange: (attemptId: string, expanded: boolean) => void;
  active: boolean;
}) {
  const client = useHostRuntimeClient(serverId);
  const detailQuery = useFetchQuery({
    queryKey: ["experiment", serverId, projectId, experiment],
    queryFn: async () => {
      if (!client) throw new Error("Daemon is unavailable");
      return (await client.getExperiment({ projectId, experiment })).detail;
    },
    enabled: canFetchExperimentDetail(active, Boolean(client)),
    retry: false,
    dataShape: "value",
    staleTimeMs: 5_000,
  });
  const attempts = useMemo(
    () => [...(detailQuery.data?.attempts ?? EMPTY_ATTEMPTS)].sort(compareAttempts),
    [detailQuery.data?.attempts],
  );
  const latestAttemptId = attempts.at(-1)?.id ?? null;
  const agents = useSessionStore((state) => state.sessions[serverId]?.agents);
  const involvedAgents = useMemo(
    () =>
      agents
        ? [...agents.values()]
            .map((agent) => ({
              agent,
              touch: agent.experimentTouches?.find((touch) => touch.experiment === experiment),
            }))
            .filter((entry) => entry.touch !== undefined)
            .sort((left, right) =>
              (right.touch?.lastTouchedAt ?? "").localeCompare(left.touch?.lastTouchedAt ?? ""),
            )
        : [],
    [agents, experiment],
  );

  const basedOnId = detailQuery.data?.experiment.basedOn ?? null;
  const selectBasedOn = useCallback(() => {
    if (basedOnId) onSelectExperiment(basedOnId);
  }, [basedOnId, onSelectExperiment]);

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
      {attempts.length > 0 ? (
        <View style={styles.attemptSection}>
          <View style={styles.attemptSectionHeader}>
            <Text style={styles.sectionTitle}>Attempts</Text>
            <Text style={styles.meta}>{formatAttemptCount(attempts.length)} · oldest first</Text>
          </View>
          <View style={styles.attemptList}>
            {attempts.map((attempt, index) => (
              <AttemptPanel
                key={attempt.id}
                serverId={serverId}
                projectId={projectId}
                attempt={attempt}
                position={index + 1}
                bordered={index > 0}
                expanded={resolveAttemptExpanded(attempt.id, latestAttemptId, attemptExpansionById)}
                onExpandedChange={onAttemptExpandedChange}
                screenActive={active}
              />
            ))}
          </View>
        </View>
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

function AttemptPanel({
  serverId,
  projectId,
  attempt,
  position,
  bordered,
  expanded,
  onExpandedChange,
  screenActive,
}: {
  serverId: string;
  projectId: string;
  attempt: ExperimentAttempt;
  position: number;
  bordered: boolean;
  expanded: boolean;
  onExpandedChange: (attemptId: string, expanded: boolean) => void;
  screenActive: boolean;
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
  const collapsed = !expanded;

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
    if (
      !client ||
      collapsed ||
      !isFocused ||
      !screenActive ||
      !attempt.progressSource ||
      observation?.ended
    )
      return;
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
  }, [
    attempt.id,
    attempt.progressSource,
    client,
    collapsed,
    isFocused,
    observation?.ended,
    refresh,
    screenActive,
  ]);

  const viewerQuery = useFetchQuery({
    queryKey: ["experiment-viewers", serverId, projectId, attempt.id],
    queryFn: async () => {
      if (!client) throw new Error("Daemon is unavailable");
      return (await client.resolveExperimentViewers({ projectId, target: { attempt: attempt.id } }))
        .entries;
    },
    enabled: Boolean(client && screenActive && !collapsed),
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
  const toggleCollapsed = useCallback(
    () => onExpandedChange(attempt.id, !expanded),
    [attempt.id, expanded, onExpandedChange],
  );
  const resolveDirectUrl = useCallback(
    (url: string) => client?.resolveDirectHttpUrl(url) ?? null,
    [client],
  );
  let progressContent = null;
  if (attempt.progressPlans) {
    progressContent = (
      <ExperimentProgressSchedule plan={attempt.progressPlans} observation={observation} />
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
    <View style={[styles.attemptPanel, bordered && styles.attemptPanelBorder]}>
      <View style={styles.attemptPositionRow}>
        <Text style={styles.attemptPosition}>
          Attempt {position} · {formatTimestamp(attempt.createdAt)}
        </Text>
        <Button
          variant="ghost"
          size="xs"
          leftIcon={collapsed ? ChevronRight : ChevronDown}
          onPress={toggleCollapsed}
        >
          {collapsed ? "Expand" : "Collapse"}
        </Button>
      </View>
      <View style={styles.attemptHeader}>
        <View style={styles.flexOne}>
          <Text style={styles.attemptTitle}>{attempt.shortDescription}</Text>
          <Text style={styles.description}>{attempt.purpose}</Text>
        </View>
        {!collapsed && attempt.progressSource ? (
          <Button variant="ghost" size="xs" onPress={handleRefresh} loading={refreshing}>
            Refresh progress
          </Button>
        ) : null}
      </View>
      <AttemptExpandedContent
        hidden={collapsed}
        attempt={attempt}
        progressContent={progressContent}
        progressError={progressError}
        viewerLoading={viewerQuery.isLoading}
        viewerError={viewerQuery.error}
        viewerEntries={viewerQuery.data}
        resolveDirectUrl={resolveDirectUrl}
        serverId={serverId}
        relayConnection={activeConnection?.type === "relay" ? activeConnection : null}
      />
    </View>
  );
}

function AttemptExpandedContent({
  hidden,
  attempt,
  progressContent,
  progressError,
  viewerLoading,
  viewerError,
  viewerEntries,
  resolveDirectUrl,
  serverId,
  relayConnection,
}: {
  hidden: boolean;
  attempt: ExperimentAttempt;
  progressContent: ReactNode;
  progressError: string | null;
  viewerLoading: boolean;
  viewerError: unknown;
  viewerEntries: ResolvedViewerEntry[] | undefined;
  resolveDirectUrl: (url: string) => string | null;
  serverId: string;
  relayConnection: RelayHostConnection | null;
}) {
  if (hidden) return null;
  return (
    <>
      {progressContent}
      {progressError ? <Text style={styles.errorText}>{progressError}</Text> : null}
      {attempt.resultSummary ? (
        <View style={styles.summaryBlock}>
          <Text style={styles.sectionTitle}>Result</Text>
          <Text style={styles.summaryText}>{attempt.resultSummary}</Text>
        </View>
      ) : null}
      <AttemptFields attempt={attempt} />
      {viewerLoading ? <Text style={styles.meta}>Loading viewers…</Text> : null}
      {viewerError ? <Text style={styles.errorText}>{errorMessage(viewerError)}</Text> : null}
      {viewerEntries?.length ? (
        <View style={styles.viewerBlock}>
          <Text style={styles.sectionTitle}>Viewers</Text>
          {viewerEntries.map((entry) => (
            <ViewerEntry
              key={entry.name}
              entry={entry}
              directUrl={resolveDirectUrl(entry.url)}
              serverId={serverId}
              relayConnection={relayConnection}
            />
          ))}
        </View>
      ) : null}
    </>
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

function canFetchExperiments(
  active: boolean,
  hasClient: boolean,
  connected: boolean,
  hasProject: boolean,
): boolean {
  return active && hasClient && connected && hasProject;
}

function canFetchExperimentCanvas(fetchEnabled: boolean, viewMode: ExperimentViewMode): boolean {
  return fetchEnabled && viewMode === "canvas";
}

function canFetchExperimentDetail(active: boolean, hasClient: boolean): boolean {
  return active && hasClient;
}

function findLatestProgressAttempt(attempts: ExperimentAttempt[]): ExperimentAttempt | null {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];
    if (attempt?.progress || attempt?.progressSource || attempt?.progressPlans) return attempt;
  }
  return null;
}

function compareAttempts(left: ExperimentAttempt, right: ExperimentAttempt): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
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

function optionalStyle(enabled: boolean, style: ViewStyle): ViewStyle | null {
  return enabled ? style : null;
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
  contentFill: { flexGrow: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  embeddedActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  board: { flexDirection: { xs: "column", lg: "row" }, gap: theme.spacing[6] },
  boardFill: { flex: 1, minHeight: 0 },
  listColumn: { flex: 1, minWidth: 0, gap: theme.spacing[6] },
  canvasColumn: { flex: 3, minWidth: 0, gap: theme.spacing[2] },
  canvasColumnFill: { minHeight: 0 },
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
  attemptSection: { gap: theme.spacing[2] },
  attemptSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  attemptList: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
  },
  attemptPanel: { gap: theme.spacing[4], padding: theme.spacing[4] },
  attemptPanelBorder: { borderTopWidth: 1, borderTopColor: theme.colors.border },
  attemptPositionRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  attemptPosition: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
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
