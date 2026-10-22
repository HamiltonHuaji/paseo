import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { BackHandler, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";
import { ArrowDown, ArrowUp, ArrowUpRight, Pencil, RotateCcw, X } from "lucide-react-native";
import type { BoardPlacement } from "@/components/board-canvas/layout";
import { BoardCanvas } from "@/components/board-canvas";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EditingTextInput } from "@/components/ui/text-input";
import { StatusBadge } from "@/components/ui/status-badge";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getHostRuntimeStore, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useSessionStore } from "@/stores/session-store";
import {
  WorkspacePaneContent,
  type WorkspacePaneContentModel,
} from "@/screens/workspace/workspace-pane-content";
import { DEFAULT_SESSION_LAYOUT, useSessionCanvasLayout } from "./layout-store";
import { SESSION_CARD_SIZE, sessionNodes, type CanvasSession, type SessionTime } from "./model";
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
  const [search, setSearch] = useState("");
  const sessions = useSessionStore(
    useShallow((state) =>
      [...(state.sessions[serverId]?.agents.values() ?? [])].filter(
        (agent) => agent.workspaceId === workspaceId && !agent.archivedAt,
      ),
    ),
  );
  const connected = useHostRuntimeIsConnected(serverId);
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
  useEffect(() => {
    if (interactive && hydrated) sync(key, sessions);
  }, [interactive, hydrated, key, sessions, sync]);
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
  const nodes = useMemo(() => sessionNodes(sessions, t("sessionCanvas.untitled")), [sessions, t]);
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
    (time: SessionTime) => arrange(key, sessions, time, layout.order),
    [arrange, key, sessions, layout.order],
  );
  const changeOrder = useCallback(
    () => arrange(key, sessions, layout.time, layout.order === "oldest" ? "newest" : "oldest"),
    [arrange, key, sessions, layout.time, layout.order],
  );
  const rearrange = useCallback(
    () => arrange(key, sessions, layout.time, layout.order),
    [arrange, key, sessions, layout.time, layout.order],
  );
  const moveCard = useCallback((placement: BoardPlacement) => move(key, placement), [move, key]);
  const renderPreview = useCallback(
    (id: string) => {
      const session = byId.get(id);
      return session ? (
        <SessionPreview
          session={session}
          source={byId.get(session.forkedFrom?.agentId ?? "")}
          format={format}
        />
      ) : null;
    },
    [byId, format],
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
        {!compact || !selected ? (
          <View style={styles.canvas}>
            {sessions.length && visibleIds.size ? (
              <BoardCanvas
                active={interactive}
                layoutRevision={layout.revision}
                experiments={nodes}
                sizes={sizes}
                storedPlacements={layout.placements}
                visibleIds={visibleIds}
                selectedExperiment={selected?.id ?? null}
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
        ) : null}
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
            <WorkspacePaneContent
              content={conversation}
              isWorkspaceFocused={interactive}
              isPaneFocused={interactive}
            />
          </View>
        ) : null}
      </View>
      <View style={styles.caption}>
        <Text style={styles.muted}>
          {t("sessionCanvas.caption", { count: sessions.length })}
          {" · "}
          {t("sessionCanvas.historyNote")}
          {!connected ? ` · ${t("sessionCanvas.offline")}` : ""}
        </Text>
      </View>
    </View>
  );
}

function SessionPreview({
  session,
  source,
  format,
}: {
  session: CanvasSession;
  source?: CanvasSession;
  format: Intl.DateTimeFormat;
}) {
  const { t } = useTranslation();
  const times = [
    [t("sessionCanvas.created"), session.createdAt],
    [t("sessionCanvas.forked"), session.forkedFrom ? new Date(session.forkedFrom.forkedAt) : null],
    [t("sessionCanvas.reply"), session.lastAssistantMessageAt],
    [t("sessionCanvas.input"), session.lastUserMessageAt],
  ] as const;
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
      {session.forkedFrom ? (
        <Text style={styles.muted} numberOfLines={1}>
          {t("sessionCanvas.from", {
            title: source?.title || session.forkedFrom.agentId.slice(0, 8),
          })}
        </Text>
      ) : null}
    </View>
  );
}

function sessionStatusVariant(status: CanvasSession["status"]) {
  if (status === "running") return "success";
  if (status === "error") return "error";
  return "muted";
}
