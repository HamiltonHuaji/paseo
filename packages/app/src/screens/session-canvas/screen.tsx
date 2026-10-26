import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { BackHandler, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useFetchQueries } from "@/data/query";
import { useShallow } from "zustand/shallow";
import { ArrowDown, ArrowUp, ArrowUpRight, Pencil, RotateCcw, X } from "lucide-react-native";
import type { BoardPlacement } from "@/components/board-canvas/layout";
import { BoardCanvas } from "@/components/board-canvas";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { StatusBadge } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getHostRuntimeStore, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useSessionStore } from "@/stores/session-store";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  WorkspacePaneContent,
  type WorkspacePaneContentModel,
} from "@/screens/workspace/workspace-pane-content";
import { DEFAULT_SESSION_LAYOUT, useSessionCanvasLayout } from "./layout-store";
import {
  SESSION_CARD_SIZE,
  sessionNodes,
  sessionsForCanvas,
  sessionSource,
  sessionAncestors,
  type CanvasSession,
  type SessionArrangement,
} from "./model";
import { styles } from "./styles";

const subscribeHydration = (notify: () => void) =>
  useSessionCanvasLayout.persist.onFinishHydration(notify);
export function SessionCanvasScreen({
  serverId,
  workspaceId,
  active,
  buildConversation,
  onRename,
  onOpen,
}: {
  serverId: string;
  workspaceId: string;
  active: boolean;
  buildConversation: (agentId: string, onClose: () => void) => WorkspacePaneContentModel;
  onRename: (agentId: string) => void;
  onOpen: (agentId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const compact = useIsCompactFormFactor();
  const appVisible = useAppVisible();
  const interactive = active && appVisible;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; revision: number }>();
  const [search, setSearch] = useState("");
  const searchInput = useRef<EditingTextInputHandle>(null);
  const hostSessions = useSessionStore(
    useShallow((state) => [...(state.sessions[serverId]?.agents.values() ?? [])]),
  );
  const sessions = useMemo(
    () => hostSessions.filter((agent) => agent.workspaceId === workspaceId && !agent.archivedAt),
    [hostSessions, workspaceId],
  );
  const connected = useHostRuntimeIsConnected(serverId);
  const supportsLineage = useHostFeature(serverId, "sessionLineage");
  const canvasSessions = useMemo(
    () => sessionsForCanvas(sessions, supportsLineage ? serverId : ""),
    [sessions, serverId, supportsLineage],
  );
  const hostById = useMemo(
    () => new Map(hostSessions.map((session) => [session.id, session])),
    [hostSessions],
  );
  const sources = useMemo(() => {
    const references = new Map<string, { hostId: string; agentId: string }>();
    for (const session of sessions) {
      const reference = sessionSource(
        session.sessionLineage?.find((entry) => entry.operation !== "rewind"),
      );
      if (reference)
        references.set(JSON.stringify([reference.hostId, reference.agentId]), reference);
    }
    return [...references.values()];
  }, [sessions]);
  const sourceQueries = useFetchQueries(
    sources.map((reference) => ({
      queryKey: ["session-canvas-source", reference.hostId, reference.agentId],
      enabled:
        interactive &&
        connected &&
        !(reference.hostId === serverId && hostById.has(reference.agentId)),
      staleTimeMs: 60_000,
      dataShape: "value",
      queryFn: async () => {
        const client = getHostRuntimeStore().getClient(reference.hostId);
        if (!client) throw new Error(t("sessionCanvas.offline"));
        const result = await client.fetchAgent(reference.agentId);
        return result ? normalizeAgentSnapshot(result.agent, reference.hostId) : null;
      },
    })),
  );
  const sourceById = useMemo(() => {
    const result = new Map<string, CanvasSession>();
    sources.forEach((reference, index) => {
      const source = reference.hostId === serverId ? hostById.get(reference.agentId) : undefined;
      const resolved = source ?? sourceQueries[index].data;
      if (resolved) result.set(JSON.stringify([reference.hostId, reference.agentId]), resolved);
    });
    return result;
  }, [sources, hostById, sourceQueries, serverId]);
  const key = JSON.stringify([serverId, workspaceId]);
  const layout = useSessionCanvasLayout((state) => state.workspaces[key] ?? DEFAULT_SESSION_LAYOUT);
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    useSessionCanvasLayout.persist.hasHydrated,
    () => false,
  );
  const sync = useSessionCanvasLayout((state) => state.sync);
  const arrange = useSessionCanvasLayout((state) => state.arrange);
  const move = useSessionCanvasLayout((state) => state.move);
  const layoutError = useSessionCanvasLayout((state) => state.error);
  useEffect(() => {
    if (interactive && hydrated) sync(key, canvasSessions);
  }, [interactive, hydrated, key, canvasSessions, sync]);
  const close = useCallback(() => setSelectedId(null), []);
  const selected = sessions.find((session) => session.id === selectedId);
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );
  const visibleAgentId = interactive ? selected?.id : undefined;
  useLayoutEffect(() => {
    if (!viewedTimelineSync) return;
    const source = `session-canvas:${key}`;
    viewedTimelineSync.replaceVisibleAgentIds(source, visibleAgentId ? [visibleAgentId] : []);
    return () => viewedTimelineSync.replaceVisibleAgentIds(source, []);
  }, [key, viewedTimelineSync, visibleAgentId]);
  useEffect(() => {
    if (!visibleAgentId) return;
    void getHostRuntimeStore()
      .prepareAgentTimeline(serverId, visibleAgentId)
      .catch(() => undefined);
  }, [serverId, visibleAgentId]);
  useEffect(() => {
    if (!interactive || !selected) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => listener.remove();
  }, [interactive, selected, close]);
  const conversation = useMemo(
    () => (selectedId ? buildConversation(selectedId, close) : null),
    [selectedId, buildConversation, close],
  );
  const nodes = useMemo(
    () => sessionNodes(canvasSessions, t("sessionCanvas.untitled")),
    [canvasSessions, t],
  );
  const sizes = useMemo(
    () => new Map(sessions.map((session) => [session.id, SESSION_CARD_SIZE])),
    [sessions],
  );
  const byId = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const visibleIds = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return new Set(
      sessions
        .filter(
          (session) =>
            !query ||
            `${session.title ?? ""} ${session.id} ${session.provider}`
              .toLocaleLowerCase()
              .includes(query),
        )
        .map((session) => session.id),
    );
  }, [search, sessions]);
  const format = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }),
    [i18n.language],
  );
  const changeTime = useCallback(
    (time: SessionArrangement) => arrange(key, canvasSessions, time, layout.order),
    [arrange, key, canvasSessions, layout.order],
  );
  const changeOrder = useCallback(
    () =>
      arrange(key, canvasSessions, layout.time, layout.order === "oldest" ? "newest" : "oldest"),
    [arrange, key, canvasSessions, layout.time, layout.order],
  );
  const rearrange = useCallback(
    () => arrange(key, canvasSessions, layout.time, layout.order),
    [arrange, key, canvasSessions, layout.time, layout.order],
  );
  const moveCard = useCallback((placement: BoardPlacement) => move(key, placement), [move, key]);
  const focusSession = useCallback((id: string) => {
    searchInput.current?.replaceText("");
    setSearch("");
    setSelectedId(id);
    setFocusRequest((current) => ({ id, revision: (current?.revision ?? 0) + 1 }));
  }, []);
  const openSource = useCallback(
    (id: string) => {
      const origin = byId.get(id)?.sessionLineage?.find((entry) => entry.operation !== "rewind");
      const reference = sessionSource(origin);
      if (!reference) return;
      if (reference.hostId === serverId && byId.has(reference.agentId)) {
        focusSession(reference.agentId);
        return;
      }
      const source = sourceById.get(JSON.stringify([reference.hostId, reference.agentId]));
      if (reference.hostId === serverId && source?.workspaceId === workspaceId) {
        onOpen(reference.agentId);
        return;
      }
      navigateToAgent({
        serverId: reference.hostId,
        agentId: reference.agentId,
        workspaceId: source?.workspaceId,
      });
    },
    [byId, focusSession, onOpen, serverId, sourceById, workspaceId],
  );
  const ancestors = selectedId ? sessionAncestors(selectedId, canvasSessions) : [];
  const renderPreview = useCallback(
    (id: string) => {
      const session = byId.get(id);
      const origin = session?.sessionLineage?.find((entry) => entry.operation !== "rewind");
      const reference = sessionSource(origin);
      const source = reference
        ? sourceById.get(JSON.stringify([reference.hostId, reference.agentId]))
        : undefined;
      let sourceLocation:
        | "archivedSource"
        | "outsideView"
        | "otherWorkspace"
        | "otherHost"
        | undefined;
      if (reference && reference.hostId !== serverId) sourceLocation = "otherHost";
      else if (source?.archivedAt) sourceLocation = "archivedSource";
      else if (source?.workspaceId && source.workspaceId !== workspaceId)
        sourceLocation = "otherWorkspace";
      else if (reference && !visibleIds.has(reference.agentId)) sourceLocation = "outsideView";
      return session ? (
        <SessionPreview
          session={session}
          source={source}
          sourceLocation={sourceLocation}
          onOpenSource={openSource}
          supportsLineage={supportsLineage}
          format={format}
        />
      ) : null;
    },
    [byId, sourceById, visibleIds, openSource, serverId, workspaceId, format, supportsLineage],
  );
  const rename = useCallback(() => {
    if (selectedId) onRename(selectedId);
  }, [selectedId, onRename]);
  const open = useCallback(() => {
    if (selectedId) onOpen(selectedId);
  }, [selectedId, onOpen]);
  return (
    <View style={styles.screen} testID="session-canvas-screen">
      <View style={styles.toolbar}>
        <Text style={styles.title}>{t("sessionCanvas.title")}</Text>
        <EditingTextInput
          ref={searchInput}
          style={styles.search}
          initialValue={search}
          onChangeText={setSearch}
          placeholder={t("sessionCanvas.search")}
          accessibilityLabel={t("sessionCanvas.search")}
        />
        <SegmentedControl
          size="sm"
          value={layout.time}
          onValueChange={changeTime}
          options={[
            {
              value: "relationships",
              label: t("sessionCanvas.byRelationship"),
              testID: "session-sort-relationships",
            },
            { value: "created", label: t("sessionCanvas.created"), testID: "session-sort-created" },
            { value: "forked", label: t("sessionCanvas.forked"), testID: "session-sort-forked" },
            { value: "reply", label: t("sessionCanvas.reply"), testID: "session-sort-reply" },
            { value: "input", label: t("sessionCanvas.input"), testID: "session-sort-input" },
          ]}
        />
        <Button
          size="sm"
          variant="ghost"
          leftIcon={layout.order === "oldest" ? ArrowDown : ArrowUp}
          testID="session-sort-direction"
          onPress={changeOrder}
        >
          {t(layout.order === "oldest" ? "sessionCanvas.oldest" : "sessionCanvas.newest")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={RotateCcw}
          testID="session-canvas-arrange"
          onPress={rearrange}
        >
          {t("sessionCanvas.arrange")}
        </Button>
      </View>
      <View style={styles.split}>
        <View style={[styles.canvas, compact && selected && styles.hidden]}>
          {sessions.length && visibleIds.size ? (
            <BoardCanvas
              active={interactive && !(compact && selected)}
              layoutRevision={layout.revision}
              experiments={nodes}
              sizes={sizes}
              storedPlacements={layout.placements}
              visibleIds={visibleIds}
              selectedExperiment={selected?.id ?? null}
              focusRequest={focusRequest}
              onSelectExperiment={setSelectedId}
              onClearSelection={close}
              onPersistPlacement={moveCard}
              renderContent={renderPreview}
            />
          ) : (
            <View style={styles.empty}>
              <Text style={styles.muted}>
                {t(search ? "sessionCanvas.noMatches" : "sessionCanvas.empty")}
              </Text>
            </View>
          )}
        </View>
        {selected && conversation ? (
          <View style={styles.detail} testID="session-canvas-detail">
            <View style={styles.detailHeader}>
              <View style={styles.grow}>
                <Text style={styles.title} numberOfLines={1}>
                  {selected.title || t("sessionCanvas.untitled")}
                </Text>
              </View>
              <Button
                size="sm"
                variant="ghost"
                leftIcon={Pencil}
                testID="session-canvas-rename"
                onPress={rename}
                accessibilityLabel={t("sessionCanvas.rename")}
              />
              <Button
                size="sm"
                variant="ghost"
                leftIcon={ArrowUpRight}
                testID="session-canvas-open-tab"
                onPress={open}
                accessibilityLabel={t("sessionCanvas.openTab")}
              />
              <Button
                size="sm"
                variant="ghost"
                leftIcon={X}
                testID="session-canvas-close-detail"
                onPress={close}
                accessibilityLabel={t("common.actions.close")}
              />
            </View>
            <AncestorTrail ancestors={ancestors} onSelect={focusSession} />
            {supportsLineage ? (
              <SessionLineageDetails session={selected} onOpenSource={openSource} />
            ) : (
              <Text style={styles.muted}>{t("sessionCanvas.lineageUpgrade")}</Text>
            )}
            <WorkspacePaneContent
              content={conversation}
              isWorkspaceFocused={interactive}
              isPaneFocused={interactive}
            />
          </View>
        ) : null}
      </View>
      <CanvasCaption
        error={layoutError}
        time={layout.time}
        count={sessions.length}
        connected={connected}
      />
    </View>
  );
}

