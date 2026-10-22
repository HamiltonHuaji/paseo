import { PressHighlight } from "@/components/ui/press-highlight";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, ScrollView, Text, View } from "react-native";
import { EditingTextInput } from "@/components/ui/text-input";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useIsFocused } from "@react-navigation/native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Grid2X2, List, RefreshCw, Undo2, GitBranch } from "lucide-react-native";
import type { WorkCard, WorkPlacement } from "@getpaseo/protocol/work-objects";
import { useHostFeature } from "@/runtime/host-features";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFetchQuery } from "@/data/query";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
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
import { useWorkNavigation } from "@/stores/work-navigation-store";
import { WorkCardPreview, cardHeight, useCanvasDisplay } from "./works/preview";
import { CardDetail } from "./works/detail";
import { workStyles as styles } from "./works/styles";

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
  const display = useCanvasDisplay();
  const [, refreshAge] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => refreshAge((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, [active]);
  const cache = useQueryClient();
  const {
    selected,
    select: setSelected,
    expanded: expandedItems,
    expand: setItemExpanded,
    search,
    setSearch,
    includeArchived,
    setIncludeArchived,
  } = useWorkNavigation(serverId, projectId, "works");
  const [mode, setMode] = useState<"canvas" | "list">("canvas");
  const viewStorageKey = JSON.stringify([VIEW_KEY, serverId, projectId]);
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
        cards.map((card) => [
          card.id,
          { width: 15, height: cardHeight(card, display.panels[card.id]) } satisfies BoardSize,
        ]),
      ),
    [cards, display.panels],
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
    void AsyncStorage.getItem(viewStorageKey)
      .then((value) => {
        if (value === "list" || value === "canvas") setMode(value);
        return undefined;
      })
      .catch((error) => setSubscriptionError(errorMessage(error)));
  }, [viewStorageKey]);
  const changeMode = useCallback(
    (value: "canvas" | "list") => {
      setMode(value);
      void AsyncStorage.setItem(viewStorageKey, value).catch((error) =>
        setSubscriptionError(errorMessage(error)),
      );
    },
    [viewStorageKey],
  );
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
    if (!active || !selected) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setSelected(null);
      return true;
    });
    return () => subscription.remove();
  }, [active, selected, setSelected]);
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
  const closeDetail = useCallback(() => setSelected(null), [setSelected]);
  const persistPlacement = useCallback(
    (value: BoardPlacement) => saveLayout.mutate([fromBoard(value)]),
    [saveLayout],
  );
  const toggleArchived = useCallback(
    () => setIncludeArchived(!includeArchived),
    [includeArchived, setIncludeArchived],
  );
  const resetCardSize = useCallback(
    (cardId: string, dimensions: "height" | "both" = "both") => {
      const previous = stored.find((placement) => placement.cardId === cardId);
      saveLayout.mutate(
        [
          {
            cardId,
            column: previous?.column ?? null,
            row: previous?.row ?? null,
            width: dimensions === "height" ? (previous?.width ?? null) : null,
            height: null,
          },
        ],
        {
          onSuccess: () => setLayoutVersion((version) => version + 1),
        },
      );
    },
    [stored, saveLayout],
  );
  const changePanels = useCallback(
    (cardId: string, panels: string[]) => {
      display.save.mutate({ cardId, panels }, { onSuccess: () => resetCardSize(cardId, "height") });
    },
    [display.save, resetCardSize],
  );
  const canvasDisplays = useMemo(
    () =>
      Object.fromEntries(
        cards.map((card) => [
          card.id,
          {
            panels: display.panels[card.id] ?? [],
            disabled:
              !connected || display.loading || display.save.isPending || saveLayout.isPending,
            onChange: changePanels,
            onResetSize: resetCardSize,
          },
        ]),
      ),
    [
      cards,
      display.panels,
      display.loading,
      display.save.isPending,
      saveLayout.isPending,
      connected,
      changePanels,
      resetCardSize,
    ],
  );
  const renderCard = useCallback(
    (id: string) => (
      <WorkCardPreview
        card={cards.find((card) => card.id === id)!}
        count={board.data?.itemCounts[id] ?? 0}
        canvas={canvasDisplays[id]}
      />
    ),
    [cards, board.data?.itemCounts, canvasDisplays],
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
            error={board.error ?? subscriptionError ?? saveLayout.error ?? display.error}
            pending={board.isPending}
            empty={filtered.length === 0}
            hasCards={cards.length > 0}
          />
          <View style={styles.split}>
            {!compact || !selected ? (
              <View style={styles.pane}>
                {mode === "canvas" ? (
                  <BoardCanvas
                    layoutRevision={layoutVersion}
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
                  expandedItems={expandedItems}
                  onItemExpandedChange={setItemExpanded}
                />
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </WorkActivityContext.Provider>
  );
}

function toBoard({ cardId, ...placement }: WorkPlacement): BoardPlacement {
  return { id: cardId, ...placement };
}
function fromBoard({ id, ...placement }: BoardPlacement): WorkPlacement {
  return { cardId: id, ...placement };
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
    <PressHighlight style={cardStyle} onPress={select}>
      <WorkCardPreview card={card} count={count} />
    </PressHighlight>
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
  const viewOptions = useMemo(
    () => [
      { value: "canvas" as const, label: "Canvas", icon: Grid2X2 },
      { value: "list" as const, label: "List", icon: List },
    ],
    [],
  );
  return (
    <View style={styles.toolbar}>
      <EditingTextInput
        style={styles.search}
        initialValue={props.search}
        onChangeText={props.onSearch}
        placeholder="Find work…"
        accessibilityLabel="Find work"
      />
      <SegmentedControl
        options={viewOptions}
        value={props.mode}
        onValueChange={props.changeMode}
        size="xs"
      />
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
