import { LoadingSpinner } from "@/components/ui/loading-spinner";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
} from "react-native";
import {
  CopyX,
  Folder,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  ArrowDownToLine,
  Copy,
  Pencil,
  RotateCw,
  Columns2,
  Rows2,
  Ellipsis,
  Maximize,
  Minimize,
  Plus,
  X,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import Animated from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { SortableInlineList } from "@/components/sortable-inline-list";
import type { DragOrientation } from "@/components/drag-orientation";
import type {
  DraggableListDragHandleProps,
  DraggableRenderItemInfo,
} from "@/components/draggable-list.types";
import { isNative, isWeb } from "@/constants/platform";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useWorkspaceTabHorizontalScroll } from "@/hooks/use-workspace-tab-horizontal-scroll";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT, useIsCompactFormFactor } from "@/constants/layout";
import { buttonControlHeight } from "@/components/ui/control-geometry";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { Shortcut } from "@/components/ui/shortcut";
import { useWorkspaceTabLayout } from "@/screens/workspace/use-workspace-tab-layout";
import { retainWorkspaceTabMeasuredWidth } from "@/screens/workspace/workspace-tab-layout";
import {
  WorkspaceTabPresentationResolver,
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";
import {
  buildWorkspaceDesktopTabActions,
  moveWorkspaceTabToEdge,
  type WorkspaceDesktopTabActions,
  type WorkspaceTabMenuEntry,
  type WorkspaceTabMenuLabels,
} from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { SurfaceBackdrop } from "@/styles/surface-backdrop";
import type { Theme } from "@/styles/theme";
import { RenderProfile } from "@/utils/render-profiler";
import { TrailingActionScrim } from "@/components/ui/trailing-action-scrim";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { buildWorkspaceKeyboardHandlerId } from "@/keyboard/handler-id";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import {
  WorkspaceNewTabMenuContent,
  WorkspaceVerticalTabLaunchActions,
} from "@/screens/workspace/workspace-new-tab-menu";
import {
  paneContentToolbarTrailingPadding,
  ToolbarButton,
  ToolbarControls,
} from "@/components/ui/pane-content-toolbar";
import { smallIconButtonChromeFrameSize } from "@/components/ui/icon-button-chrome";
import {
  HorizontalScrollBoundaryShades,
  useHorizontalScrollBoundary,
} from "@/components/ui/horizontal-scroll-boundary";
import { getWorkspaceTabRevealOffset } from "@/screens/workspace/workspace-tab-scroll";
import { WORKSPACE_TAB_RAIL_WIDTH } from "@/screens/workspace/workspace-tab-placement";
import {
  buildWorkspaceTabTree,
  getWorkspaceTabTreeAncestorGroupIds,
  projectWorkspaceTabTree,
  type WorkspaceTabTreeRow,
} from "@/screens/workspace/workspace-tab-tree";
import { TreeChevron, treeRowPaddingLeft } from "@/components/tree-primitives";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

const DROPDOWN_WIDTH = 220;
const DEFAULT_INLINE_ADD_BUTTON_RESERVED_WIDTH = 36;
const PANE_SPLIT_ACTIONS_HORIZONTAL_PADDING = 2;
const PANE_SPLIT_ACTIONS_OUTER_MARGIN =
  paneContentToolbarTrailingPadding(false) - PANE_SPLIT_ACTIONS_HORIZONTAL_PADDING;
const PANE_SPLIT_ACTIONS_RESERVED_WIDTH =
  smallIconButtonChromeFrameSize(false) +
  PANE_SPLIT_ACTIONS_HORIZONTAL_PADDING * 2 +
  PANE_SPLIT_ACTIONS_OUTER_MARGIN;
const PANE_MAXIMIZE_ACTION_RESERVED_WIDTH = smallIconButtonChromeFrameSize(false) + 1;
// Chip geometry. `layoutMetrics` measures tabs from these same numbers, so a chip that changes
// shape without changing them mis-measures and drops the row into the overflow-scroll fallback at
// the wrong width. Keep them together.
// Tabs and the adjacent New Tab trigger are one control family. Keep their outer box and corner
// token identical; only their horizontal sizing differs (content-width chip versus square icon).
const TAB_CHIP_HORIZONTAL_PADDING = 8;
const TAB_CHIP_GAP = 4;
const TAB_ROW_PADDING_HORIZONTAL = 4;
const TAB_ICON_WIDTH = 14;
const TAB_CONTENT_GAP = 4;
const TAB_DROP_INDICATOR_WIDTH = 4;
const TAB_MODIFIED_DOT_SIZE = 8;
const TAB_MIN_WIDTH = 96;
const TAB_MAX_WIDTH = 160;
const TAB_CLOSE_BUTTON_RESERVED_WIDTH = 0;
const TAB_LABEL_LAYOUT_ALLOWANCE = 4;

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedX = withUnistyles(X);
const ThemedCopy = withUnistyles(Copy);
const ThemedFolder = withUnistyles(Folder);

const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedArrowLeftToLine = withUnistyles(ArrowLeftToLine);
const ThemedArrowRightToLine = withUnistyles(ArrowRightToLine);
const ThemedArrowUpToLine = withUnistyles(ArrowUpToLine);
const ThemedArrowDownToLine = withUnistyles(ArrowDownToLine);
const ThemedCopyX = withUnistyles(CopyX);
const ThemedPencil = withUnistyles(Pencil);
const ThemedPlus = withUnistyles(Plus);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedRows2 = withUnistyles(Rows2);
const ThemedEllipsis = withUnistyles(Ellipsis);
const ThemedMaximize = withUnistyles(Maximize);
const ThemedMinimize = withUnistyles(Minimize);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const extraMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });

function updateMeasuredWidth(
  setWidth: React.Dispatch<React.SetStateAction<number>>,
  event: LayoutChangeEvent,
) {
  const nextWidth = Math.round(event.nativeEvent.layout.width);
  setWidth((current) => retainWorkspaceTabMeasuredWidth(current, nextWidth));
}

function TabLabelMeasurement({
  tabKey,
  label,
  onMeasure,
}: {
  tabKey: string;
  label: string;
  onMeasure: (tabKey: string, label: string, event: LayoutChangeEvent) => void;
}) {
  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => onMeasure(tabKey, label, event),
    [label, onMeasure, tabKey],
  );

  return (
    <Text
      style={[styles.tabLabel, styles.tabLabelMeasurement]}
      numberOfLines={1}
      onLayout={handleLayout}
    >
      {label}
    </Text>
  );
}

interface WorkspaceNewTabButtonProps {
  serverId: string;
  paneId?: string;
  shortcutKeys: ShortcutKey[][] | null;
  placement: "inline" | "toolbar";
}

function WorkspaceNewTabButton({
  serverId,
  paneId,
  shortcutKeys,
  placement,
}: WorkspaceNewTabButtonProps) {
  const { t } = useTranslation();
  const tooltipText = t("workspace.tabs.actions.newTab");
  const menu = (
    <DropdownMenu>
      <ToolbarButton
        kind="menu"
        label={tooltipText}
        shortcut={shortcutKeys}
        testID="workspace-new-tab-button"
        style={placement === "inline" ? styles.inlineNewTabButton : undefined}
      >
        <ThemedPlus size={14} uniProps={extraMutedColorMapping} />
      </ToolbarButton>
      <WorkspaceNewTabMenuContent
        serverId={serverId}
        purpose="primary"
        host="main"
        paneId={paneId}
      />
    </DropdownMenu>
  );

  return placement === "inline" ? <View style={styles.inlineAddButton}>{menu}</View> : menu;
}