function SessionPreview({
  session,
  source,
  sourceLocation,
  onOpenSource,
  supportsLineage,
  format,
}: {
  session: CanvasSession;
  source?: CanvasSession;
  sourceLocation?: "archivedSource" | "outsideView" | "otherWorkspace" | "otherHost";
  onOpenSource: (id: string) => void;
  supportsLineage: boolean;
  format: Intl.DateTimeFormat;
}) {
  const { t } = useTranslation();
  const origin = session.sessionLineage?.find((entry) => entry.operation !== "rewind");
  const reference = sessionSource(origin);
  const openSource = useCallback(
    (event: import("react-native").GestureResponderEvent) => {
      event.stopPropagation();
      onOpenSource(session.id);
    },
    [onOpenSource, session.id],
  );
  const times = [
    [t("sessionCanvas.created"), session.createdAt],
    [t("sessionCanvas.forked"), origin ? new Date(origin.createdAt) : null],
    [t("sessionCanvas.reply"), session.lastAssistantMessageAt],
    [t("sessionCanvas.input"), session.lastUserMessageAt],
  ] as const;
  let sourceContent = null;
  if (supportsLineage && origin) {
    sourceContent = (
      <Text style={styles.muted} numberOfLines={2}>
        {t(`sessionCanvas.resolutions.${origin.sourceResolution}`)} ·{" "}
        {origin.sourceAgentId || origin.sourceProviderSessionId || "—"}
      </Text>
    );
    if (reference)
      sourceContent = (
        <Button
          size="xs"
          variant="ghost"
          style={styles.sourceButton}
          textStyle={styles.sourceText}
          onPress={openSource}
          testID={`session-source-${session.id}`}
        >
          {t("sessionCanvas.from", { title: source?.title || reference.agentId.slice(0, 8) })}
          {sourceLocation ? ` · ${t(`sessionCanvas.${sourceLocation}`)}` : ""}
        </Button>
      );
  }
  return (
    <View style={styles.preview} testID={`session-card-${session.id}`}>
      <View style={styles.row}>
        <Text style={styles.muted}>
          {session.provider} · {session.id.slice(0, 8)}
        </Text>
        <StatusBadge
          label={t(`sessionCanvas.status.${session.status}`)}
          variant={sessionStatusVariant(session.status)}
        />
      </View>
      <View style={styles.times}>
        {times.map(([label, date]) => (
          <View style={styles.row} key={label}>
            <Text style={styles.muted}>{label}</Text>
            <Text style={styles.time}>{date ? format.format(date) : "—"}</Text>
          </View>
        ))}
      </View>
      {sourceContent}
    </View>
  );
}

