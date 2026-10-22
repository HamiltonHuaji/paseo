import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { PressHighlight } from "@/components/ui/press-highlight";
import { DraggableList } from "@/components/draggable-list";
import type { DraggableRenderItemInfo } from "@/components/draggable-list.types";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import {
  buildWorkspaceTabTree,
  projectWorkspaceTabTree,
  getWorkspaceTabTreeAncestorGroupIds,
  type WorkspaceTabTreeRow,
  type WorkspaceTabTreeItem,
} from "./workspace-tab-tree";

function rowKey(row: WorkspaceTabTreeRow) {
  return row.kind === "group" ? row.group.id : row.leaf.tabId;
}

export function WorkspaceTabTreeList({
  items,
  selectedTabId,
  renderTab,
  onReorder,
  onClose,
}: {
  items: WorkspaceTabTreeItem[];
  selectedTabId?: string;
  renderTab: (
    tabId: string,
    label: string,
    info: DraggableRenderItemInfo<WorkspaceTabTreeRow>,
  ) => ReactElement;
  onReorder: (tabIds: string[]) => void;
  onClose: (tabId: string) => void | Promise<void>;
}) {
  const model = useMemo(() => buildWorkspaceTabTree(items), [items]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    if (!selectedTabId) return;
    const ancestors = getWorkspaceTabTreeAncestorGroupIds(model, selectedTabId);
    setCollapsed((current) =>
      current.size && ancestors.some((id) => current.has(id))
        ? new Set([...current].filter((id) => !ancestors.includes(id)))
        : current,
    );
  }, [model, selectedTabId]);
  const rows = useMemo(() => projectWorkspaceTabTree(model, collapsed), [model, collapsed]);
  useEffect(() => {
    const index = rows.findIndex((row) => row.kind === "leaf" && row.leaf.tabId === selectedTabId);
    if (index >= 0) scroll.current?.scrollTo({ y: Math.max(0, index * 32 - 64), animated: false });
  }, [rows, selectedTabId]);
  const move = useCallback(
    (next: WorkspaceTabTreeRow[]) => {
      const ids = next.flatMap(rowTabIds);
      onReorder([...new Set([...ids, ...items.map((item) => item.tabId)])]);
    },
    [items, onReorder],
  );
  const renderRow = useCallback(
    (info: DraggableRenderItemInfo<WorkspaceTabTreeRow>) => {
      const row = info.item;
      if (row.kind === "leaf")
        return (
          <View style={styles.row(row.depth)}>
            {renderTab(row.leaf.tabId, row.leaf.displaySuffix, info)}
          </View>
        );
      return (
        <TabGroupRow
          row={row}
          info={info}
          items={items}
          onReorder={onReorder}
          onClose={onClose}
          setCollapsed={setCollapsed}
        />
      );
    },
    [items, onClose, onReorder, renderTab],
  );
  return (
    <ScrollView ref={scroll} style={styles.list} testID="workspace-vertical-tabs">
      <DraggableList
        data={rows}
        keyExtractor={rowKey}
        renderItem={renderRow}
        onDragEnd={move}
        useDragHandle
        scrollEnabled={false}
      />
    </ScrollView>
  );
}
function rowTabIds(row: WorkspaceTabTreeRow): string[] {
  if (row.kind === "leaf") return [row.leaf.tabId];
  return row.collapsed ? [...row.group.descendantTabIds] : [];
}
function TabGroupRow({
  row,
  info,
  items,
  onReorder,
  onClose,
  setCollapsed,
}: {
  row: Extract<WorkspaceTabTreeRow, { kind: "group" }>;
  info: DraggableRenderItemInfo<WorkspaceTabTreeRow>;
  items: WorkspaceTabTreeItem[];
  onReorder: (ids: string[]) => void;
  onClose: (id: string) => void | Promise<void>;
  setCollapsed: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
}) {
  const ids = row.group.descendantTabIds;
  const moveGroup = useCallback(
    (end: boolean) => {
      const rest = items.map((item) => item.tabId).filter((id) => !ids.includes(id));
      onReorder(end ? [...rest, ...ids] : [...ids, ...rest]);
    },
    [ids, items, onReorder],
  );
  const moveStart = useCallback(() => moveGroup(false), [moveGroup]);
  const moveEnd = useCallback(() => moveGroup(true), [moveGroup]);
  const close = useCallback(() => {
    for (const id of ids) void onClose(id);
  }, [ids, onClose]);
  const toggle = useCallback(
    () =>
      setCollapsed((current) => {
        const next = new Set(current);
        if (row.collapsed) row.group.groupIds.forEach((id) => next.delete(id));
        else next.add(row.group.id);
        return next;
      }),
    [row, setCollapsed],
  );
  const accessibilityState = useMemo(() => ({ expanded: !row.collapsed }), [row.collapsed]);
  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <PressHighlight
          style={styles.group(row.depth)}
          onPress={toggle}
          onLongPress={row.collapsed ? info.drag : undefined}
          accessibilityLabel={row.group.path}
          accessibilityState={accessibilityState}
        >
          <Text style={styles.groupText}>
            {row.collapsed ? "▸" : "▾"} {row.group.label}
          </Text>
          <Text style={styles.count}>{ids.length}</Text>
        </PressHighlight>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={moveStart}>Move group to start</ContextMenuItem>
        <ContextMenuItem onSelect={moveEnd}>Move group to end</ContextMenuItem>
        <ContextMenuItem onSelect={close}>Close group</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
const styles = StyleSheet.create((theme) => ({
  list: { maxHeight: 320, minHeight: 64 },
  row: (depth: number) => ({ height: 32, justifyContent: "center", paddingLeft: depth * 12 }),
  group: (depth: number) => ({
    height: 32,
    paddingLeft: depth * 12 + 6,
    paddingRight: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  }),
  groupText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, flex: 1 },
  count: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
