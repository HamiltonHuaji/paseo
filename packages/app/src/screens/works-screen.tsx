import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { EditingTextInput } from "@/components/ui/text-input";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useIsFocused } from "@react-navigation/native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Grid2X2, List, RefreshCw, Undo2, GitBranch } from "lucide-react-native";
import type {
  WorkCard,
  WorkPlacement,
  WorkSelect,
  WorkView,
} from "@getpaseo/protocol/work-objects";
import { useHostFeature } from "@/runtime/host-features";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFetchQuery } from "@/data/query";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { BoardCanvas } from "@/components/board-canvas";
import {
  arrangeLineageTrees,
  resolveBoardPlacements,
  type BoardPlacement,
  type BoardSize,
} from "@/components/board-canvas/layout";
import { useWorksConnection } from "./works/connection";
import { useAppVisible } from "@/hooks/use-app-visible";
import { WorksContext, WorkActivityContext, useWorks, errorMessage } from "./works/context";
import {
  ObjectComponents,
  ObjectActivity,
  ArchiveButton,
  cardView,
  formatTime,
  relativeTime,
} from "./works/components";
import { workStyles as styles } from "./works/styles";

const DETAIL_SELECT: WorkSelect = [
  "timestamps",
  "touches",
  "sessions",
  "viewers",
  "viewerEntries",
  "progress",
  "metrics",
  "result",
  "config",
  "storage",
];
const EMPTY_CARDS: WorkCard[] = [];
const EMPTY_PLACEMENTS: WorkPlacement[] = [];
const VIEW_KEY = "works-board-view-mode";
export function WorksScreen({
  serverId,
  projectId,
  active = true,
  embedded = false,
}: {
  serverId: string;
  projectId: string;
  active?: boolean;
  embedded?: boolean;
}) {
  const focused = useIsFocused();
  const appVisible = useAppVisible();
  const supported = useHostFeature(serverId, "works");
  const context = useWorksConnection(
    serverId,
    projectId,
    active && focused && appVisible && supported,
  );
  if (!supported)
    return (
      <View style={styles.content}>
        <Text style={styles.text}>Update the host to use Works.</Text>
      </View>
    );
  return (
    <WorksContext.Provider value={context}>
      <WorksBoard key={`${serverId}:${projectId}`} embedded={embedded} />
    </WorksContext.Provider>
  );
}