function sessionStatusVariant(status: CanvasSession["status"]) {
  if (status === "running") return "success";
  if (status === "error") return "error";
  return "muted";
}

function SessionLineageDetails({
  session,
  onOpenSource,
}: {
  session: CanvasSession;
  onOpenSource: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const openSource = useCallback(() => onOpenSource(session.id), [onOpenSource, session.id]);
  const entries = session.sessionLineage ?? [];
  const reference = sessionSource(entries.find((entry) => entry.operation !== "rewind"));
  if (!entries.length) return null;
  return (
    <View style={styles.relationships}>
      {reference ? (
        <Button size="xs" variant="ghost" onPress={openSource} testID="session-detail-source">
          {t("sessionCanvas.openSource")}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" onPress={toggleExpanded} testID="session-lineage-toggle">
        {t("sessionCanvas.relationships", { count: entries.length })}
      </Button>
      {expanded ? (
        <ScrollView style={styles.relationshipList} testID="session-lineage-details">
          {entries.map((entry) => (
            <View
              key={`${entry.createdAt}:${entry.operation}:${entry.resultProviderSessionId}:${entry.boundaryMessageId}`}
              style={styles.relationshipEntry}
            >
              <Text style={styles.text}>
                {t(`sessionCanvas.operations.${entry.operation}`)} · {entry.createdAt}
              </Text>
              <Text style={styles.text}>
                {t(`sessionCanvas.resolutions.${entry.sourceResolution}`)}
              </Text>
              {[
                [t("sessionCanvas.sourceHost"), entry.sourceHostId],
                [t("sessionCanvas.sourceSession"), entry.sourceAgentId],
                [t("sessionCanvas.sourceNative"), entry.sourceProviderSessionId],
                [t("sessionCanvas.resultNative"), entry.resultProviderSessionId],
                [t("sessionCanvas.sourceTree"), entry.sourceProviderSessionTreeId],
                [t("sessionCanvas.resultTree"), entry.resultProviderSessionTreeId],
                [t("sessionCanvas.boundary"), entry.boundaryMessageId],
                ...(entry.candidateAgentIds?.length
                  ? [[t("sessionCanvas.candidates"), entry.candidateAgentIds.join(", ")]]
                  : []),
              ].map(([label, value]) => (
                <Text key={label} selectable style={styles.muted}>
                  {label}: {value || t("sessionCanvas.unknown")}
                </Text>
              ))}
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function CanvasCaption({
  error,
  time,
  count,
  connected,
}: {
  error: Error | null;
  time: SessionArrangement;
  count: number;
  connected: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.caption}>
      {error ? <Text style={styles.error}>{error.message}</Text> : null}
      <Text style={styles.muted}>
        {t(time === "relationships" ? "sessionCanvas.familyCaption" : "sessionCanvas.caption", {
          count: count,
        })}
        {" · "}
        {t("sessionCanvas.historyNote")}
        {!connected ? ` · ${t("sessionCanvas.offline")}` : ""}
      </Text>
    </View>
  );
}

function AncestorTrail({
  ancestors,
  onSelect,
}: {
  ancestors: CanvasSession[];
  onSelect: (id: string) => void;
}) {
  if (!ancestors.length) return null;
  return (
    <ScrollView
      horizontal
      style={styles.ancestorTrail}
      contentContainerStyle={styles.ancestorContent}
      testID="session-ancestor-trail"
    >
      {ancestors.map((session) => (
        <AncestorButton key={session.id} session={session} onSelect={onSelect} />
      ))}
    </ScrollView>
  );
}

function AncestorButton({
  session,
  onSelect,
}: {
  session: CanvasSession;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const select = useCallback(() => onSelect(session.id), [onSelect, session.id]);
  return (
    <Button size="xs" variant="ghost" onPress={select} testID={`session-ancestor-${session.id}`}>
      {session.title || t("sessionCanvas.untitled")}
    </Button>
  );
}