function WorkspaceSplitPaneToolbarActions({
  expanded,
  onSplitRight,
  onSplitDown,
}: {
  expanded: boolean;
  onSplitRight: () => void;
  onSplitDown: () => void;
}) {
  const { t } = useTranslation();
  const splitRightKeys = useShortcutKeys("workspace-pane-split-right");
  const splitDownKeys = useShortcutKeys("workspace-pane-split-down");
  const splitRightLeading = useMemo(
    () => <ThemedColumns2 size={14} uniProps={extraMutedColorMapping} />,
    [],
  );
  const splitDownLeading = useMemo(
    () => <ThemedRows2 size={14} uniProps={extraMutedColorMapping} />,
    [],
  );
  const splitRightTrailing = useMemo(
    () => (splitRightKeys ? <Shortcut chord={splitRightKeys} /> : null),
    [splitRightKeys],
  );
  const splitDownTrailing = useMemo(
    () => (splitDownKeys ? <Shortcut chord={splitDownKeys} /> : null),
    [splitDownKeys],
  );

  if (expanded) {
    return (
      <>
        <ToolbarButton
          label={t("workspace.tabs.actions.splitRight")}
          shortcut={splitRightKeys}
          tooltipSide="top"
          testID="workspace-split-pane-right"
          onPress={onSplitRight}
        >
          {splitRightLeading}
        </ToolbarButton>
        <ToolbarButton
          label={t("workspace.tabs.actions.splitDown")}
          shortcut={splitDownKeys}
          tooltipSide="top"
          testID="workspace-split-pane-down"
          onPress={onSplitDown}
        >
          {splitDownLeading}
        </ToolbarButton>
      </>
    );
  }

  return (
    <DropdownMenu>
      <ToolbarButton
        kind="menu"
        label={t("workspace.git.actions.moreActions")}
        testID="workspace-split-pane-menu"
      >
        <ThemedEllipsis size={14} uniProps={extraMutedColorMapping} />
      </ToolbarButton>
      <DropdownMenuContent
        side="bottom"
        align="end"
        offset={4}
        width={220}
        testID="workspace-split-pane-menu-content"
      >
        <DropdownMenuItem
          leading={splitRightLeading}
          trailing={splitRightTrailing}
          testID="workspace-split-pane-right"
          onSelect={onSplitRight}
        >
          {t("workspace.tabs.actions.splitRight")}
        </DropdownMenuItem>
        <DropdownMenuItem
          leading={splitDownLeading}
          trailing={splitDownTrailing}
          testID="workspace-split-pane-down"
          onSelect={onSplitDown}
        >
          {t("workspace.tabs.actions.splitDown")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspacePaneToolbarActions({
  showNewTabButton,
  showSplitActions,
  showMaximizeAction,
  paneMaximized,
  serverId,
  paneId,
  newTabShortcutKeys,
  onSplitRight,
  onSplitDown,
  onTogglePaneMaximized,
  expandSplitActions = false,
}: {
  showNewTabButton: boolean;
  showSplitActions: boolean;
  showMaximizeAction: boolean;
  paneMaximized: boolean;
  serverId: string;
  paneId?: string;
  newTabShortcutKeys: ShortcutKey[][] | null;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  onTogglePaneMaximized?: () => void;
  expandSplitActions?: boolean;
}) {
  const { t } = useTranslation();
  const splitActionsVisible = showSplitActions && Boolean(onSplitRight && onSplitDown);
  const maximizeActionVisible = showMaximizeAction && Boolean(onTogglePaneMaximized);
  if (!showNewTabButton && !splitActionsVisible && !maximizeActionVisible) return null;

  return (
    <ToolbarControls style={styles.paneSplitActions}>
      {showNewTabButton ? (
        <WorkspaceNewTabButton
          placement="toolbar"
          serverId={serverId}
          paneId={paneId}
          shortcutKeys={newTabShortcutKeys}
        />
      ) : null}
      {maximizeActionVisible && onTogglePaneMaximized ? (
        <ToolbarButton
          label={t(
            paneMaximized
              ? "workspace.tabs.actions.restorePane"
              : "workspace.tabs.actions.maximizePane",
          )}
          selected={paneMaximized}
          testID={paneMaximized ? "workspace-restore-pane" : "workspace-maximize-pane"}
          onPress={onTogglePaneMaximized}
        >
          {paneMaximized ? (
            <ThemedMinimize size={14} uniProps={extraMutedColorMapping} />
          ) : (
            <ThemedMaximize size={14} uniProps={extraMutedColorMapping} />
          )}
        </ToolbarButton>
      ) : null}
      {splitActionsVisible && onSplitRight && onSplitDown ? (
        <WorkspaceSplitPaneToolbarActions
          expanded={expandSplitActions}
          onSplitRight={onSplitRight}
          onSplitDown={onSplitDown}
        />
      ) : null}
    </ToolbarControls>
  );
}

function WorkspaceExitFocusModeButton({
  visible,
  onPress,
  onLayout,
}: {
  visible: boolean;
  onPress: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
}) {
  const { t } = useTranslation();
  const focusModeKeys = useShortcutKeys("toggle-focus");
  if (!visible) {
    return null;
  }

  return (
    <View style={styles.exitFocusModeSlot} onLayout={onLayout}>
      <ToolbarButton
        label={t("workspace.tabs.actions.exitFocusMode")}
        shortcut={focusModeKeys}
        testID="workspace-exit-focus-mode"
        onPress={onPress}
      >
        <ThemedX size={14} uniProps={mutedColorMapping} />
      </ToolbarButton>
    </View>
  );
}

function TabContextMenuItem({
  entry,
}: {
  entry: Extract<WorkspaceTabMenuEntry, { kind: "item" }>;
}) {
  const leading = useMemo(() => {
    switch (entry.icon) {
      case "copy":
        return <ThemedCopy size={16} uniProps={mutedColorMapping} />;
      case "rotate-cw":
        return <ThemedRotateCw size={16} uniProps={mutedColorMapping} />;
      case "arrow-left-to-line":
        return <ThemedArrowLeftToLine size={16} uniProps={mutedColorMapping} />;
      case "arrow-right-to-line":
        return <ThemedArrowRightToLine size={16} uniProps={mutedColorMapping} />;
      case "arrow-up-to-line":
        return <ThemedArrowUpToLine size={16} uniProps={mutedColorMapping} />;
      case "arrow-down-to-line":
        return <ThemedArrowDownToLine size={16} uniProps={mutedColorMapping} />;
      case "copy-x":
        return <ThemedCopyX size={16} uniProps={mutedColorMapping} />;
      case "pencil":
        return <ThemedPencil size={16} uniProps={mutedColorMapping} />;
      case "x":
        return <ThemedX size={16} uniProps={mutedColorMapping} />;
      default:
        return undefined;
    }
  }, [entry.icon]);
  const trailing = useMemo(
    () => (entry.hint ? <Text style={styles.menuItemHint}>{entry.hint}</Text> : undefined),
    [entry.hint],
  );
  return (
    <ContextMenuItem
      testID={entry.testID}
      disabled={entry.disabled}
      destructive={entry.destructive}
      onSelect={entry.onSelect}
      tooltip={entry.tooltip}
      leading={leading}
      trailing={trailing}
    >
      {entry.label}
    </ContextMenuItem>
  );
}

function tabKeyExtractor(tab: WorkspaceDesktopTabRowItem) {
  return `${tab.tab.key}:${tab.tab.kind}`;
}

function resolveActiveSortableTabId(
  tabs: WorkspaceDesktopTabRowItem[],
  activeDragTabId: string | null,
): string | null {
  if (!activeDragTabId) return null;
  const activeItem = tabs.find((item) => item.tab.tabId === activeDragTabId);
  return activeItem ? tabKeyExtractor(activeItem) : null;
}

export interface WorkspaceDesktopTabRowItem {
  tab: WorkspaceTabDescriptor;
  isActive: boolean;
  isCloseHovered: boolean;
  isClosingTab: boolean;
}

interface ResolvedWorkspaceDesktopTabRowItem extends WorkspaceDesktopTabRowItem {
  presentation: WorkspaceTabPresentation;
}

interface WorkspaceTabLabel {
  key: string;
  label: string;
  modified: boolean;
}

interface WorkspaceTabLabelMeasurement {
  label: string;
  width: number;
}

interface WorkspaceTabTrackSnapshot {
  signature: string;
  tabs: ResolvedWorkspaceDesktopTabRowItem[];
  labels: WorkspaceTabLabel[];
  labelWidths: number[];
}

function workspaceTabLabelSignature(labels: WorkspaceTabLabel[]): string {
  return JSON.stringify(labels);
}

function completeWorkspaceTabLabelWidths(
  labels: WorkspaceTabLabel[],
  measurements: Map<string, WorkspaceTabLabelMeasurement>,
): number[] | null {
  const widths: number[] = [];
  for (const { key, label, modified } of labels) {
    const measurement = measurements.get(key);
    if (!measurement || measurement.label !== label || measurement.width <= 0) {
      return null;
    }
    // The modified dot sits in the content row, so a modified tab needs that much more width
    // before its label starts truncating.
    const modifiedAllowance = modified ? TAB_CONTENT_GAP + TAB_MODIFIED_DOT_SIZE : 0;
    widths.push(measurement.width + TAB_LABEL_LAYOUT_ALLOWANCE + modifiedAllowance);
  }
  return widths;
}

function sameWidths(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((width, index) => width === right[index]);
}

interface WorkspaceDesktopTabsRowProps {
  paneId?: string;
  isFocused?: boolean;
  tabs: WorkspaceDesktopTabRowItem[];
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  setHoveredCloseTabKey: Dispatch<SetStateAction<string | null>>;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onCreateNewTab: (input: { paneId?: string }) => void;
  onReorderTabs: (nextTabs: WorkspaceTabDescriptor[]) => void;
  externalDndContext?: boolean;
  activeDragTabId?: string | null;
  tabDropPreviewIndex?: number | null;
  showPaneSplitActions?: boolean;
  showPaneMaximizeAction?: boolean;
  paneMaximized?: boolean;
  onTogglePaneMaximized?: () => void;
  onSplitRight?: () => void;
  onSplitDown?: () => void;
  focusModeEnabled: boolean;
  onExitFocusMode: () => void;
}

interface ResolvedWorkspaceDesktopTabsRowProps extends Omit<WorkspaceDesktopTabsRowProps, "tabs"> {
  tabs: ResolvedWorkspaceDesktopTabRowItem[];
}

interface WorkspaceDesktopTabPresentationSlotProps {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  workspaceId: string;
  onResolve: (tabKey: string, presentation: WorkspaceTabPresentation) => void;
}

const EMPTY_RESOLVED_TAB_ROWS: ResolvedWorkspaceDesktopTabRowItem[] = [];

function WorkspaceDesktopTabPresentationSlot({
  tab,
  serverId,
  workspaceId,
  onResolve,
}: WorkspaceDesktopTabPresentationSlotProps) {
  return (
    <WorkspaceTabPresentationResolver tab={tab} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => (
        <WorkspaceDesktopTabPresentationCommit
          tabKey={tab.key}
          presentation={presentation}
          onResolve={onResolve}
        />
      )}
    </WorkspaceTabPresentationResolver>
  );
}

function WorkspaceDesktopTabPresentationCommit({
  tabKey,
  presentation,
  onResolve,
}: {
  tabKey: string;
  presentation: WorkspaceTabPresentation;
  onResolve: (tabKey: string, presentation: WorkspaceTabPresentation) => void;
}) {
  useLayoutEffect(() => {
    onResolve(tabKey, presentation);
  }, [onResolve, presentation, tabKey]);
  return null;
}

function getFallbackTabLabel(
  tab: WorkspaceTabDescriptor,
  labels: {
    newTab: string;
    newAgent: string;
    setup: string;
    terminal: string;
    agent: string;
    changes: string;
    files: string;
    pullRequest: string;
    experiments: string;
  },
): string {
  if (tab.target.kind === "new_tab") {
    return labels.newTab;
  }
  if (tab.target.kind === "draft") {
    return labels.newAgent;
  }
  if (tab.target.kind === "setup") {
    return labels.setup;
  }
  if (tab.target.kind === "terminal") {
    return labels.terminal;
  }
  if (tab.target.kind === "file") {
    return tab.target.path.split("/").findLast(Boolean) ?? tab.target.path;
  }
  if (tab.target.kind === "working_diff" || tab.target.kind === "changes_tree") {
    return labels.changes;
  }
  if (tab.target.kind === "files") {
    return labels.files;
  }
  if (tab.target.kind === "pull_request") {
    return labels.pullRequest;
  }
  if (tab.target.kind === "experiments") {
    return labels.experiments;
  }
  return labels.agent;
}

function useMiddleClickClose(onClose: () => void) {
  const ref = useRef<View>(null);

  useEffect(() => {
    if (isNative) return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;

    function handleAuxClick(event: MouseEvent) {
      if (event.button === 1) {
        event.preventDefault();
        onClose();
      }
    }

    node.addEventListener("auxclick", handleAuxClick);
    return () => node.removeEventListener("auxclick", handleAuxClick);
  }, [onClose]);

  return ref;
}

/** The chip fill the running-status ring has to knock out of. Mirrors `styles.tab*` exactly. */
function resolveChipBackdrop({
  isActiveFocused,
  isFilled,
}: {
  isActiveFocused: boolean;
  isFilled: boolean;
}): SurfaceBackdrop {
  if (isActiveFocused) return "surface2";
  return isFilled ? "surface1" : "surface0";
}

function resolveTreeTabIndentStyle(orientation: DragOrientation, treeDepth: number) {
  return orientation === "vertical"
    ? inlineUnistylesStyle({ paddingLeft: treeRowPaddingLeft(treeDepth) })
    : undefined;
}

function getWorkspaceTabTestIdentity(tab: WorkspaceTabDescriptor): string {
  return tab.target.kind === "new_tab" ? tab.tabId : buildDeterministicWorkspaceTabId(tab.target);
}

function TabHandleContent({
  presentation,
  displayLabel,
  isHighlighted,
  showLabel,
  backdrop,
  tabLabelSkeletonStyle,
  tabLabelStyle,
  modifiedTestId,
}: {
  presentation: WorkspaceTabPresentation;
  displayLabel?: string;
  isHighlighted: boolean;
  showLabel: boolean;
  backdrop: SurfaceBackdrop;
  tabLabelSkeletonStyle: React.ComponentProps<typeof View>["style"];
  tabLabelStyle: React.ComponentProps<typeof Text>["style"];
  modifiedTestId: string;
}) {
  const { t } = useTranslation();
  const tabHandleDataSet = useMemo(
    () => ({ statusBucket: presentation.statusBucket ?? "none" }),
    [presentation.statusBucket],
  );

  return (
    <View style={styles.tabHandle} dataSet={tabHandleDataSet}>
      <View style={styles.tabIcon}>
        <WorkspaceTabIcon presentation={presentation} active={isHighlighted} backdrop={backdrop} />
      </View>
      {showLabel && presentation.titleState === "loading" ? (
        <View style={tabLabelSkeletonStyle} />
      ) : null}
      {showLabel && presentation.titleState !== "loading" ? (
        <Text style={tabLabelStyle} selectable={false} numberOfLines={1} ellipsizeMode="tail">
          {displayLabel ?? presentation.label}
        </Text>
      ) : null}
      {/* The dot is a laid-out sibling of the label, not an overlay, so a truncated label ends
          before it instead of running underneath it. */}
      {presentation.modified ? (
        <View
          style={styles.tabModifiedDot}
          accessibilityLabel={t("workspace.tabs.modified")}
          testID={modifiedTestId}
        />
      ) : null}
    </View>
  );
}

function TabChip({
  tab,
  isActive,
  isDragging,
  isFocused,
  resolvedTabWidth,
  showLabel,
  showCloseButton,
  isCloseHovered,
  isClosingTab,
  presentation,
  displayLabel,
  treeDepth = 0,
  tooltipLabel,
  resolvedTab,
  setHoveredCloseTabKey,
  onNavigateTab,
  onCloseTab,
  dragHandleProps,
  orientation = "horizontal",
}: {
  tab: WorkspaceTabDescriptor;
  isActive: boolean;
  isDragging: boolean;
  isFocused: boolean;
  resolvedTabWidth: number;
  showLabel: boolean;
  showCloseButton: boolean;
  isCloseHovered: boolean;
  isClosingTab: boolean;
  presentation: WorkspaceTabPresentation;
  displayLabel?: string;
  treeDepth?: number;
  tooltipLabel: string;
  resolvedTab: WorkspaceDesktopTabActions;
  setHoveredCloseTabKey: Dispatch<SetStateAction<string | null>>;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  dragHandleProps: DraggableListDragHandleProps | undefined;
  orientation?: DragOrientation;
}) {
  const { closeButtonTestId, contextMenuTestId, menuEntries } = resolvedTab;
  const middleClickRef = useMiddleClickClose(
    useCallback(() => void onCloseTab(tab.tabId), [onCloseTab, tab.tabId]),
  );
  const isCompact = useIsCompactFormFactor();
  const [hovered, setHovered] = useState(false);
  // An active tab in a pane that does not have focus stays legible but quiet: it keeps the fill of
  // a hovered chip and the muted label, so only one chip in the window reads as the live one.
  const isActiveFocused = isActive && isFocused;
  const isHovered = hovered || isCloseHovered;
  const isHighlighted = isActiveFocused || isHovered;
  const chipBackdrop: SurfaceBackdrop = resolveChipBackdrop({
    isActiveFocused,
    isFilled: isActive || isHovered,
  });
  const showCloseControl = showCloseButton && (isHovered || isNative || isCompact || isClosingTab);
  const closeButtonDragBlockers = isWeb
    ? ({
        onPointerDown: (event: { stopPropagation?: () => void }) => {
          event.stopPropagation?.();
        },
        onMouseDown: (event: { stopPropagation?: () => void }) => {
          event.stopPropagation?.();
        },
      } as const)
    : undefined;

  const tabChipStyle = useCallback(
    () => [
      styles.tab,
      orientation === "vertical" && styles.railTab,
      resolveTreeTabIndentStyle(orientation, treeDepth),
      isActiveFocused && styles.tabActive,
      isActive && !isFocused && styles.tabActiveUnfocused,
      !isActive && isHovered && styles.tabHovered,
      isWeb && isDragging && ({ cursor: "grabbing" } as object),
      {
        minWidth: resolvedTabWidth,
        width: resolvedTabWidth,
        maxWidth: resolvedTabWidth,
      },
    ],
    [
      isActive,
      isActiveFocused,
      isDragging,
      isFocused,
      isHovered,
      orientation,
      resolvedTabWidth,
      treeDepth,
    ],
  );

  const handleTabPointerEnter = useCallback(() => {
    setHovered(true);
  }, []);

  const handleTabPointerLeave = useCallback(() => {
    setHovered(false);
  }, []);

  const handleNavigateTab = useCallback(() => {
    onNavigateTab(tab.tabId);
  }, [onNavigateTab, tab.tabId]);

  const handleCloseButtonPressIn = useCallback((event: { stopPropagation?: () => void }) => {
    event.stopPropagation?.();
  }, []);

  const handleCloseButtonHoverIn = useCallback(() => {
    setHoveredCloseTabKey(tab.key);
  }, [setHoveredCloseTabKey, tab.key]);

  const handleCloseButtonHoverOut = useCallback(() => {
    setHoveredCloseTabKey((current) => (current === tab.key ? null : current));
  }, [setHoveredCloseTabKey, tab.key]);

  const handleCloseButtonPress = useCallback(
    (event: { stopPropagation?: () => void }) => {
      event.stopPropagation?.();
      void onCloseTab(tab.tabId);
    },
    [onCloseTab, tab.tabId],
  );

  const tabAccessibilityState = useMemo(() => ({ selected: isActive }), [isActive]);
  const testIdentity = getWorkspaceTabTestIdentity(tab);
  const tabLabelSkeletonStyle = styles.tabLabelSkeleton;
  const tabLabelStyle = useMemo(
    () => [styles.tabLabel, isHighlighted && styles.tabLabelActive],
    [isHighlighted],
  );

  return (
    <View
      ref={middleClickRef}
      style={styles.tabHoverFrame}
      onPointerEnter={handleTabPointerEnter}
      onPointerLeave={handleTabPointerLeave}
    >
      <ContextMenu key={tab.key}>
        <Tooltip delayDuration={400} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="triggerRef">
            <ContextMenuTrigger
              {...(dragHandleProps?.attributes as object | undefined)}
              {...(dragHandleProps?.listeners as object | undefined)}
              testID={`workspace-tab-${testIdentity}`}
              triggerRef={dragHandleProps?.setActivatorNodeRef as unknown as undefined}
              enabledOnMobile={false}
              style={tabChipStyle}
              onPressIn={handleNavigateTab}
              onPress={handleNavigateTab}
              accessibilityRole="button"
              accessibilityLabel={tooltipLabel}
              accessibilityState={tabAccessibilityState}
              aria-selected={isActive}
            >
              <TabHandleContent
                presentation={presentation}
                displayLabel={displayLabel}
                isHighlighted={isHighlighted}
                showLabel={showLabel}
                backdrop={chipBackdrop}
                tabLabelSkeletonStyle={tabLabelSkeletonStyle}
                tabLabelStyle={tabLabelStyle}
                modifiedTestId={`workspace-tab-modified-${testIdentity}`}
              />
            </ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent
            side={orientation === "vertical" ? "right" : "bottom"}
            align="center"
            offset={8}
            maxWidth={720}
            testID={`workspace-tab-tooltip-${testIdentity}`}
          >
            {tab.target.kind === "agent" ? (
              <View style={styles.tooltipAgentRow}>
                <Text style={styles.newTabTooltipText}>{tooltipLabel}</Text>
                <Text style={styles.tooltipAgentId}>{tab.target.agentId.slice(0, 7)}</Text>
              </View>
            ) : (
              <Text style={styles.newTabTooltipText}>{tooltipLabel}</Text>
            )}
          </TooltipContent>
        </Tooltip>

        {showCloseButton ? (
          <View
            pointerEvents={showCloseControl ? "box-none" : "none"}
            style={[
              styles.tabTrailingOverlay,
              showCloseControl ? styles.tabTrailingOverlayShown : styles.tabTrailingOverlayHidden,
            ]}
          >
            <TrailingActionScrim backdrop={chipBackdrop} />
            <Pressable
              {...(closeButtonDragBlockers as object | undefined)}
              testID={closeButtonTestId}
              disabled={isClosingTab}
              onPressIn={handleCloseButtonPressIn}
              onHoverIn={handleCloseButtonHoverIn}
              onHoverOut={handleCloseButtonHoverOut}
              onPress={handleCloseButtonPress}
              style={styles.tabCloseButton}
            >
              {({ hovered: closeHovered, pressed }) => {
                const highlighted = closeHovered || pressed;
                if (isClosingTab) {
                  return (
                    <ThemedLoadingSpinner
                      size={12}
                      uniProps={highlighted ? foregroundColorMapping : mutedColorMapping}
                    />
                  );
                }
                return (
                  <ThemedX
                    size={12}
                    uniProps={highlighted ? foregroundColorMapping : mutedColorMapping}
                  />
                );
              }}
            </Pressable>
          </View>
        ) : null}

        <ContextMenuContent align="start" width={DROPDOWN_WIDTH} testID={contextMenuTestId}>
          {menuEntries.map((entry) =>
            entry.kind === "separator" ? (
              <ContextMenuSeparator key={entry.key} />
            ) : (
              <TabContextMenuItem key={entry.key} entry={entry} />
            ),
          )}
        </ContextMenuContent>
      </ContextMenu>
    </View>
  );
}

function WorkspaceDesktopTabs({
  orientation,
  ...props
}: WorkspaceDesktopTabsRowProps & { orientation: DragOrientation }) {
  const [presentations, setPresentations] = useState(
    () => new Map<string, WorkspaceTabPresentation>(),
  );
  const handlePresentation = useCallback(
    (tabKey: string, presentation: WorkspaceTabPresentation) => {
      setPresentations((current) => {
        if (current.get(tabKey) === presentation) {
          return current;
        }
        const next = new Map(current);
        next.set(tabKey, presentation);
        return next;
      });
    },
    [],
  );
  const currentTabKeys = useMemo(
    () => new Set(props.tabs.map((item) => item.tab.key)),
    [props.tabs],
  );
  useEffect(() => {
    setPresentations((current) => {
      const removedKeys = [...current.keys()].filter((key) => !currentTabKeys.has(key));
      if (removedKeys.length === 0) {
        return current;
      }
      const next = new Map(current);
      for (const key of removedKeys) {
        next.delete(key);
      }
      return next;
    });
  }, [currentTabKeys]);
  const resolvedTabs = useMemo(
    () =>
      props.tabs.flatMap((item) => {
        const presentation = presentations.get(item.tab.key);
        return presentation ? [{ ...item, presentation }] : [];
      }),
    [presentations, props.tabs],
  );

  return (
    <>
      {orientation === "vertical" ? (
        <ResolvedWorkspaceDesktopTabsRail {...props} tabs={resolvedTabs} />
      ) : (
        <ResolvedWorkspaceDesktopTabsRow {...props} tabs={resolvedTabs} />
      )}
      {props.tabs.map(({ tab }) => (
        <WorkspaceDesktopTabPresentationSlot
          key={`${tab.key}:${tab.kind}`}
          tab={tab}
          serverId={props.normalizedServerId}
          workspaceId={props.normalizedWorkspaceId}
          onResolve={handlePresentation}
        />
      ))}
    </>
  );
}

export function WorkspaceDesktopTabsRow(props: WorkspaceDesktopTabsRowProps) {
  return <WorkspaceDesktopTabs {...props} orientation="horizontal" />;
}

export function WorkspaceDesktopTabsRail(props: WorkspaceDesktopTabsRowProps) {
  return <WorkspaceDesktopTabs {...props} orientation="vertical" />;
}

function ResolvedWorkspaceDesktopTabsRow({
  paneId,
  isFocused = false,
  tabs,
  normalizedServerId,
  normalizedWorkspaceId,
  setHoveredCloseTabKey,
  onNavigateTab,
  onCloseTab,
  onCopyResumeCommand,
  onCopyAgentId,
  onCopyTerminalId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  onCreateNewTab,
  onReorderTabs,
  externalDndContext = false,
  activeDragTabId = null,
  tabDropPreviewIndex = null,
  showPaneSplitActions = false,
  showPaneMaximizeAction = false,
  paneMaximized = false,
  onTogglePaneMaximized,
  onSplitRight,
  onSplitDown,
  focusModeEnabled,
  onExitFocusMode,
}: ResolvedWorkspaceDesktopTabsRowProps) {
  const { t } = useTranslation();
  const newTabKeys = useShortcutKeys("workspace-tab-new");
  const [tabsContainerWidth, setTabsContainerWidth] = useState<number>(0);
  const [exitFocusModeWidth, setExitFocusModeWidth] = useState<number>(0);
  const tabsScrollRef = useRef<React.ElementRef<typeof Animated.ScrollView>>(null);
  const tabScrollBoundary = useHorizontalScrollBoundary();
  const [labelMeasurements, setLabelMeasurements] = useState(
    () => new Map<string, WorkspaceTabLabelMeasurement>(),
  );
  const [trackSnapshot, setTrackSnapshot] = useState<WorkspaceTabTrackSnapshot | null>(null);
  const activeDragSortableId = useMemo(
    () => resolveActiveSortableTabId(tabs, activeDragTabId),
    [activeDragTabId, tabs],
  );

  const handleTabsContainerLayout = useCallback((event: LayoutChangeEvent) => {
    updateMeasuredWidth(setTabsContainerWidth, event);
  }, []);

  const handleExitFocusModeLayout = useCallback((event: LayoutChangeEvent) => {
    updateMeasuredWidth(setExitFocusModeWidth, event);
  }, []);

  const layoutMetrics = useMemo(
    () => ({
      rowHorizontalInset: 0,
      actionsReservedWidth: Math.max(
        0,
        DEFAULT_INLINE_ADD_BUTTON_RESERVED_WIDTH +
          (focusModeEnabled ? exitFocusModeWidth : 0) +
          (showPaneSplitActions ? PANE_SPLIT_ACTIONS_RESERVED_WIDTH : 0) +
          (showPaneMaximizeAction ? PANE_MAXIMIZE_ACTION_RESERVED_WIDTH : 0),
      ),
      rowPaddingHorizontal: TAB_ROW_PADDING_HORIZONTAL,
      tabGap: TAB_CHIP_GAP,
      minTabWidth: TAB_MIN_WIDTH,
      maxTabWidth: TAB_MAX_WIDTH,
      tabIconWidth: TAB_ICON_WIDTH,
      tabContentGap: TAB_CONTENT_GAP,
      tabHorizontalPadding: TAB_CHIP_HORIZONTAL_PADDING,
      closeButtonWidth: TAB_CLOSE_BUTTON_RESERVED_WIDTH,
    }),
    [exitFocusModeWidth, focusModeEnabled, showPaneMaximizeAction, showPaneSplitActions],
  );

  const fallbackTabLabels = useMemo(
    () => ({
      newTab: t("workspace.tabs.actions.newTab"),
      newAgent: t("workspace.tabs.fallback.newAgent"),
      setup: t("workspace.tabs.fallback.setup"),
      terminal: t("workspace.tabs.fallback.terminal"),
      agent: t("workspace.tabs.fallback.agent"),
      changes: t("panels.diff.changesLabel"),
      files: t("panels.files.label"),
      pullRequest: t("panels.pullRequest.label"),
      experiments: "Experiments",
    }),
    [t],
  );
  const tabMenuLabels = useMemo<WorkspaceTabMenuLabels>(
    () => ({
      copyResumeCommand: t("workspace.tabs.menu.copyResumeCommand"),
      copyAgentId: t("workspace.tabs.menu.copyAgentId"),
      copyTerminalId: t("workspace.tabs.menu.copyTerminalId"),
      copyFilePath: t("workspace.tabs.menu.copyFilePath"),
      rename: t("workspace.tabs.menu.rename"),
      moveToStart: t("workspace.tabs.menu.moveToStart"),
      moveToEnd: t("workspace.tabs.menu.moveToEnd"),
      closeAbove: t("workspace.tabs.menu.closeAbove"),
      closeBelow: t("workspace.tabs.menu.closeBelow"),
      closeLeft: t("workspace.tabs.menu.closeLeft"),
      closeRight: t("workspace.tabs.menu.closeRight"),
      closeOthers: t("workspace.tabs.menu.closeOthers"),
      reloadAgent: t("workspace.tabs.menu.reloadAgent"),
      reloadAgentTooltip: t("workspace.tabs.menu.reloadAgentTooltip"),
      close: t("workspace.tabs.menu.close"),
    }),
    [t],
  );
  const tabLabels = useMemo(
    () =>
      tabs.map((tab) => {
        const label =
          tab.presentation.titleState === "loading"
            ? getFallbackTabLabel(tab.tab, fallbackTabLabels)
            : tab.presentation.label;
        return { key: tab.tab.key, label, modified: tab.presentation.modified };
      }),
    [fallbackTabLabels, tabs],
  );
  const tabLabelSignature = useMemo(() => workspaceTabLabelSignature(tabLabels), [tabLabels]);
  const currentTabLabelKeys = useMemo(() => new Set(tabLabels.map(({ key }) => key)), [tabLabels]);
  useEffect(() => {
    setLabelMeasurements((current) => {
      const removedKeys = [...current.keys()].filter((key) => !currentTabLabelKeys.has(key));
      if (removedKeys.length === 0) {
        return current;
      }
      const next = new Map(current);
      for (const key of removedKeys) {
        next.delete(key);
      }
      return next;
    });
  }, [currentTabLabelKeys]);
  const publishMeasuredTrack = useCallback(() => {
    if (tabsContainerWidth <= 0) {
      return;
    }
    const labelWidths = completeWorkspaceTabLabelWidths(tabLabels, labelMeasurements);
    if (!labelWidths) {
      return;
    }

    setTrackSnapshot((current) => {
      if (
        current?.signature === tabLabelSignature &&
        sameWidths(current.labelWidths, labelWidths)
      ) {
        return current;
      }
      return {
        signature: tabLabelSignature,
        tabs,
        labels: tabLabels,
        labelWidths,
      };
    });
  }, [labelMeasurements, tabLabelSignature, tabLabels, tabs, tabsContainerWidth]);

  useLayoutEffect(() => {
    publishMeasuredTrack();
  }, [publishMeasuredTrack]);

  const handleTabLabelLayout = useCallback(
    (key: string, label: string, event: LayoutChangeEvent) => {
      const width = Math.ceil(event.nativeEvent.layout.width);
      if (width <= 0) {
        return;
      }
      setLabelMeasurements((current) => {
        const measurement = current.get(key);
        if (measurement?.label === label && measurement.width === width) {
          return current;
        }
        const next = new Map(current);
        next.set(key, { label, width });
        return next;
      });
    },
    [],
  );

  const displayedTabs = useMemo(() => {
    if (!trackSnapshot) {
      return EMPTY_RESOLVED_TAB_ROWS;
    }
    const currentTabs = new Map(
      tabs.map((tab, index) => [tab.tab.key, { tab, label: tabLabels[index]?.label }]),
    );
    return trackSnapshot.tabs.map((snapshotTab, index) => {
      const current = currentTabs.get(snapshotTab.tab.key);
      return current?.label === trackSnapshot.labels[index]?.label ? current.tab : snapshotTab;
    });
  }, [tabLabels, tabs, trackSnapshot]);

  const { layout } = useWorkspaceTabLayout({
    tabLabelWidths: trackSnapshot?.labelWidths ?? [],
    viewportWidthOverride: tabsContainerWidth > 0 ? tabsContainerWidth : null,
    metrics: layoutMetrics,
  });

  const activeTabRevealTarget = useMemo(() => {
    const activeIndex = displayedTabs.findIndex((item) => item.isActive);
    const activeItem = layout.items[activeIndex];
    const activeTab = displayedTabs[activeIndex];
    if (activeIndex < 0 || !activeItem || !activeTab) {
      return null;
    }
    let start = TAB_ROW_PADDING_HORIZONTAL;
    for (let index = 0; index < activeIndex; index += 1) {
      start += (layout.items[index]?.width ?? 0) + TAB_CHIP_GAP;
    }
    return {
      key: activeTab.tab.tabId,
      start,
      end: start + activeItem.width + TAB_CHIP_GAP,
    };
  }, [displayedTabs, layout.items]);
  useWorkspaceTabHorizontalScroll(
    tabsScrollRef,
    layout.requiresHorizontalScrollFallback,
    activeTabRevealTarget,
  );

  const orderedTabs = useMemo(() => tabs.map((item) => item.tab), [tabs]);
  const handleMoveTabToStart = useCallback(
    (tabId: string) => {
      const nextTabs = moveWorkspaceTabToEdge(orderedTabs, tabId, "start");
      if (nextTabs !== orderedTabs) {
        onReorderTabs(nextTabs);
      }
    },
    [onReorderTabs, orderedTabs],
  );
  const handleMoveTabToEnd = useCallback(
    (tabId: string) => {
      const nextTabs = moveWorkspaceTabToEdge(orderedTabs, tabId, "end");
      if (nextTabs !== orderedTabs) {
        onReorderTabs(nextTabs);
      }
    },
    [onReorderTabs, orderedTabs],
  );

  const handleDragEnd = useCallback(
    (nextTabs: ResolvedWorkspaceDesktopTabRowItem[]) => {
      onReorderTabs(nextTabs.map((tab) => tab.tab));
    },
    [onReorderTabs],
  );

  const getTabDragData = useMemo(() => {
    if (!paneId) return undefined;
    return (tab: ResolvedWorkspaceDesktopTabRowItem) => ({
      kind: "workspace-tab" as const,
      orientation: "horizontal" as const,
      paneId,
      tabId: tab.tab.tabId,
    });
  }, [paneId]);

  const createNewTab = useCallback(() => onCreateNewTab({ paneId }), [onCreateNewTab, paneId]);

  const handleNewTabKeyboardAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (!isFocused) return false;
      if (action.id === "workspace.tab.menu.open") {
        createNewTab();
        return true;
      }
      return false;
    },
    [createNewTab, isFocused],
  );

  useKeyboardActionHandler({
    handlerId: buildWorkspaceKeyboardHandlerId({
      name: "workspace-new-tab",
      serverId: normalizedServerId,
      workspaceId: normalizedWorkspaceId,
      paneId,
    }),
    actions: ["workspace.tab.menu.open"],
    enabled: isFocused,
    priority: 200,
    handle: handleNewTabKeyboardAction,
  });

  const renderTab = useCallback(
    ({
      item,
      index,
      dragHandleProps,
      isActive,
    }: DraggableRenderItemInfo<ResolvedWorkspaceDesktopTabRowItem>) => {
      const shouldShowCloseButton = layout.closeButtonPolicy === "all";
      const layoutItem = layout.items[index] ?? null;
      const resolvedTabWidth = layoutItem?.width ?? 150;
      const showLabel = layoutItem?.showLabel ?? true;
      const showDropIndicatorBefore = activeDragTabId !== null && tabDropPreviewIndex === index;
      const showDropIndicatorAfter =
        activeDragTabId !== null &&
        tabDropPreviewIndex === displayedTabs.length &&
        index === displayedTabs.length - 1;

      return (
        <ResolvedDesktopTabChip
          key={`${item.tab.key}:${item.tab.kind}`}
          item={item}
          isFocused={isFocused}
          isDragging={isActive}
          index={index}
          tabCount={displayedTabs.length}
          onCopyResumeCommand={onCopyResumeCommand}
          onCopyAgentId={onCopyAgentId}
          onCopyTerminalId={onCopyTerminalId}
          onCopyFilePath={onCopyFilePath}
          onReloadAgent={onReloadAgent}
          onRenameTab={onRenameTab}
          onMoveTabToStart={handleMoveTabToStart}
          onMoveTabToEnd={handleMoveTabToEnd}
          onCloseTabsToLeft={onCloseTabsToLeft}
          onCloseTabsToRight={onCloseTabsToRight}
          onCloseOtherTabs={onCloseOtherTabs}
          resolvedTabWidth={resolvedTabWidth}
          showLabel={showLabel}
          showCloseButton={shouldShowCloseButton}
          setHoveredCloseTabKey={setHoveredCloseTabKey}
          onNavigateTab={onNavigateTab}
          onCloseTab={onCloseTab}
          labels={tabMenuLabels}
          dragHandleProps={dragHandleProps}
          showDropIndicatorBefore={showDropIndicatorBefore}
          showDropIndicatorAfter={showDropIndicatorAfter}
        />
      );
    },
    [
      activeDragTabId,
      isFocused,
      layout.closeButtonPolicy,
      layout.items,
      onCloseOtherTabs,
      onCloseTab,
      onCloseTabsToLeft,
      onCloseTabsToRight,
      onCopyAgentId,
      onCopyTerminalId,
      onCopyFilePath,
      onCopyResumeCommand,
      onNavigateTab,
      onReloadAgent,
      onRenameTab,
      handleMoveTabToStart,
      handleMoveTabToEnd,
      setHoveredCloseTabKey,
      tabMenuLabels,
      tabDropPreviewIndex,
      displayedTabs.length,
    ],
  );

  const tabsScrollStyle = useMemo(
    () => [
      styles.tabsScroll,
      layout.requiresHorizontalScrollFallback
        ? styles.tabsScrollOverflow
        : styles.tabsScrollFitContent,
    ],
    [layout.requiresHorizontalScrollFallback],
  );

  const row = (
    <View
      style={styles.tabsContainer}
      testID="workspace-tabs-row"
      onLayout={handleTabsContainerLayout}
    >
      <View
        style={styles.tabLabelMeasurements}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {tabLabels.map(({ key, label }) => (
          <TabLabelMeasurement
            key={`${key}:${label}`}
            tabKey={key}
            label={label}
            onMeasure={handleTabLabelLayout}
          />
        ))}
      </View>
      <WorkspaceExitFocusModeButton
        visible={focusModeEnabled}
        onPress={onExitFocusMode}
        onLayout={handleExitFocusModeLayout}
      />
      <View style={styles.tabsScrollContainer}>
        <Animated.ScrollView
          ref={tabsScrollRef}
          horizontal
          scrollEnabled={layout.requiresHorizontalScrollFallback}
          testID="workspace-tabs-scroll"
          style={tabsScrollStyle}
          contentContainerStyle={styles.tabsContent}
          showsHorizontalScrollIndicator={false}
          onLayout={tabScrollBoundary.onLayout}
          onContentSizeChange={tabScrollBoundary.onContentSizeChange}
          onScroll={tabScrollBoundary.onScroll}
          scrollEventThrottle={16}
        >
          <SortableInlineList
            data={displayedTabs}
            keyExtractor={tabKeyExtractor}
            useDragHandle
            disabled={!externalDndContext && displayedTabs.length < 2}
            onDragEnd={handleDragEnd}
            externalDndContext={externalDndContext}
            activeId={activeDragSortableId}
            getItemData={getTabDragData}
            renderItem={renderTab}
          />
          {!layout.requiresHorizontalScrollFallback ? (
            <WorkspaceNewTabButton
              placement="inline"
              serverId={normalizedServerId}
              paneId={paneId}
              shortcutKeys={newTabKeys}
            />
          ) : null}
        </Animated.ScrollView>
        <HorizontalScrollBoundaryShades
          visible={layout.requiresHorizontalScrollFallback}
          backdrop="surface"
          testIDPrefix="workspace-tabs-scroll-shade"
          leftStyle={tabScrollBoundary.leftShadeStyle}
          rightStyle={tabScrollBoundary.rightShadeStyle}
        />
      </View>
      <WorkspacePaneToolbarActions
        showNewTabButton={layout.requiresHorizontalScrollFallback}
        showSplitActions={showPaneSplitActions}
        showMaximizeAction={showPaneMaximizeAction}
        paneMaximized={paneMaximized}
        serverId={normalizedServerId}
        paneId={paneId}
        newTabShortcutKeys={newTabKeys}
        onSplitRight={onSplitRight}
        onSplitDown={onSplitDown}
        onTogglePaneMaximized={onTogglePaneMaximized}
      />
    </View>
  );

  return <RenderProfile id="WorkspaceDesktopTabsRow">{row}</RenderProfile>;
}

