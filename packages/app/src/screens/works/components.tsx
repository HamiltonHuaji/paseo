import { useState, useCallback, useMemo, useContext, type ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react-native";
import type { WorkCard, WorkView, WorkProgress } from "@getpaseo/protocol/work-objects";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { useSessionStore } from "@/stores/session-store";
import { ExperimentProgressSchedule } from "@/screens/experiments/experiment-progress-schedule";
import { Metrics } from "./metrics";
import { errorMessage, useWorks, WorkActivityContext } from "./context";
import { workStyles as styles } from "./styles";

export function cardView(card: WorkCard): WorkView {
  const { viewers: _viewers, progress, ...fields } = card;
  return {
    ...fields,
    progress: progress ? { configured: progress, state: card.progressState } : null,
  };
}

interface ComponentProps {
  object: WorkView;
  compact?: boolean;
}
const renderers: Record<string, ComponentType<ComponentProps>> = {
  result: Result,
  metrics: ({ object }) => (object.metrics ? <Metrics value={object.metrics} /> : null),
  progress: Progress,
  viewers: Viewers,
  sessions: Sessions,
  config: Config,
};
export function ObjectComponents({ object, compact }: ComponentProps) {
  return (
    <View style={styles.stack}>
      {Object.entries(renderers).map(([name, Renderer]) => (
        <Renderer key={name} object={object} compact={compact} />
      ))}
    </View>
  );
}

function Result({ object, compact }: ComponentProps) {
  const { client, connected, projectId, serverId } = useWorks();
  const cache = useQueryClient();
  const update = useMutation({
    mutationFn: async () => {
      if (!client || !connected) throw new Error("Host is disconnected");
      const result = { completed: !object.result?.completed };
      if (object.kind === "card")
        await client.updateWorkCard({ projectId, cardId: object.id, result });
      else await client.updateWorkItem({ projectId, itemId: object.id, result });
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ["works", serverId, projectId] }),
  });
  const handleComplete = useCallback(() => update.mutate(), [update]);
  const checkboxState = useMemo(
    () => ({
      checked: object.result?.completed === true,
      disabled: !connected || update.isPending,
    }),
    [object.result?.completed, connected, update.isPending],
  );
  if (!object.result) return null;
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="Completed"
        accessibilityState={checkboxState}
        disabled={!connected || update.isPending}
        style={styles.checkbox}
        onPress={handleComplete}
      >
        <Text style={styles.text}>
          {object.result.completed ? "☑ Completed" : "☐ Mark complete"}
        </Text>
      </Pressable>
      {update.error ? <Text style={styles.error}>{errorMessage(update.error)}</Text> : null}
      {object.result.text && !compact ? <MarkdownRenderer text={object.result.text} /> : null}
    </View>
  );
}

function Progress({ object }: ComponentProps) {
  const { client, serverId, projectId, active, connected } = useWorks();
  const progress = object.progress;
  const query = useFetchQuery({
    queryKey: ["works-progress", serverId, projectId, object.id, progress?.configured],
    queryFn: async () => {
      if (!client || !connected) throw new Error("Host is disconnected");
      const result = await client.refreshWorkProgress({ projectId, objectIds: [object.id] });
      return result.results[0]!;
    },
    enabled: active && connected && Boolean(progress?.configured.source),
    retry: false,
    dataShape: "value",
    staleTimeMs: 10_000,
    refetchInterval: (stateQuery) =>
      active && connected && progress?.configured.source
        ? (stateQuery.state.data?.nextRefreshAfterMs ?? (stateQuery.state.data ? false : 15_000))
        : false,
  });
  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);
  if (!progress) return null;
  const state = query.data ?? progress.state;
  const observation = state.observation;
  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <Text style={styles.title}>Progress</Text>
        {progress.configured.source ? (
          <Button
            variant="ghost"
            size="xs"
            leftIcon={RefreshCw}
            disabled={!connected || query.isFetching}
            onPress={refresh}
          >
            Refresh
          </Button>
        ) : null}
      </View>
      <ProgressDisplay configured={progress.configured} observation={observation} />
      {observation ? (
        <Text style={styles.meta}>Observed {formatTime(observation.observedAt)}</Text>
      ) : null}
      {state.catchingUp ? <Text style={styles.meta}>Reading data…</Text> : null}
      {state.error || query.error ? (
        <Text style={styles.error}>{state.error ?? errorMessage(query.error)}</Text>
      ) : null}
    </View>
  );
}
function ProgressDisplay({
  configured,
  observation,
}: {
  configured: WorkProgress;
  observation: NonNullable<WorkView["progress"]>["state"]["observation"];
}) {
  const projected = useMemo(
    () => (observation ? { ...observation, refreshedAt: observation.observedAt } : null),
    [observation],
  );
  if (configured.plan)
    return <ExperimentProgressSchedule plan={configured.plan} observation={projected} />;
  return (
    <Text style={styles.meta}>
      {observation
        ? `${observation.current} / ${observation.total ?? "?"}${observation.ended ? " · ended" : ""}${observation.message ? ` · ${observation.message}` : ""}`
        : "Waiting for the first observation"}
    </Text>
  );
}

