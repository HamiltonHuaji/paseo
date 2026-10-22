import { useCallback } from "react";
import { Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import type { WorkCard, WorkMetrics } from "@getpaseo/protocol/work-objects";
import { useFetchQuery } from "@/data/query";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useWorks } from "./context";
import { cardView, Progress, relativeTime } from "./components";
import { Metrics, metricTitle } from "./metrics";
import { workStyles as styles } from "./styles";

const DisplaySchema = z.record(z.string(), z.array(z.string()));
const EMPTY_DISPLAY: z.infer<typeof DisplaySchema> = {};
const EMPTY_PANELS: string[] = [];

export function useCanvasDisplay() {
  const { serverId, projectId } = useWorks();
  const cache = useQueryClient();
  const key = ["works-canvas-display", serverId, projectId];
  const storageKey = JSON.stringify(key);
  const query = useFetchQuery({
    queryKey: key,
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(storageKey);
      return stored ? DisplaySchema.parse(JSON.parse(stored)) : EMPTY_DISPLAY;
    },
    dataShape: "value",
    staleTimeMs: 60_000,
  });
  const save = useMutation({
    mutationFn: async ({ cardId, panels }: { cardId: string; panels: string[] }) => {
      const current = cache.getQueryData<z.infer<typeof DisplaySchema>>(key) ?? EMPTY_DISPLAY;
      const next = { ...current, [cardId]: panels };
      await AsyncStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    },
    onSuccess: (value) => cache.setQueryData(key, value),
  });
  return {
    panels: query.data ?? EMPTY_DISPLAY,
    loading: query.isPending,
    save,
    error: query.error ?? save.error,
  };
}

export function selectedMetrics(card: WorkCard, panelIds: string[] = EMPTY_PANELS): WorkMetrics {
  return { panels: card.metrics?.panels.filter((panel) => panelIds.includes(panel.id)) ?? [] };
}

export function cardHeight(card: WorkCard, panelIds?: string[]): number {
  // Only explicitly chosen panels affect canvas geometry. Viewer/session counts never do.
  return 11 + (card.progress ? 2 : 0) + selectedMetrics(card, panelIds).panels.length * 14;
}

interface PreviewProps {
  card: WorkCard;
  count: number;
  canvas?: {
    panels: string[];
    disabled: boolean;
    onChange: (cardId: string, panels: string[]) => void;
    onResetSize: (cardId: string) => void;
  };
}

export function WorkCardPreview({ card, count, canvas }: PreviewProps) {
  const metrics = selectedMetrics(card, canvas?.panels);
  const viewers = Object.keys(card.viewers?.entries ?? {}).length;
  const sessions = card.sessions?.agentIds.length ?? 0;
  return (
    <View style={styles.summary}>
      {!canvas ? (
        <Text style={styles.title} numberOfLines={2}>
          {card.title}
        </Text>
      ) : null}
      <View style={styles.previewFooter}>
        <Text style={[styles.meta, styles.grow]} numberOfLines={1}>
          {card.label} · {count} {card.label === "experiment" ? "runs" : "work items"}
          {card.archivedAt ? " · archived" : ""}
        </Text>
        {canvas ? <CanvasDisplayMenu card={card} canvas={canvas} /> : null}
      </View>
      <Text style={styles.text} numberOfLines={2}>
        {card.body}
      </Text>
      {metrics.panels.length ? <Metrics value={metrics} preview /> : null}
      {card.progress ? <Progress object={cardView(card)} compact /> : null}
      {card.result ? (
        <Text style={styles.meta}>{card.result.completed ? "Completed" : "In progress"}</Text>
      ) : null}
      {viewers || sessions ? (
        <Text style={styles.meta} numberOfLines={1}>
          {[viewers ? `${viewers} viewers` : "", sessions ? `${sessions} sessions` : ""]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
      <Text style={styles.meta} numberOfLines={1}>
        Active {relativeTime(card.updatedAt)}
      </Text>
    </View>
  );
}

function CanvasDisplayMenu({
  card,
  canvas,
}: {
  card: WorkCard;
  canvas: NonNullable<PreviewProps["canvas"]>;
}) {
  const hideAll = useCallback(() => canvas.onChange(card.id, []), [canvas, card.id]);
  const resetSize = useCallback(() => canvas.onResetSize(card.id), [canvas, card.id]);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityRole="button"
        style={styles.displayTrigger}
        accessibilityLabel={`Canvas display for ${card.title}`}
        disabled={canvas.disabled}
      >
        <Text style={styles.meta}>Display</Text>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Metrics on this card</DropdownMenuLabel>
        {card.metrics?.panels.map((panel) => (
          <CanvasPanelOption key={panel.id} cardId={card.id} panel={panel} canvas={canvas} />
        ))}
        <DropdownMenuItem
          onSelect={hideAll}
          disabled={canvas.disabled || canvas.panels.length === 0}
        >
          Hide all metrics
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={resetSize}>Reset card size</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CanvasPanelOption({
  cardId,
  panel,
  canvas,
}: {
  cardId: string;
  panel: WorkMetrics["panels"][number];
  canvas: NonNullable<PreviewProps["canvas"]>;
}) {
  const selected = canvas.panels.includes(panel.id);
  const toggle = useCallback(() => {
    const next = selected
      ? canvas.panels.filter((id) => id !== panel.id)
      : [...canvas.panels, panel.id];
    canvas.onChange(cardId, next);
  }, [canvas, cardId, panel.id, selected]);
  return (
    <DropdownMenuItem
      selected={selected}
      closeOnSelect={false}
      disabled={canvas.disabled}
      onSelect={toggle}
    >
      {metricTitle(panel)}
    </DropdownMenuItem>
  );
}