function workspaceTabTreeRowKey(row: WorkspaceTabTreeRow): string {
  return row.kind === "group" ? `workspace-tab-tree-group:${row.group.id}` : row.leaf.tabId;
}

function workspaceTabTreeGroupRowStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.railTreeGroupRow, (Boolean(hovered) || pressed) && styles.railTreeGroupRowHovered];
}

function WorkspaceTabTreeGroupRow({
  row,
  hasActiveDescendant,
  onToggle,
}: {
  row: Extract<WorkspaceTabTreeRow, { kind: "group" }>;
  hasActiveDescendant: boolean;
  onToggle: (groupId: string) => void;
}) {
  const handlePress = useCallback(() => onToggle(row.group.id), [onToggle, row.group.id]);
  const contentStyle = useMemo(
    () => [
      styles.railTreeGroupContent,
      inlineUnistylesStyle({ paddingLeft: treeRowPaddingLeft(row.depth) }),
    ],
    [row.depth],
  );
  const accessibilityState = useMemo(() => ({ expanded: !row.collapsed }), [row.collapsed]);

  return (
    <View style={styles.railTreeGroupSlot}>
      <Pressable
        testID={`workspace-tab-group-${encodeURIComponent(row.group.path)}`}
        onPress={handlePress}
        style={workspaceTabTreeGroupRowStyle}
        accessibilityRole="button"
        accessibilityLabel={row.group.path}
        accessibilityState={accessibilityState}
      >
        {row.collapsed && hasActiveDescendant ? (
          <View style={styles.railTreeGroupActiveBar} />
        ) : null}
        <View style={contentStyle}>
          <TreeChevron expanded={!row.collapsed} />
          <ThemedFolder size={14} uniProps={mutedColorMapping} />
          <Text style={styles.railTreeGroupLabel} numberOfLines={1} ellipsizeMode="tail">
            {row.group.label}
          </Text>
          <Text style={styles.railTreeGroupCount}>{row.group.descendantTabIds.length}</Text>
        </View>
      </Pressable>
    </View>
  );
}

