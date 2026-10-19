import { useState, useCallback, useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react-native";
import type { WorkCard, WorkSelect, WorkView } from "@getpaseo/protocol/work-objects";
import { useFetchQuery } from "@/data/query";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import {
  ObjectComponents,
  ObjectActivity,
  ArchiveButton,
  Progress,
  formatTime,
  relativeTime,
} from "./components";
import { useWorks, errorMessage } from "./context";
import { workStyles as styles } from "./styles";

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
interface ItemExpansionProps {
  expandedItems: Record<string, boolean>;
  onItemExpandedChange: (id: string, expanded: boolean) => void;
}
interface DetailProps extends ItemExpansionProps {
  cardId: string;
  cards: WorkCard[];
  onSelect: (id: string) => void;
  onClose: () => void;
}
export function CardDetail({
  cardId,
  cards,
  onSelect,
  onClose,
  expandedItems,
  onItemExpandedChange,
}: DetailProps) {
  const { client, projectId, serverId, active, connected } = useWorks();
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
  if (!query.data)
    return (
      <View style={styles.detailHeader}>
        <Button
          size="xs"
          variant="ghost"
          leftIcon={ArrowLeft}
          style={styles.link}
          onPress={onClose}
        >
          Back to board
        </Button>
        <Text style={query.error ? styles.error : styles.meta}>
          {query.error ? errorMessage(query.error) : "Loading details…"}
        </Text>
      </View>
    );
  return (
    <CardDetailContent
      card={query.data.object}
      items={query.data.items ?? []}
      cards={cards}
      onSelect={onSelect}
      onClose={onClose}
      error={query.error}
      expandedItems={expandedItems}
      onItemExpandedChange={onItemExpandedChange}
    />
  );
}

export function CardDetailContent({
  card,
  items,
  cards,
  onSelect,
  onClose,
  error,
  expandedItems,
  onItemExpandedChange,
}: Omit<DetailProps, "cardId"> & { card: WorkView; items: WorkView[]; error?: unknown }) {
  return (
    <ScrollView style={styles.pane}>
      <View style={styles.detailContent}>
        <View style={styles.between}>
          <Button size="xs" variant="ghost" leftIcon={ArrowLeft} onPress={onClose}>
            Back to board
          </Button>
          <ArchiveButton object={card} />
        </View>
        {error ? <Text style={styles.error}>{errorMessage(error)}</Text> : null}
        <Text style={styles.heading}>{card.title}</Text>
        <View style={styles.row}>
          <StatusBadge label={card.label} />
          {card.kind === "card" && card.goal ? <StatusBadge label={card.goal} /> : null}
          {card.archivedAt ? <StatusBadge label="Archived" /> : null}
        </View>
        <MarkdownRenderer text={card.body} />
        <Text style={styles.meta}>
          {card.updatedAt ? "Last activity " + relativeTime(card.updatedAt) : card.id}
        </Text>
        <RelatedCards card={card} cards={cards} onSelect={onSelect} />
        <CardComponents key={card.id} card={card} />
        <ItemList
          items={items}
          label={card.label}
          expandedItems={expandedItems}
          onItemExpandedChange={onItemExpandedChange}
        />
      </View>
    </ScrollView>
  );
}

function CardComponents({ card }: { card: WorkView }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  return (
    <View style={styles.section}>
      <Button
        variant="ghost"
        size="sm"
        leftIcon={expanded ? ChevronDown : ChevronRight}
        style={styles.link}
        onPress={toggle}
      >
        {card.label === "experiment" ? "Experiment details" : "Topic details"}
      </Button>
      {expanded ? (
        <View style={styles.cardSupplement}>
          <ObjectComponents object={card} />
          <ObjectActivity object={card} />
        </View>
      ) : null}
    </View>
  );
}

function ItemList({
  items,
  label,
  expandedItems,
  onItemExpandedChange,
}: { items: WorkView[]; label: string } & ItemExpansionProps) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const visible = items.filter((item) => includeArchived || !item.archivedAt);
  const completed = visible.filter((item) => item.result?.completed).length;
  const tracked = visible.filter((item) => item.result).length;
  const toggleArchived = useCallback(() => setIncludeArchived((value) => !value), []);
  const archiveToggle = useMemo(
    () => (
      <Button size="xs" variant="ghost" onPress={toggleArchived}>
        {includeArchived ? "Hide archived" : "Include archived"}
      </Button>
    ),
    [includeArchived, toggleArchived],
  );
  return (
    <SettingsSection
      title={`${label === "experiment" ? "Runs" : "Work items"} · ${visible.length}`}
      trailing={archiveToggle}
    >
      {tracked ? (
        <Text style={styles.meta}>
          {completed} of {tracked} completed
        </Text>
      ) : null}
      {!visible.length ? <Text style={styles.meta}>No records yet</Text> : null}
      <View style={settingsStyles.card}>
        {visible.map((item, index) => (
          <ItemRow
            key={item.id}
            object={item}
            index={index}
            expanded={expandedItems[item.id] ?? index === visible.length - 1}
            onExpandedChange={onItemExpandedChange}
          />
        ))}
      </View>
    </SettingsSection>
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
    <View
      style={[styles.item, index > 0 && settingsStyles.rowBorder]}
      testID={"work-item-" + object.id}
    >
      <View style={styles.between}>
        <Text style={[styles.meta, styles.grow]}>
          {object.label === "attempt" ? "Attempt" : "Issue"} {index + 1} ·{" "}
          {object.createdAt ? formatTime(object.createdAt) : object.id}
        </Text>
        <Button
          variant="ghost"
          size="xs"
          leftIcon={expanded ? ChevronDown : ChevronRight}
          accessibilityLabel={(expanded ? "Collapse " : "Expand ") + object.title}
          accessibilityState={accessibilityState}
          onPress={onToggle}
        >
          {expanded ? "Collapse" : "Expand"}
        </Button>
      </View>
      <View style={styles.stack}>
        <Text style={styles.title}>{object.title}</Text>
        {expanded ? (
          <MarkdownRenderer text={object.body} />
        ) : (
          <Text style={styles.meta} numberOfLines={2}>
            {object.body}
          </Text>
        )}
      </View>
      {!expanded && object.result ? (
        <View style={styles.row}>
          <StatusBadge
            label={object.result.completed ? "Completed" : "In progress"}
            variant={object.result.completed ? "success" : "muted"}
          />
        </View>
      ) : null}
      {!expanded && object.progress ? <Progress object={object} compact /> : null}
      {expanded ? (
        <>
          <ObjectComponents object={object} />
          <ObjectActivity object={object} />
          <View style={styles.row}>
            <ArchiveButton object={object} />
          </View>
        </>
      ) : null}
    </View>
  );
}

function RelatedCards({
  card,
  cards,
  onSelect,
}: {
  card: WorkView;
  cards: WorkCard[];
  onSelect: (id: string) => void;
}) {
  const basedOn = card.kind === "card" ? card.basedOn : null;
  const children = cards.filter((candidate) => candidate.basedOn === card.id);
  if (!basedOn && !children.length) return null;
  return (
    <SettingsSection title="Related work">
      {basedOn ? (
        <RelatedCardLink
          id={basedOn}
          title={`Based on: ${cards.find((candidate) => candidate.id === basedOn)?.title ?? basedOn}`}
          onSelect={onSelect}
        />
      ) : null}
      {children.map((child) => (
        <RelatedCardLink
          key={child.id}
          id={child.id}
          title={`Derived: ${child.title}`}
          onSelect={onSelect}
        />
      ))}
    </SettingsSection>
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
    <Button
      variant="ghost"
      size="sm"
      style={styles.link}
      textStyle={styles.linkText}
      onPress={select}
    >
      {title}
    </Button>
  );
}