function WorksBoard({ embedded }: { embedded: boolean }) {
  const { client, serverId, projectId, active, connected } = useWorks();
  const compact = useIsCompactFormFactor();
  const [, refreshAge] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => refreshAge((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, [active]);
  const cache = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"canvas" | "list">("canvas");
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [undo, setUndo] = useState<WorkPlacement[] | null>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const board = useFetchQuery({
    queryKey: ["works", serverId, projectId, "board"],
    queryFn: async () => {
      if (!client) throw new Error("Host is disconnected");
      return client.getWorkBoard({ projectId, archive: "all" });
    },
    enabled: active && connected,
    retry: false,
    dataShape: "value",
    staleTimeMs: 5_000,
  });
  const cards = board.data?.cards ?? EMPTY_CARDS;
  const latestTouches = useMemo(() => latestCardTouches(cards), [cards]);
  const stored = board.data?.placements ?? EMPTY_PLACEMENTS;
  const sizes = useMemo(
    () =>
      new Map(
        cards.map((card) => [card.id, { width: 15, height: cardHeight(card) } satisfies BoardSize]),
      ),
    [cards],
  );
  const placements = useMemo(() => stored.map(toBoard), [stored]);
  const resolved = useMemo(
    () => resolveBoardPlacements(cards, sizes, placements),
    [cards, sizes, placements],
  );
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return cards.filter(
      (card) =>
        (includeArchived || !card.archivedAt) &&
        (!term ||
          `${card.id} ${card.title} ${card.body} ${card.goal ?? ""} ${card.label}`
            .toLocaleLowerCase()
            .includes(term)),
    );
  }, [cards, includeArchived, search]);
  const visibleIds = useMemo(() => new Set(filtered.map((card) => card.id)), [filtered]);
  const groups = useMemo(() => {
    const grouped = new Map<string, WorkCard[]>();
    for (const card of filtered) {
      const goal = card.goal ?? "Ungrouped";
      grouped.set(goal, [...(grouped.get(goal) ?? []), card]);
    }
    return grouped;
  }, [filtered]);
  useEffect(() => {
    void AsyncStorage.getItem(VIEW_KEY)
      .then((value) => {
        if (value === "list" || value === "canvas") setMode(value);
        return undefined;
      })
      .catch((error) => setSubscriptionError(errorMessage(error)));
  }, []);
  const changeMode = useCallback((value: "canvas" | "list") => {
    setMode(value);
    void AsyncStorage.setItem(VIEW_KEY, value).catch((error) =>
      setSubscriptionError(errorMessage(error)),
    );
  }, []);
  useEffect(() => {
    if (!active || !client || !connected) return;
    let disposed = false;
    void client
      .subscribeWorkProject({ projectId })
      .then(() => {
        if (!disposed) {
          setSubscriptionError(null);
          void cache.invalidateQueries({ queryKey: ["works", serverId, projectId] });
        }
        return undefined;
      })
      .catch((error) => {
        if (!disposed) setSubscriptionError(errorMessage(error));
      });
    const unsubscribe = client.subscribe((event) => {
      if (event.type === "work.project.changed" && event.payload.projectId === projectId)
        void cache.invalidateQueries({ queryKey: ["works", serverId, projectId] });
    });
    return () => {
      disposed = true;
      unsubscribe();
      void client.unsubscribeWorkProject({ projectId }).catch(() => undefined);
    };
  }, [active, cache, client, connected, projectId, serverId]);
  useEffect(() => {
    if (active) return;
    void cache.cancelQueries({ queryKey: ["works-data", serverId, projectId] });
    void cache.cancelQueries({ queryKey: ["works-progress", serverId, projectId] });
  }, [active, cache, serverId, projectId]);
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setSelected(null);
      return true;
    });
    return () => subscription.remove();
  }, [active]);
  const saveLayout = useMutation({
    mutationFn: async (values: WorkPlacement[]) => {
      if (!client || !connected) throw new Error("Host is disconnected");
      await client.updateWorkBoard({ projectId, placements: values });
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ["works", serverId, projectId] }),
    onError: () => setLayoutVersion((version) => version + 1),
  });
  const arrange = useCallback(() => {
    setUndo([...resolved.values()].map(fromBoard));
    saveLayout.mutate(arrangeLineageTrees(cards, resolved).map(fromBoard), {
      onSuccess: () => setLayoutVersion((version) => version + 1),
    });
  }, [resolved, saveLayout, cards]);
  const restoreLayout = useCallback(() => {
    if (undo)
      saveLayout.mutate(undo, {
        onSuccess: () => {
          setUndo(null);
          setLayoutVersion((version) => version + 1);
        },
      });
  }, [undo, saveLayout]);
  const refresh = useCallback(() => {
    void cache.invalidateQueries({ queryKey: ["works", serverId, projectId] });
    void cache.invalidateQueries({ queryKey: ["works-data", serverId, projectId] });
    void cache.invalidateQueries({ queryKey: ["works-progress", serverId, projectId] });
  }, [cache, serverId, projectId]);
  const closeDetail = useCallback(() => setSelected(null), []);
  const persistPlacement = useCallback(
    (value: BoardPlacement) => saveLayout.mutate([fromBoard(value)]),
    [saveLayout],
  );
  const toggleArchived = useCallback(() => setIncludeArchived((value) => !value), []);
  const renderCard = useCallback(
    (id: string) => (
      <WorkCardPreview
        card={cards.find((card) => card.id === id)!}
        count={board.data?.itemCounts[id] ?? 0}
        inCanvas
      />
    ),
    [cards, board.data?.itemCounts],
  );
  return (
    <WorkActivityContext.Provider value={latestTouches}>
      <View style={styles.screen}>
        {!embedded ? <MenuHeader title="Works" /> : null}
        <View style={styles.content}>
          <BoardToolbar
            search={search}
            onSearch={setSearch}
            mode={mode}
            changeMode={changeMode}
            includeArchived={includeArchived}
            toggleArchived={toggleArchived}
            connected={connected}
            refresh={refresh}
            arranging={saveLayout.isPending}
            arrange={arrange}
            hasUndo={Boolean(undo)}
            restoreLayout={restoreLayout}
          />
          <BoardStatus
            connected={connected}
            error={board.error ?? subscriptionError ?? saveLayout.error}
            pending={board.isPending}
            empty={filtered.length === 0}
            hasCards={cards.length > 0}
          />
          <View style={styles.split}>
            {!compact || !selected ? (
              <View style={styles.pane}>
                {mode === "canvas" ? (
                  <BoardCanvas
                    key={layoutVersion}
                    experiments={cards}
                    sizes={sizes}
                    storedPlacements={placements}
                    visibleIds={visibleIds}
                    active={active}
                    selectedExperiment={selected}
                    onSelectExperiment={setSelected}
                    onClearSelection={closeDetail}
                    onPersistPlacement={persistPlacement}
                    renderContent={renderCard}
                  />
                ) : (
                  <WorkCardList
                    groups={groups}
                    selected={selected}
                    counts={board.data?.itemCounts}
                    onSelect={setSelected}
                  />
                )}
              </View>
            ) : null}
            {selected ? (
              <View style={styles.detailPane}>
                <CardDetail
                  cardId={selected}
                  cards={cards}
                  onSelect={setSelected}
                  onClose={closeDetail}
                />
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </WorkActivityContext.Provider>
  );
}

function CardDetail({
  cardId,
  cards,
  onSelect,
  onClose,
}: {
  cardId: string;
  cards: WorkCard[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const { client, projectId, serverId, active, connected } = useWorks();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [includeArchived, setIncludeArchived] = useState(false);
  const query = useFetchQuery({
    queryKey: ["works", serverId, projectId, "card", cardId],
    queryFn: async () => {
      if (!client) throw new Error("Host is disconnected");
      return client.getWorkCard({ projectId, cardId, allItems: true, select: DETAIL_SELECT });
    },
    enabled: active && connected,
    retry: false,
    dataShape: "value",
    staleTimeMs: 5_000,
  });
  const card = query.data?.object;
  const items = query.data?.items?.filter((item) => includeArchived || !item.archivedAt) ?? [];
  const basedOn = card?.kind === "card" ? card.basedOn : null;
  const completed = items.filter((item) => item.result?.completed).length;
  const tracked = items.filter((item) => item.result !== null && item.result !== undefined).length;
  const toggleArchived = useCallback(() => setIncludeArchived((value) => !value), []);
  const setItemExpanded = useCallback(
    (id: string, value: boolean) => setExpanded((current) => ({ ...current, [id]: value })),
    [],
  );
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Button variant="ghost" size="xs" onPress={onClose}>
        Back to board
      </Button>
      {query.isPending ? <Text style={styles.meta}>Loading details…</Text> : null}
      {query.error ? <Text style={styles.error}>{errorMessage(query.error)}</Text> : null}
      {card ? (
        <View style={styles.card}>
          <Text style={styles.heading}>{card.title}</Text>
          <MarkdownRenderer text={card.body} />
          <ObjectComponents object={card} />
          <ObjectActivity object={card} />
          <ArchiveButton object={card} />
          {basedOn ? (
            <RelatedCardLink
              id={basedOn}
              title={`Based on: ${cards.find((candidate) => candidate.id === basedOn)?.title ?? basedOn}`}
              onSelect={onSelect}
            />
          ) : null}
          {cards
            .filter((candidate) => candidate.basedOn === card.id)
            .map((child) => (
              <RelatedCardLink
                key={child.id}
                id={child.id}
                title={`Derived: ${child.title}`}
                onSelect={onSelect}
              />
            ))}
          <View style={styles.row}>
            <Text style={styles.title}>
              {card.label === "experiment" ? "Runs" : "Work items"} · {items.length}
              {tracked ? ` · ${completed}/${tracked} completed` : ""}
            </Text>
            <Button size="xs" variant="ghost" onPress={toggleArchived}>
              {includeArchived ? "Hide archived" : "Include archived"}
            </Button>
          </View>
          {items.map((item, index) => (
            <ItemRow
              key={item.id}
              object={item}
              index={index}
              expanded={expanded[item.id] ?? index === items.length - 1}
              onExpandedChange={setItemExpanded}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
function ItemRow({
  object,
  index,
  expanded,
  onExpandedChange,
}: {
  object: WorkView;
  index: number;
  expanded: boolean;
  onExpandedChange: (id: string, expanded: boolean) => void;
}) {
  const onToggle = useCallback(
    () => onExpandedChange(object.id, !expanded),
    [object.id, expanded, onExpandedChange],
  );
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);
  return (
    <View style={styles.item}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        onPress={onToggle}
      >
        <Text style={styles.title}>
          {expanded ? "▾" : "▸"} {index + 1}. {object.title}
        </Text>
        <Text style={styles.meta}>
          {object.label} · {object.createdAt ? formatTime(object.createdAt) : ""}
        </Text>
      </Pressable>
      {expanded ? (
        <>
          <MarkdownRenderer text={object.body} />
          <ObjectComponents object={object} />
          <ObjectActivity object={object} />
          <ArchiveButton object={object} />
        </>
      ) : null}
    </View>
  );
}
function toBoard({ cardId, ...placement }: WorkPlacement): BoardPlacement {
  return { id: cardId, ...placement };
}
function fromBoard({ id, ...placement }: BoardPlacement): WorkPlacement {
  return { cardId: id, ...placement };
}

function cardHeight(card: WorkCard): number {
  const metrics =
    card.metrics?.panels.reduce(
      (height, panel) => height + (panel.display === "line" ? 9 : 3) + panel.series.length,
      0,
    ) ?? 0;
  return (
    9 +
    metrics +
    (card.progress ? 8 : 0) +
    (card.result ? 2 : 0) +
    (card.sessions?.agentIds.length ?? 0) * 2 +
    Object.keys(card.viewers?.entries ?? {}).length * 2
  );
}
function WorkCardPreview({
  card,
  count,
  inCanvas = false,
}: {
  card: WorkCard;
  count: number;
  inCanvas?: boolean;
}) {
  return (
    <View style={styles.stack}>
      {!inCanvas ? <Text style={styles.title}>{card.title}</Text> : null}
      <Text style={styles.meta}>
        {card.label} · {count} {card.label === "experiment" ? "runs" : "work items"}
        {card.goal ? ` · ${card.goal}` : ""}
        {card.archivedAt ? " · archived" : ""}
      </Text>
      <Text style={styles.text} numberOfLines={inCanvas ? 3 : undefined}>
        {card.body}
      </Text>
      <ObjectComponents object={cardView(card)} compact />
      <Text style={styles.meta}>Last activity {relativeTime(card.updatedAt)}</Text>
    </View>
  );
}
function WorkCardTile({
  card,
  count,
  selected,
  onSelect,
}: {
  card: WorkCard;
  count: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const select = useCallback(() => onSelect(card.id), [onSelect, card.id]);
  const cardStyle = useMemo(() => [styles.card, selected && styles.selected], [selected]);
  return (
    <Pressable style={cardStyle} onPress={select}>
      <WorkCardPreview card={card} count={count} />
    </Pressable>
  );
}
function WorkCardList({
  groups,
  selected,
  counts,
  onSelect,
}: {
  groups: Map<string, WorkCard[]>;
  selected: string | null;
  counts?: Record<string, number>;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      {[...groups].map(([goal, records]) => (
        <View key={goal} style={styles.stack}>
          <Text style={styles.heading}>{goal}</Text>
          {records.map((card) => (
            <WorkCardTile
              key={card.id}
              card={card}
              selected={selected === card.id}
              count={counts?.[card.id] ?? 0}
              onSelect={onSelect}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
function RelatedCardLink({
  id,
  title,
  onSelect,
}: {
  id: string;
  title: string;
  onSelect: (id: string) => void;
}) {
  const select = useCallback(() => onSelect(id), [id, onSelect]);
  return (
    <Button variant="ghost" size="xs" onPress={select}>
      {title}
    </Button>
  );
}
interface BoardToolbarProps {
  search: string;
  onSearch: (value: string) => void;
  mode: "canvas" | "list";
  changeMode: (mode: "canvas" | "list") => void;
  includeArchived: boolean;
  toggleArchived: () => void;
  connected: boolean;
  refresh: () => void;
  arranging: boolean;
  arrange: () => void;
  hasUndo: boolean;
  restoreLayout: () => void;
}
function BoardToolbar(props: BoardToolbarProps) {
  const canvas = useCallback(() => props.changeMode("canvas"), [props]);
  const list = useCallback(() => props.changeMode("list"), [props]);
  return (
    <View style={styles.toolbar}>
      <EditingTextInput
        style={styles.search}
        initialValue={props.search}
        onChangeText={props.onSearch}
        placeholder="Find work…"
        accessibilityLabel="Find work"
      />
      <Button size="xs" variant="ghost" leftIcon={Grid2X2} onPress={canvas}>
        Canvas
      </Button>
      <Button size="xs" variant="ghost" leftIcon={List} onPress={list}>
        List
      </Button>
      <Button size="xs" variant="ghost" onPress={props.toggleArchived}>
        {props.includeArchived ? "Hide archived" : "Include archived"}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        leftIcon={RefreshCw}
        disabled={!props.connected}
        onPress={props.refresh}
      >
        Refresh
      </Button>
      {props.mode === "canvas" ? (
        <Button
          size="xs"
          variant="ghost"
          leftIcon={GitBranch}
          disabled={!props.connected || props.arranging}
          onPress={props.arrange}
        >
          Arrange
        </Button>
      ) : null}
      {props.mode === "canvas" && props.hasUndo ? (
        <Button
          size="xs"
          variant="ghost"
          leftIcon={Undo2}
          disabled={!props.connected || props.arranging}
          onPress={props.restoreLayout}
        >
          Undo
        </Button>
      ) : null}
    </View>
  );
}
function BoardStatus({
  connected,
  error,
  pending,
  empty,
  hasCards,
}: {
  connected: boolean;
  error: unknown;
  pending: boolean;
  empty: boolean;
  hasCards: boolean;
}) {
  return (
    <>
      {!connected ? (
        <Text style={styles.meta}>Host disconnected · showing cached records</Text>
      ) : null}
      {error ? <Text style={styles.error}>{errorMessage(error)}</Text> : null}
      {pending ? <Text style={styles.meta}>Loading work…</Text> : null}
      {!pending && empty ? (
        <Text style={styles.meta}>{hasCards ? "No matching work" : "No work recorded yet"}</Text>
      ) : null}
    </>
  );
}
function latestCardTouches(cards: WorkCard[]) {
  const latest = new Map<string, { cardId: string; at: string }>();
  for (const card of cards)
    for (const touch of card.touches) {
      if ((latest.get(touch.agentId)?.at ?? "") < touch.lastTouchedAt)
        latest.set(touch.agentId, { cardId: card.id, at: touch.lastTouchedAt });
    }
  return latest;
}