function ResolvedWorkspaceDesktopTabsRail({
  paneId,
  isFocused = false,
  tabs,
  normalizedServerId,
  normalizedWorkspaceId,
  setHoveredCloseTabKey,
  onNavigateTab,
  onCloseTab,
  onCopyResumeCommand,
  onCopyAgentId,
  onCopyTerminalId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  onCreateNewTab,
  onReorderTabs,
  externalDndContext = false,
  activeDragTabId = null,
  tabDropPreviewIndex = null,
  showPaneSplitActions = false,
  showPaneMaximizeAction = false,
  paneMaximized = false,
  onTogglePaneMaximized,
  onSplitRight,
  onSplitDown,
  focusModeEnabled,
  onExitFocusMode,
}: ResolvedWorkspaceDesktopTabsRowProps) {
  const { t } = useTranslation();
  const newTabKeys = useShortcutKeys("workspace-tab-new");
  const railScrollRef = useRef<ScrollView>(null);
  const railScrollOffsetRef = useRef(0);
  const [railViewportHeight, setRailViewportHeight] = useState(0);
  const [railContentHeight, setRailContentHeight] = useState(0);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const tabItemsById = useMemo(() => new Map(tabs.map((item) => [item.tab.tabId, item])), [tabs]);
  const treeModel = useMemo(
    () =>
      buildWorkspaceTabTree(
        tabs.map((item) => ({
          tabId: item.tab.tabId,
          label: item.presentation.label,
          pathLabel:
            item.presentation.titleState === "ready" &&
            (item.presentation.kind === "agent" || item.presentation.kind === "terminal")
              ? item.presentation.label
              : null,
        })),
      ),
    [tabs],
  );
  const treeRows = useMemo(
    () => projectWorkspaceTabTree(treeModel, collapsedGroupIds),
    [collapsedGroupIds, treeModel],
  );
  const activeDragSortableId = useMemo(
    () =>
      activeDragTabId && treeModel.leavesByTabId.has(activeDragTabId) ? activeDragTabId : null,
    [activeDragTabId, treeModel.leavesByTabId],
  );
  const activeTabId = useMemo(() => tabs.find((item) => item.isActive)?.tab.tabId ?? null, [tabs]);
  const activeTabIndex = useMemo(() => {
    if (!activeTabId) return -1;
    return treeRows.findIndex(
      (row) =>
        (row.kind === "leaf" && row.leaf.tabId === activeTabId) ||
        (row.kind === "group" && row.collapsed && row.group.descendantTabIds.includes(activeTabId)),
    );
  }, [activeTabId, treeRows]);
  const activeTabStart =
    activeTabIndex < 0 ? null : activeTabIndex * WORKSPACE_SECONDARY_HEADER_HEIGHT;
  const activeTabEnd =
    activeTabStart === null ? null : activeTabStart + WORKSPACE_SECONDARY_HEADER_HEIGHT;

  const handleRailViewportLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.round(event.nativeEvent.layout.height);
    setRailViewportHeight((current) => (current === nextHeight ? current : nextHeight));
  }, []);
  const handleRailContentSizeChange = useCallback((_width: number, height: number) => {
    const nextHeight = Math.round(height);
    setRailContentHeight((current) => (Math.abs(current - nextHeight) > 1 ? nextHeight : current));
  }, []);
  const handleRailScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    railScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
  }, []);

  useEffect(() => {
    const scrollView = railScrollRef.current;
    if (
      !scrollView ||
      !activeTabId ||
      activeTabStart === null ||
      activeTabEnd === null ||
      railViewportHeight <= 0
    ) {
      return;
    }
    const nextOffset = getWorkspaceTabRevealOffset({
      currentOffset: railScrollOffsetRef.current,
      viewportWidth: railViewportHeight,
      contentWidth: railContentHeight,
      itemStart: activeTabStart,
      itemEnd: activeTabEnd,
    });
    if (Math.abs(nextOffset - railScrollOffsetRef.current) <= 1) return;
    railScrollOffsetRef.current = nextOffset;
    scrollView.scrollTo({ x: 0, y: nextOffset, animated: false });
  }, [activeTabEnd, activeTabId, activeTabStart, railContentHeight, railViewportHeight]);

  useEffect(() => {
    const liveGroupIds = new Set(treeModel.groupIds);
    setCollapsedGroupIds((current) => {
      const next = new Set([...current].filter((groupId) => liveGroupIds.has(groupId)));
      return next.size === current.size ? current : next;
    });
  }, [treeModel.groupIds]);

  const previousActiveTabIdRef = useRef(activeTabId);
  useEffect(() => {
    const previousActiveTabId = previousActiveTabIdRef.current;
    previousActiveTabIdRef.current = activeTabId;
    if (!activeTabId || previousActiveTabId === activeTabId) return;
    const ancestors = getWorkspaceTabTreeAncestorGroupIds(treeModel, activeTabId);
    if (ancestors.length === 0) return;
    setCollapsedGroupIds((current) => {
      if (!ancestors.some((groupId) => current.has(groupId))) return current;
      const next = new Set(current);
      for (const groupId of ancestors) next.delete(groupId);
      return next;
    });
  }, [activeTabId, treeModel]);

  const handleToggleGroup = useCallback((groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const tabMenuLabels = useMemo<WorkspaceTabMenuLabels>(
    () => ({
      copyResumeCommand: t("workspace.tabs.menu.copyResumeCommand"),
      copyAgentId: t("workspace.tabs.menu.copyAgentId"),
      copyTerminalId: t("workspace.tabs.menu.copyTerminalId"),
      copyFilePath: t("workspace.tabs.menu.copyFilePath"),
      rename: t("workspace.tabs.menu.rename"),
      moveToStart: t("workspace.tabs.menu.moveToStart"),
      moveToEnd: t("workspace.tabs.menu.moveToEnd"),
      closeAbove: t("workspace.tabs.menu.closeAbove"),
      closeBelow: t("workspace.tabs.menu.closeBelow"),
      closeLeft: t("workspace.tabs.menu.closeLeft"),
      closeRight: t("workspace.tabs.menu.closeRight"),
      closeOthers: t("workspace.tabs.menu.closeOthers"),
      reloadAgent: t("workspace.tabs.menu.reloadAgent"),
      reloadAgentTooltip: t("workspace.tabs.menu.reloadAgentTooltip"),
      close: t("workspace.tabs.menu.close"),
    }),
    [t],
  );
  const orderedTabs = useMemo(() => tabs.map((item) => item.tab), [tabs]);
  const tabIndexesById = useMemo(
    () => new Map(tabs.map((item, index) => [item.tab.tabId, index])),
    [tabs],
  );
  const handleMoveTabToStart = useCallback(
    (tabId: string) => {
      const nextTabs = moveWorkspaceTabToEdge(orderedTabs, tabId, "start");
      if (nextTabs !== orderedTabs) onReorderTabs(nextTabs);
    },
    [onReorderTabs, orderedTabs],
  );
  const handleMoveTabToEnd = useCallback(
    (tabId: string) => {
      const nextTabs = moveWorkspaceTabToEdge(orderedTabs, tabId, "end");
      if (nextTabs !== orderedTabs) onReorderTabs(nextTabs);
    },
    [onReorderTabs, orderedTabs],
  );
  const handleDragEnd = useCallback(
    (nextRows: WorkspaceTabTreeRow[]) => {
      if (collapsedGroupIds.size > 0) return;
      const nextTabs = nextRows.flatMap((row) => {
        if (row.kind !== "leaf") return [];
        const item = tabItemsById.get(row.leaf.tabId);
        return item ? [item.tab] : [];
      });
      if (nextTabs.length === tabs.length) onReorderTabs(nextTabs);
    },
    [collapsedGroupIds.size, onReorderTabs, tabItemsById, tabs.length],
  );
  const getTabDragData = useMemo(() => {
    if (!paneId) return undefined;
    return (row: WorkspaceTabTreeRow) =>
      row.kind === "leaf"
        ? {
            kind: "workspace-tab" as const,
            orientation: "vertical" as const,
            paneId,
            tabId: row.leaf.tabId,
          }
        : { kind: "workspace-tab-tree-group-static" as const };
  }, [paneId]);
  const createNewTab = useCallback(() => onCreateNewTab({ paneId }), [onCreateNewTab, paneId]);
  const handleNewTabKeyboardAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      if (!isFocused || action.id !== "workspace.tab.menu.open") return false;
      createNewTab();
      return true;
    },
    [createNewTab, isFocused],
  );
  useKeyboardActionHandler({
    handlerId: buildWorkspaceKeyboardHandlerId({
      name: "workspace-new-tab",
      serverId: normalizedServerId,
      workspaceId: normalizedWorkspaceId,
      paneId,
    }),
    actions: ["workspace.tab.menu.open"],
    enabled: isFocused,
    priority: 200,
    handle: handleNewTabKeyboardAction,
  });

  const renderTreeRow = useCallback(
    ({ item: row, dragHandleProps, isActive }: DraggableRenderItemInfo<WorkspaceTabTreeRow>) => {
      if (row.kind === "group") {
        return (
          <WorkspaceTabTreeGroupRow
            row={row}
            hasActiveDescendant={Boolean(
              activeTabId && row.group.descendantTabIds.includes(activeTabId),
            )}
            onToggle={handleToggleGroup}
          />
        );
      }

      const item = tabItemsById.get(row.leaf.tabId);
      if (!item) return <View />;
      const index = tabIndexesById.get(row.leaf.tabId) ?? 0;
      const showDropIndicatorBefore = activeDragTabId !== null && tabDropPreviewIndex === index;
      const showDropIndicatorAfter =
        activeDragTabId !== null &&
        tabDropPreviewIndex === tabs.length &&
        index === tabs.length - 1;
      return (
        <ResolvedDesktopTabChip
          key={`${item.tab.key}:${item.tab.kind}`}
          item={item}
          isFocused={isFocused}
          isDragging={isActive}
          index={index}
          tabCount={tabs.length}
          onCopyResumeCommand={onCopyResumeCommand}
          onCopyAgentId={onCopyAgentId}
          onCopyTerminalId={onCopyTerminalId}
          onCopyFilePath={onCopyFilePath}
          onReloadAgent={onReloadAgent}
          onRenameTab={onRenameTab}
          onMoveTabToStart={handleMoveTabToStart}
          onMoveTabToEnd={handleMoveTabToEnd}
          onCloseTabsToLeft={onCloseTabsToLeft}
          onCloseTabsToRight={onCloseTabsToRight}
          onCloseOtherTabs={onCloseOtherTabs}
          resolvedTabWidth={WORKSPACE_TAB_RAIL_WIDTH - 8}
          showLabel
          showCloseButton
          setHoveredCloseTabKey={setHoveredCloseTabKey}
          onNavigateTab={onNavigateTab}
          onCloseTab={onCloseTab}
          labels={tabMenuLabels}
          dragHandleProps={dragHandleProps}
          showDropIndicatorBefore={showDropIndicatorBefore}
          showDropIndicatorAfter={showDropIndicatorAfter}
          orientation="vertical"
          displayLabel={row.leaf.displaySuffix}
          treeDepth={row.depth}
        />
      );
    },
    [
      activeDragTabId,
      handleMoveTabToEnd,
      handleMoveTabToStart,
      handleToggleGroup,
      activeTabId,
      isFocused,
      onCloseOtherTabs,
      onCloseTab,
      onCloseTabsToLeft,
      onCloseTabsToRight,
      onCopyAgentId,
      onCopyFilePath,
      onCopyResumeCommand,
      onCopyTerminalId,
      onNavigateTab,
      onReloadAgent,
      onRenameTab,
      setHoveredCloseTabKey,
      tabDropPreviewIndex,
      tabMenuLabels,
      tabs.length,
      tabIndexesById,
      tabItemsById,
    ],
  );
  const isTreeRowDisabled = useCallback(
    (row: WorkspaceTabTreeRow) => row.kind === "group" || collapsedGroupIds.size > 0,
    [collapsedGroupIds.size],
  );
  const ignoreLayout = useCallback((_event: LayoutChangeEvent) => {}, []);

  return (
    <RenderProfile id="WorkspaceDesktopTabsRail">
      <View style={styles.railContainer} testID="workspace-tabs-rail">
        <ScrollView
          ref={railScrollRef}
          style={styles.railScroll}
          contentContainerStyle={styles.railTabsContent}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          testID="workspace-tabs-rail-scroll"
          onLayout={handleRailViewportLayout}
          onContentSizeChange={handleRailContentSizeChange}
          onScroll={handleRailScroll}
        >
          <SortableInlineList
            data={treeRows}
            keyExtractor={workspaceTabTreeRowKey}
            useDragHandle
            disabled={!externalDndContext && treeRows.length < 2}
            isItemDisabled={isTreeRowDisabled}
            onDragEnd={handleDragEnd}
            externalDndContext={externalDndContext}
            activeId={activeDragSortableId}
            getItemData={getTabDragData}
            renderItem={renderTreeRow}
            orientation="vertical"
          />
        </ScrollView>
        <View style={styles.railActions}>
          <WorkspaceExitFocusModeButton
            visible={focusModeEnabled}
            onPress={onExitFocusMode}
            onLayout={ignoreLayout}
          />
          <WorkspaceVerticalTabLaunchActions serverId={normalizedServerId} paneId={paneId} />
          <WorkspacePaneToolbarActions
            showNewTabButton
            showSplitActions={showPaneSplitActions}
            showMaximizeAction={showPaneMaximizeAction}
            paneMaximized={paneMaximized}
            serverId={normalizedServerId}
            paneId={paneId}
            newTabShortcutKeys={newTabKeys}
            onSplitRight={onSplitRight}
            onSplitDown={onSplitDown}
            onTogglePaneMaximized={onTogglePaneMaximized}
            expandSplitActions
          />
        </View>
      </View>
    </RenderProfile>
  );
}