function Viewers({ object, compact }: ComponentProps) {
  const { client, projectId, serverId, active, connected } = useWorks();
  const query = useFetchQuery({
    queryKey: ["works", serverId, projectId, "viewers", object.id],
    queryFn: async () => {
      if (!client) throw new Error("Host is disconnected");
      return client.resolveWorkViewers({ projectId, objectId: object.id });
    },
    enabled: active && connected,
    retry: false,
    dataShape: "value",
    staleTimeMs: 5_000,
  });
  const value = query.data ?? object.viewerEntries;
  if (!value?.entries.length && !value?.sources.length && !query.error) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.title}>
        Viewers{value?.inheritedFrom ? ` · from ${value.inheritedFrom}` : ""}
      </Text>
      {query.error ? <Text style={styles.error}>{errorMessage(query.error)}</Text> : null}
      {value?.entries.map((entry) => (
        <ViewerLink
          key={entry.name}
          title={entry.name}
          path={entry.path}
          unavailable={entry.unavailableReason}
          available={entry.available}
        />
      ))}
      {!compact
        ? value?.sources.map((source) => (
            <ViewerLink
              key={source.source.source}
              title={`${source.source.source} · data`}
              path={`${source.apiPath}/meta`}
              available={source.available}
              unavailable={source.unavailableReason}
            />
          ))
        : null}
    </View>
  );
}
function ViewerLink({
  title,
  path,
  available,
  unavailable,
}: {
  title: string;
  path: string;
  available: boolean;
  unavailable: string | null;
}) {
  const { openViewer, connected } = useWorks();
  const open = useMutation({ mutationFn: () => openViewer(path) });
  const openLink = useCallback(() => open.mutate(), [open]);
  return (
    <View style={styles.stack}>
      <Button
        variant="ghost"
        size="xs"
        leftIcon={ExternalLink}
        disabled={!available || !connected || open.isPending}
        onPress={openLink}
      >
        {title}
      </Button>
      {!available ? <Text style={styles.meta}>{unavailable ?? "Not available yet"}</Text> : null}
      {open.error ? <Text style={styles.error}>{errorMessage(open.error)}</Text> : null}
    </View>
  );
}

function Sessions({ object, compact }: ComponentProps) {
  if (!object.sessions?.agentIds.length) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.title}>Sessions</Text>
      {object.sessions.agentIds.map((id) => (
        <SessionLink key={id} id={id} compact={compact} />
      ))}
    </View>
  );
}
function SessionLink({
  id,
  suffix,
  current = false,
}: {
  id: string;
  compact?: boolean;
  suffix?: string;
  current?: boolean;
}) {
  const { serverId } = useWorks();
  const agent = useSessionStore((state) => state.sessions[serverId]?.agents.get(id));
  const openSession = useCallback(
    () => router.push(buildHostAgentDetailRoute(serverId, id, agent?.workspaceId)),
    [serverId, id, agent?.workspaceId],
  );
  const executing = current && agent?.status === "running";
  return (
    <Button variant="ghost" size="xs" disabled={!agent} onPress={openSession}>
      {agent?.title ?? id} · {agent?.status ?? "unavailable"}
      {executing ? " · working here" : ""}
      {suffix ? ` · ${suffix}` : ""}
    </Button>
  );
}
function Config({ object, compact }: ComponentProps) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  if (!object.config || compact) return null;
  return (
    <View style={styles.section}>
      <Button variant="ghost" size="xs" onPress={toggle}>
        {expanded ? "Hide configuration" : "Configuration"}
      </Button>
      {expanded
        ? Object.entries(object.config).map(([key, value]) => (
            <View key={key} style={styles.stack}>
              <Text style={styles.title}>{key}</Text>
              <Text style={styles.code} selectable>
                {JSON.stringify(value, null, 2)}
              </Text>
            </View>
          ))
        : null}
    </View>
  );
}
export function ObjectActivity({ object }: ComponentProps) {
  const latest = useContext(WorkActivityContext);
  const cardId = object.kind === "card" ? object.id : object.parentCardId;
  return (
    <View style={styles.section}>
      <Text style={styles.meta} selectable>
        {object.id} · {object.label}
      </Text>
      {object.updatedAt ? (
        <Text style={styles.meta}>
          Last activity {formatTime(object.updatedAt)} · {relativeTime(object.updatedAt)}
        </Text>
      ) : null}
      {object.startedAt ? (
        <Text style={styles.meta}>Started {formatTime(object.startedAt)}</Text>
      ) : null}
      {object.endedAt ? <Text style={styles.meta}>Ended {formatTime(object.endedAt)}</Text> : null}
      {object.storage ? (
        <Text style={styles.code} selectable>
          {object.storage.path}
        </Text>
      ) : null}
      {object.touches?.length ? (
        <View style={styles.section}>
          <Text style={styles.title}>Activity by session</Text>
          {object.touches.map((touch) => (
            <SessionLink
              key={touch.agentId}
              id={touch.agentId}
              current={
                latest.get(touch.agentId)?.cardId === cardId &&
                latest.get(touch.agentId)?.at === touch.lastTouchedAt
              }
              suffix={formatTime(touch.lastTouchedAt)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
export function ArchiveButton({ object }: ComponentProps) {
  const { client, connected, projectId, serverId } = useWorks();
  const cache = useQueryClient();
  const archive = useMutation({
    mutationFn: async () => {
      if (!client || !connected) throw new Error("Host is disconnected");
      if (object.kind === "card")
        await client.updateWorkCard({ projectId, cardId: object.id, archived: !object.archivedAt });
      else
        await client.updateWorkItem({ projectId, itemId: object.id, archived: !object.archivedAt });
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ["works", serverId, projectId] }),
  });
  const toggleArchive = useCallback(() => archive.mutate(), [archive]);
  return (
    <View>
      <Button
        variant="ghost"
        size="xs"
        disabled={!connected || archive.isPending}
        onPress={toggleArchive}
      >
        {object.archivedAt ? "Restore" : "Archive"}
      </Button>
      {archive.error ? <Text style={styles.error}>{errorMessage(archive.error)}</Text> : null}
    </View>
  );
}
export function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}
export function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