function ResolvedDesktopTabChip({
  item,
  isFocused,
  isDragging,
  index,
  tabCount,
  onCopyResumeCommand,
  onCopyAgentId,
  onCopyTerminalId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onMoveTabToStart,
  onMoveTabToEnd,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  resolvedTabWidth,
  showLabel,
  showCloseButton,
  setHoveredCloseTabKey,
  onNavigateTab,
  onCloseTab,
  labels,
  dragHandleProps,
  showDropIndicatorBefore,
  showDropIndicatorAfter,
  orientation = "horizontal",
  displayLabel,
  treeDepth = 0,
}: {
  item: ResolvedWorkspaceDesktopTabRowItem;
  isFocused: boolean;
  isDragging: boolean;
  index: number;
  tabCount: number;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyTerminalId: (terminalId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onMoveTabToStart: (tabId: string) => Promise<void> | void;
  onMoveTabToEnd: (tabId: string) => Promise<void> | void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  resolvedTabWidth: number;
  showLabel: boolean;
  showCloseButton: boolean;
  setHoveredCloseTabKey: Dispatch<SetStateAction<string | null>>;
  onNavigateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  labels: WorkspaceTabMenuLabels;
  dragHandleProps: DraggableListDragHandleProps | undefined;
  showDropIndicatorBefore: boolean;
  showDropIndicatorAfter: boolean;
  orientation?: DragOrientation;
  displayLabel?: string;
  treeDepth?: number;
}) {
  const { t } = useTranslation();
  const presentation = item.presentation;
  const resolvedTab = useMemo(
    () =>
      buildWorkspaceDesktopTabActions({
        tab: item.tab,
        index,
        tabCount,
        onCopyResumeCommand,
        onCopyAgentId,
        onCopyTerminalId,
        onCopyFilePath,
        onReloadAgent,
        onRenameTab,
        onMoveTabToStart,
        onMoveTabToEnd,
        onCloseTab,
        onCloseTabsToLeft,
        onCloseTabsToRight,
        onCloseOtherTabs,
        labels,
        orientation,
      }),
    [
      index,
      item.tab,
      onCloseOtherTabs,
      onCloseTab,
      onCloseTabsToLeft,
      onCloseTabsToRight,
      onCopyAgentId,
      onCopyTerminalId,
      onCopyFilePath,
      onCopyResumeCommand,
      labels,
      orientation,
      onReloadAgent,
      onRenameTab,
      onMoveTabToStart,
      onMoveTabToEnd,
      tabCount,
    ],
  );

  const tooltipLabel =
    presentation.titleState === "loading"
      ? t("workspace.tabs.loadingAgentTitle")
      : presentation.tooltip;
  return (
    <View style={orientation === "vertical" ? styles.railTabSlot : styles.tabSlot}>
      {showDropIndicatorBefore ? (
        <View
          style={
            orientation === "vertical"
              ? [styles.railTabDropIndicator, styles.railTabDropIndicatorBefore]
              : [styles.tabDropIndicator, styles.tabDropIndicatorBefore]
          }
        />
      ) : null}
      <TabChip
        tab={item.tab}
        isActive={item.isActive}
        isDragging={isDragging}
        isFocused={isFocused}
        resolvedTabWidth={resolvedTabWidth}
        showLabel={showLabel}
        showCloseButton={showCloseButton}
        isCloseHovered={item.isCloseHovered}
        isClosingTab={item.isClosingTab}
        presentation={presentation}
        displayLabel={displayLabel}
        treeDepth={treeDepth}
        tooltipLabel={tooltipLabel}
        resolvedTab={resolvedTab}
        setHoveredCloseTabKey={setHoveredCloseTabKey}
        onNavigateTab={onNavigateTab}
        onCloseTab={onCloseTab}
        dragHandleProps={dragHandleProps}
        orientation={orientation}
      />
      {showDropIndicatorAfter ? (
        <View
          style={
            orientation === "vertical"
              ? [styles.railTabDropIndicator, styles.railTabDropIndicatorAfter]
              : [styles.tabDropIndicator, styles.tabDropIndicatorAfter]
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  railContainer: {
    width: WORKSPACE_TAB_RAIL_WIDTH,
    minWidth: WORKSPACE_TAB_RAIL_WIDTH,
    maxWidth: WORKSPACE_TAB_RAIL_WIDTH,
    height: "100%",
    minHeight: 0,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  railScroll: {
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
  railTabsContent: {
    width: "100%",
  },
  railActions: {
    minHeight: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: theme.spacing[1],
    overflow: "visible",
  },
  tabsContainer: {
    minWidth: 0,
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    flexDirection: "row",
    alignItems: "center",
    overflow: "visible",
  },
  tabsScroll: {
    minWidth: 0,
  },
  tabsScrollContainer: {
    minWidth: 0,
    flex: 1,
    alignSelf: "stretch",
  },
  tabsScrollFitContent: {
    flex: 1,
  },
  tabsScrollOverflow: {
    flex: 1,
  },
  tabsContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: TAB_ROW_PADDING_HORIZONTAL,
  },
  exitFocusModeSlot: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[0.5],
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
  },
  inlineAddButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[1],
  },
  inlineNewTabButton: {
    width: buttonControlHeight.xs,
    height: buttonControlHeight.xs,
  },
  paneSplitActions: {
    paddingHorizontal: PANE_SPLIT_ACTIONS_HORIZONTAL_PADDING,
    marginRight: PANE_SPLIT_ACTIONS_OUTER_MARGIN,
  },
  tab: {
    height: buttonControlHeight.xs,
    paddingHorizontal: TAB_CHIP_HORIZONTAL_PADDING,
    borderRadius: theme.borderRadius.md,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    userSelect: "none",
  },
  railTab: {
    borderRadius: theme.borderRadius.sm,
  },
  tabHovered: {
    backgroundColor: theme.colors.surface1,
  },
  tabActive: {
    backgroundColor: theme.colors.surface2,
  },
  tabActiveUnfocused: {
    backgroundColor: theme.colors.surface1,
  },
  tabHoverFrame: {
    position: "relative",
  },
  tabSlot: {
    position: "relative",
    overflow: "visible",
    marginHorizontal: TAB_CHIP_GAP / 2,
  },
  railTabSlot: {
    position: "relative",
    width: "100%",
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  railTreeGroupSlot: {
    position: "relative",
    width: "100%",
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  railTreeGroupRow: {
    position: "relative",
    width: "100%",
    height: buttonControlHeight.xs,
    borderRadius: theme.borderRadius.sm,
    justifyContent: "center",
    userSelect: "none",
  },
  railTreeGroupRowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  railTreeGroupActiveBar: {
    position: "absolute",
    left: 0,
    top: theme.spacing[1],
    bottom: theme.spacing[1],
    width: 2,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  railTreeGroupContent: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: theme.spacing[2],
    gap: theme.spacing[1],
  },
  railTreeGroupLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    userSelect: "none",
  },
  railTreeGroupCount: {
    flexShrink: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    userSelect: "none",
  },
  tabHandle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
    userSelect: "none",
  },
  tabIcon: {
    width: TAB_ICON_WIDTH,
    height: TAB_ICON_WIDTH,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  // The chip box stops at the slot's padding box, so the gap between two chips runs from
  // -TAB_CHIP_GAP to 0. Centre a TAB_DROP_INDICATOR_WIDTH pill in it.
  tabDropIndicator: {
    position: "absolute",
    top: theme.spacing[0.5],
    bottom: theme.spacing[0.5],
    width: TAB_DROP_INDICATOR_WIDTH,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    zIndex: 10,
    pointerEvents: "none",
  },
  tabDropIndicatorBefore: {
    left: -TAB_CHIP_GAP / 2 - TAB_DROP_INDICATOR_WIDTH / 2,
  },
  tabDropIndicatorAfter: {
    right: -TAB_CHIP_GAP / 2 - TAB_DROP_INDICATOR_WIDTH / 2,
  },
  railTabDropIndicator: {
    position: "absolute",
    left: theme.spacing[2],
    right: theme.spacing[2],
    height: TAB_DROP_INDICATOR_WIDTH,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    zIndex: 10,
    pointerEvents: "none",
  },
  railTabDropIndicatorBefore: {
    top: -TAB_DROP_INDICATOR_WIDTH / 2,
  },
  railTabDropIndicatorAfter: {
    bottom: -TAB_DROP_INDICATOR_WIDTH / 2,
  },
  tabLabel: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    userSelect: "none",
  },
  tabLabelMeasurements: {
    position: "absolute",
    top: 0,
    left: 0,
    opacity: 0,
    alignItems: "flex-start",
    pointerEvents: "none",
  },
  tabLabelMeasurement: {
    flexShrink: 0,
  },
  tabLabelSkeleton: {
    width: 96,
    maxWidth: "100%",
    flexShrink: 1,
    minWidth: 0,
    height: 10,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface3,
    opacity: 0.9,
  },
  tabLabelActive: {
    color: theme.colors.foreground,
  },
  tabTrailingOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 48,
    borderTopRightRadius: theme.borderRadius.md,
    borderBottomRightRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    overflow: "hidden",
  },
  tabTrailingOverlayShown: {
    opacity: 1,
  },
  tabTrailingOverlayHidden: {
    opacity: 0,
  },
  tabCloseButton: {
    position: "absolute",
    right: 4,
    width: 18,
    height: 18,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  tabModifiedDot: {
    width: TAB_MODIFIED_DOT_SIZE,
    height: TAB_MODIFIED_DOT_SIZE,
    flexShrink: 0,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
  },
  newTabTooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  tooltipAgentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipAgentId: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  menuItemHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
