import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type Ref,
  type SetStateAction,
} from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  ActivityIndicator,
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
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  ChevronDown,
  Columns2,
  Copy,
  Folder,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Pencil,
  RotateCw,
  Rows2,
  Globe,
  Plus,
  SquarePen,
  SquareTerminal,
  X,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "expo-router";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useWorkspaceTabLayout } from "@/screens/workspace/use-workspace-tab-layout";
import { useHorizontalWheelScroll } from "@/hooks/use-horizontal-wheel-scroll";
import { getWorkspaceTabRevealOffset } from "@/screens/workspace/workspace-tab-scroll";
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
import type { Theme } from "@/styles/theme";
import { RenderProfile } from "@/utils/render-profiler";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  getTerminalProfileIcon,
  resolveTerminalProfiles,
} from "@getpaseo/protocol/terminal-profiles";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import type { TerminalProfileInput } from "@/screens/workspace/terminals/use-workspace-terminals";
import { ProfileIcon, usePinnedLaunchers } from "@/workspace-pins/launch";
import { runPinnedTabTarget, type TabTargetHandlers } from "@/workspace-pins/run";
import type { PinnedTabTarget } from "@/workspace-pins/target";
import { PinnedTargetsRow } from "@/workspace-pins/pinned-targets-row";
import { PinnableMenuItem } from "@/workspace-pins/pinnable-menu-item";
import { WORKSPACE_TAB_RAIL_WIDTH } from "@/screens/workspace/workspace-tab-placement";
import {
  buildWorkspaceTabTree,
  getWorkspaceTabTreeAncestorGroupIds,
  getWorkspaceTabTreeGroupSiblingNodeOrder,
  getWorkspaceTabTreeLeafNodeId,
  getWorkspaceTabTreeRowSortableId,
  getWorkspaceTabTreeSiblingLeafIds,
  getWorkspaceTabTreeSiblingNodeOrder,
  moveWorkspaceTabTreeLeafToSiblingEdge,
  moveWorkspaceTabTreeGroupToSiblingEdge,
  projectWorkspaceTabTree,
  type WorkspaceTabTreeGroup,
  type WorkspaceTabTreeRow,
} from "@/screens/workspace/workspace-tab-tree";
import { TreeChevron, TreeIndentGuides, treeRowPaddingLeft } from "@/components/tree-primitives";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getWorkspaceStateBucketPriority } from "@getpaseo/protocol/agent-state-bucket";

const DROPDOWN_WIDTH = 220;
const LOADING_TAB_LABEL_SKELETON_WIDTH = 80;
const DEFAULT_INLINE_ADD_BUTTON_RESERVED_WIDTH = 36;

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedX = withUnistyles(X);
const ThemedCopy = withUnistyles(Copy);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedArrowUpToLine = withUnistyles(ArrowUpToLine);
const ThemedArrowDownToLine = withUnistyles(ArrowDownToLine);
const ThemedArrowLeftToLine = withUnistyles(ArrowLeftToLine);
const ThemedArrowRightToLine = withUnistyles(ArrowRightToLine);
const ThemedCopyX = withUnistyles(CopyX);
const ThemedPencil = withUnistyles(Pencil);
const ThemedSquarePen = withUnistyles(SquarePen);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedGlobe = withUnistyles(Globe);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedRows2 = withUnistyles(Rows2);
const ThemedPlus = withUnistyles(Plus);
const ThemedListChevronsDownUp = withUnistyles(ListChevronsDownUp);
const ThemedListChevronsUpDown = withUnistyles(ListChevronsUpDown);
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const AGENT_ICON = <ThemedSquarePen size={14} uniProps={mutedColorMapping} />;
const TERMINAL_ICON = <ThemedSquareTerminal size={14} uniProps={mutedColorMapping} />;
const BROWSER_ICON = <ThemedGlobe size={14} uniProps={mutedColorMapping} />;

const DRAFT_TARGET: PinnedTabTarget = { kind: "draft" };
const TERMINAL_TARGET: PinnedTabTarget = { kind: "terminal" };
const BROWSER_TARGET: PinnedTabTarget = { kind: "browser" };

function newTabActionButtonStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [styles.newTabActionButton, (hovered || pressed) && styles.newTabActionButtonHovered];
}

function inlineAddActionButtonStyle({ hovered, pressed }: PressableStateCallbackType) {
  return [styles.inlineAddActionButton, (hovered || pressed) && styles.newTabActionButtonHovered];
}

function updateMeasuredWidth(setWidth: Dispatch<SetStateAction<number>>, event: LayoutChangeEvent) {
  const nextWidth = Math.round(event.nativeEvent.layout.width);
  setWidth((current) => (Math.abs(current - nextWidth) > 1 ? nextWidth : current));
}

function updateMeasuredHeight(
  setHeight: Dispatch<SetStateAction<number>>,
  event: LayoutChangeEvent,
) {
  const nextHeight = Math.round(event.nativeEvent.layout.height);
  setHeight((current) => (Math.abs(current - nextHeight) > 1 ? nextHeight : current));
}

function WorkspaceTabPresentationReporter({
  tabId,
  presentation,
  onChange,
}: {
  tabId: string;
  presentation: WorkspaceTabPresentation;
  onChange: (tabId: string, snapshot: WorkspaceTabTreePresentationSnapshot) => void;
}) {
  useEffect(() => {
    onChange(tabId, {
      label: presentation.label,
      titleState: presentation.titleState,
      statusBucket: presentation.statusBucket,
    });
  }, [onChange, presentation.label, presentation.statusBucket, presentation.titleState, tabId]);
  return null;
}

function WorkspaceTabPresentationObserver({
  tab,
  serverId,
  workspaceId,
  onChange,
}: {
  tab: WorkspaceTabDescriptor;
  serverId: string;
  workspaceId: string;
  onChange: (tabId: string, snapshot: WorkspaceTabTreePresentationSnapshot) => void;
}) {
  return (
    <WorkspaceTabPresentationResolver tab={tab} serverId={serverId} workspaceId={workspaceId}>
      {(presentation) => (
        <WorkspaceTabPresentationReporter
          tabId={tab.tabId}
          presentation={presentation}
          onChange={onChange}
        />
      )}
    </WorkspaceTabPresentationResolver>
  );
}

function ProfileLeadingIcon({ iconKey }: { iconKey: string | undefined }) {
  return (
    <View style={styles.terminalProfileIconWrapper}>
      <ProfileIcon iconKey={iconKey} />
    </View>
  );
}

interface PinnableProfileMenuItemProps {
  profile: { id: string; name: string; command: string; args?: string[]; icon?: string };
  disabled?: boolean;
  onLaunch: (target: PinnedTabTarget) => void;
}

function PinnableProfileMenuItem({ profile, disabled, onLaunch }: PinnableProfileMenuItemProps) {
  const target = useMemo<PinnedTabTarget>(
    () => ({ kind: "profile", profileId: profile.id }),
    [profile.id],
  );
  const leading = useMemo(
    () => <ProfileLeadingIcon iconKey={getTerminalProfileIcon(profile)} />,
    [profile],
  );
  const handleSelect = useCallback(() => onLaunch(target), [onLaunch, target]);

  return (
    <PinnableMenuItem
      target={target}
      label={profile.name}
      leading={leading}
      disabled={disabled}
      onSelect={handleSelect}
    />
  );
}

interface WorkspaceInlineAddTabButtonProps {
  shortcutKeys: ShortcutKey[][] | null;
  onCreateAgentTab: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  orientation?: DragOrientation;
}

function WorkspaceInlineAddTabButton({
  shortcutKeys,
  onCreateAgentTab,
  onLayout,
  orientation = "horizontal",
}: WorkspaceInlineAddTabButtonProps) {
  const { t } = useTranslation();
  const tooltipText = t("workspace.tabs.actions.newAgent");

  return (
    <View style={styles.inlineAddButton} onLayout={onLayout}>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger
          testID="workspace-new-agent-tab-inline"
          onPress={onCreateAgentTab}
          accessibilityRole="button"
          accessibilityLabel={tooltipText}
          style={inlineAddActionButtonStyle}
        >
          <ThemedPlus size={14} uniProps={mutedColorMapping} />
        </TooltipTrigger>
        <TooltipContent
          side={orientation === "vertical" ? "top" : "bottom"}
          align="center"
          offset={8}
        >
          <View style={styles.newTabTooltipRow}>
            <Text style={styles.newTabTooltipText}>{tooltipText}</Text>
            {shortcutKeys ? (
              <Shortcut chord={shortcutKeys} style={styles.newTabTooltipShortcut} />
            ) : null}
          </View>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

interface WorkspaceTabRowExtrasProps {
  onCreateAgentTab: () => void;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
  onCreateTerminalWithProfile: (profile: TerminalProfileInput) => void;
  onEditProfiles: () => void;
  normalizedServerId: string;
  showCreateBrowserTab: boolean;
  terminalDisabled: boolean;
  orientation?: DragOrientation;
}

function WorkspaceTabRowExtras({
  onCreateAgentTab,
  onCreateTerminal,
  onCreateBrowser,
  onCreateTerminalWithProfile,
  onEditProfiles,
  normalizedServerId,
  showCreateBrowserTab,
  terminalDisabled,
  orientation = "horizontal",
}: WorkspaceTabRowExtrasProps) {
  const { t } = useTranslation();
  const { config } = useDaemonConfig(normalizedServerId);
  const profiles = useMemo(
    () => resolveTerminalProfiles(config?.terminalProfiles),
    [config?.terminalProfiles],
  );

  const handlers = useMemo<TabTargetHandlers>(
    () => ({
      createDraft: onCreateAgentTab,
      createTerminal: onCreateTerminal,
      createBrowser: onCreateBrowser,
      createTerminalWithProfile: onCreateTerminalWithProfile,
    }),
    [onCreateAgentTab, onCreateBrowser, onCreateTerminal, onCreateTerminalWithProfile],
  );

  const onLaunch = useCallback(
    (target: PinnedTabTarget) => {
      runPinnedTabTarget(target, profiles, handlers);
    },
    [handlers, profiles],
  );

  const launchers = usePinnedLaunchers({ serverId: normalizedServerId, onLaunch });

  return (
    <>
      <DropdownMenu>
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="triggerRef">
            <DropdownMenuTrigger
              testID="workspace-new-tab-menu-trigger"
              accessibilityRole="button"
              accessibilityLabel={t("workspace.tabs.actions.moreActions")}
              style={newTabActionButtonStyle}
            >
              <ThemedChevronDown size={14} uniProps={mutedColorMapping} />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent
            side={orientation === "vertical" ? "top" : "bottom"}
            align="center"
            offset={8}
          >
            <Text style={styles.newTabTooltipText}>{t("workspace.tabs.actions.moreActions")}</Text>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          side={orientation === "vertical" ? "right" : "bottom"}
          align="end"
          offset={4}
          minWidth={200}
        >
          <PinnableMenuItem
            testID="workspace-new-tab-menu-agent"
            target={DRAFT_TARGET}
            label={t("workspace.tabs.actions.newAgent")}
            leading={AGENT_ICON}
            onSelect={onCreateAgentTab}
          />
          <PinnableMenuItem
            testID="workspace-new-tab-menu-terminal"
            target={TERMINAL_TARGET}
            label={t("workspace.tabs.actions.newTerminal")}
            leading={TERMINAL_ICON}
            disabled={terminalDisabled}
            onSelect={terminalDisabled ? undefined : onCreateTerminal}
          />
          {showCreateBrowserTab ? (
            <PinnableMenuItem
              testID="workspace-new-tab-menu-browser"
              target={BROWSER_TARGET}
              label={t("workspace.tabs.actions.newBrowser")}
              leading={BROWSER_ICON}
              onSelect={onCreateBrowser}
            />
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>{t("workspace.tabs.actions.terminalProfilesMenu")}</DropdownMenuLabel>
          {profiles.map((profile) => (
            <PinnableProfileMenuItem
              key={profile.id}
              profile={profile}
              disabled={terminalDisabled}
              onLaunch={onLaunch}
            />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem testID="workspace-new-tab-menu-edit-profiles" onSelect={onEditProfiles}>
            {t("workspace.tabs.actions.editTerminalProfiles")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {orientation === "vertical" ? (
        <ScrollView
          horizontal
          style={styles.railPinnedTargetsScroll}
          contentContainerStyle={styles.railPinnedTargetsContent}
          showsHorizontalScrollIndicator={false}
          testID="workspace-tabs-rail-pinned-scroll"
        >
          <PinnedTargetsRow launchers={launchers} testIdPrefix="workspace-pinned-target" />
        </ScrollView>
      ) : (
        <PinnedTargetsRow launchers={launchers} testIdPrefix="workspace-pinned-target" />
      )}
    </>
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
      case "arrow-up-to-line":
        return <ThemedArrowUpToLine size={16} uniProps={mutedColorMapping} />;
      case "arrow-down-to-line":
        return <ThemedArrowDownToLine size={16} uniProps={mutedColorMapping} />;
      case "arrow-left-to-line":
        return <ThemedArrowLeftToLine size={16} uniProps={mutedColorMapping} />;
      case "arrow-right-to-line":
        return <ThemedArrowRightToLine size={16} uniProps={mutedColorMapping} />;
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

export interface WorkspaceTabTreeDragMetadata {
  parentGroupId: string | null;
  siblingNodes: ReturnType<typeof getWorkspaceTabTreeSiblingNodeOrder>;
}

export interface WorkspaceTabTreeActiveGroupDrag {
  paneId: string;
  groupId: string;
  label: string;
}

export type WorkspaceTabDropIndicator =
  | { kind: "tab"; tabId: string; edge: "before" | "after" }
  | { kind: "group"; groupId: string; edge: "before" | "after" };

interface WorkspaceTabTreePresentationSnapshot {
  label: string;
  titleState: WorkspaceTabPresentation["titleState"];
  statusBucket: SidebarStateBucket | null;
}

interface SplitActionButtonProps {
  onPress: () => void;
  label: string;
  shortcutKeys: ShortcutKey[][] | null;
  icon: "split-right" | "split-down";
  orientation?: DragOrientation;
}

function SplitActionButton({
  onPress,
  label,
  shortcutKeys,
  icon,
  orientation = "horizontal",
}: SplitActionButtonProps) {
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={newTabActionButtonStyle}
      >
        {icon === "split-right" ? (
          <ThemedColumns2 size={14} uniProps={mutedColorMapping} />
        ) : (
          <ThemedRows2 size={14} uniProps={mutedColorMapping} />
        )}
      </TooltipTrigger>
      <TooltipContent
        side={orientation === "vertical" ? "top" : "bottom"}
        align="center"
        offset={8}
      >
        <View style={styles.newTabTooltipRow}>
          <Text style={styles.newTabTooltipText}>{label}</Text>
          {shortcutKeys ? (
            <Shortcut chord={shortcutKeys} style={styles.newTabTooltipShortcut} />
          ) : null}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

export interface WorkspaceDesktopTabsRowProps {
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
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTabsToLeft: (tabId: string, scopedTabs?: WorkspaceTabDescriptor[]) => Promise<void> | void;
  onCloseTabsToRight: (
    tabId: string,
    scopedTabs?: WorkspaceTabDescriptor[],
  ) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onCreateDraftTab: (input: { paneId?: string }) => void;
  onCreateTerminalTab: (input: { paneId?: string; profile?: TerminalProfileInput }) => void;
  onCreateBrowserTab: (input: { paneId?: string }) => void;
  showCreateBrowserTab?: boolean;
  disableCreateTerminal?: boolean;
  isWaitingOnTerminalReadiness?: boolean;
  onReorderTabs: (nextTabs: WorkspaceTabDescriptor[]) => void;
  onSplitRight: () => void;
  onSplitDown: () => void;
  externalDndContext?: boolean;
  activeDragTabId?: string | null;
  activeDragTreeGroup?: WorkspaceTabTreeActiveGroupDrag | null;
  tabDropPreviewIndex?: number | null;
  tabDropIndicator?: WorkspaceTabDropIndicator | null;
  showPaneSplitActions?: boolean;
}

function useWorkspaceTabEdgeReorder(
  tabs: WorkspaceDesktopTabRowItem[],
  onReorderTabs: (nextTabs: WorkspaceTabDescriptor[]) => void,
) {
  const orderedTabs = useMemo(() => tabs.map((item) => item.tab), [tabs]);
  const onMoveTabToStart = useCallback(
    (tabId: string) => {
      const nextTabs = moveWorkspaceTabToEdge(orderedTabs, tabId, "start");
      if (nextTabs !== orderedTabs) {
        onReorderTabs(nextTabs);
      }
    },
    [onReorderTabs, orderedTabs],
  );
  const onMoveTabToEnd = useCallback(
    (tabId: string) => {
      const nextTabs = moveWorkspaceTabToEdge(orderedTabs, tabId, "end");
      if (nextTabs !== orderedTabs) {
        onReorderTabs(nextTabs);
      }
    },
    [onReorderTabs, orderedTabs],
  );
  return { onMoveTabToStart, onMoveTabToEnd };
}

function getFallbackTabLabel(
  tab: WorkspaceTabDescriptor,
  labels: { newAgent: string; setup: string; terminal: string; agent: string },
): string {
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
  return labels.agent;
}

function useWorkspaceTabMenuLabels(): WorkspaceTabMenuLabels {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      copyResumeCommand: t("workspace.tabs.menu.copyResumeCommand"),
      copyAgentId: t("workspace.tabs.menu.copyAgentId"),
      copyFilePath: t("workspace.tabs.menu.copyFilePath"),
      rename: t("workspace.tabs.menu.rename"),
      moveToTop: t("workspace.tabs.menu.moveToTop"),
      moveToBottom: t("workspace.tabs.menu.moveToBottom"),
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

function TabHandleContent({
  presentation,
  displayLabel,
  isHighlighted,
  showLabel,
  tabLabelSkeletonStyle,
  tabLabelStyle,
}: {
  presentation: WorkspaceTabPresentation;
  displayLabel?: string;
  isHighlighted: boolean;
  showLabel: boolean;
  tabLabelSkeletonStyle: React.ComponentProps<typeof View>["style"];
  tabLabelStyle: React.ComponentProps<typeof Text>["style"];
}) {
  const tabHandleDataSet = useMemo(
    () => ({ statusBucket: presentation.statusBucket ?? "none" }),
    [presentation.statusBucket],
  );

  return (
    <View style={styles.tabHandle} dataSet={tabHandleDataSet}>
      <View style={styles.tabIcon}>
        <WorkspaceTabIcon presentation={presentation} active={isHighlighted} />
      </View>
      {showLabel && presentation.titleState === "loading" ? (
        <View style={tabLabelSkeletonStyle} />
      ) : null}
      {showLabel && presentation.titleState !== "loading" ? (
        <Text style={tabLabelStyle} selectable={false} numberOfLines={1} ellipsizeMode="tail">
          {displayLabel ?? presentation.label}
        </Text>
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
  const [hovered, setHovered] = useState(false);
  const isHighlighted = isActive || hovered || isCloseHovered;
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
      orientation === "vertical" ? styles.railTab : styles.tab,
      orientation === "vertical" &&
        inlineUnistylesStyle({ paddingLeft: treeRowPaddingLeft(treeDepth) }),
      isWeb && isDragging && ({ cursor: "grabbing" } as object),
      orientation === "horizontal" && {
        minWidth: resolvedTabWidth,
        width: resolvedTabWidth,
        maxWidth: resolvedTabWidth,
      },
    ],
    [isDragging, orientation, resolvedTabWidth, treeDepth],
  );

  const handleTabHoverIn = useCallback(() => {
    setHovered(true);
  }, []);

  const handleTabHoverOut = useCallback(() => {
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

  const closeButtonStyle = useCallback(
    ({ hovered: isButtonHovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.tabCloseButton,
      styles.tabCloseButtonShown,
      (Boolean(isButtonHovered) || pressed) && styles.tabCloseButtonActive,
    ],
    [],
  );

  const tabAccessibilityState = useMemo(() => ({ selected: isActive }), [isActive]);
  const tabFocusIndicatorStyle = useMemo(
    () => [
      orientation === "vertical" ? styles.railTabFocusIndicator : styles.tabFocusIndicator,
      !isFocused && styles.tabFocusIndicatorUnfocused,
    ],
    [isFocused, orientation],
  );
  const tabLabelSkeletonStyle = useMemo(
    () => [styles.tabLabelSkeleton, showCloseButton && styles.tabLabelSkeletonWithCloseButton],
    [showCloseButton],
  );
  const tabLabelStyle = useMemo(
    () => [
      styles.tabLabel,
      isHighlighted && styles.tabLabelActive,
      showCloseButton && styles.tabLabelWithCloseButton,
    ],
    [isHighlighted, showCloseButton],
  );

  return (
    <View ref={middleClickRef}>
      <ContextMenu key={tab.key}>
        <Tooltip delayDuration={400} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="triggerRef">
            <ContextMenuTrigger
              {...(dragHandleProps?.attributes as object | undefined)}
              {...(dragHandleProps?.listeners as object | undefined)}
              testID={`workspace-tab-${buildDeterministicWorkspaceTabId(tab.target)}`}
              triggerRef={dragHandleProps?.setActivatorNodeRef as unknown as undefined}
              enabledOnMobile={false}
              style={tabChipStyle}
              onHoverIn={handleTabHoverIn}
              onHoverOut={handleTabHoverOut}
              onPressIn={handleNavigateTab}
              onPress={handleNavigateTab}
              accessibilityRole="button"
              accessibilityLabel={tooltipLabel}
              accessibilityState={tabAccessibilityState}
              aria-selected={isActive}
            >
              {orientation === "vertical" ? <TreeIndentGuides depth={treeDepth} /> : null}
              {isActive && <View style={tabFocusIndicatorStyle} />}
              <TabHandleContent
                presentation={presentation}
                displayLabel={displayLabel}
                isHighlighted={isHighlighted}
                showLabel={showLabel}
                tabLabelSkeletonStyle={tabLabelSkeletonStyle}
                tabLabelStyle={tabLabelStyle}
              />

              {showCloseButton ? (
                <Pressable
                  {...(closeButtonDragBlockers as object | undefined)}
                  testID={closeButtonTestId}
                  disabled={isClosingTab}
                  onPressIn={handleCloseButtonPressIn}
                  onHoverIn={handleCloseButtonHoverIn}
                  onHoverOut={handleCloseButtonHoverOut}
                  onPress={handleCloseButtonPress}
                  style={closeButtonStyle}
                >
                  {({ hovered: closeHovered, pressed }) =>
                    isClosingTab ? (
                      <ThemedActivityIndicator
                        size={12}
                        uniProps={
                          closeHovered || pressed ? foregroundColorMapping : mutedColorMapping
                        }
                      />
                    ) : (
                      <ThemedX
                        size={12}
                        uniProps={
                          closeHovered || pressed ? foregroundColorMapping : mutedColorMapping
                        }
                      />
                    )
                  }
                </Pressable>
              ) : null}
            </ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent
            side={orientation === "vertical" ? "right" : "bottom"}
            align="center"
            offset={8}
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

        <ContextMenuContent
          side={orientation === "vertical" ? "right" : "bottom"}
          align="start"
          width={DROPDOWN_WIDTH}
          testID={contextMenuTestId}
        >
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

export function WorkspaceDesktopTabsRow({
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
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  onCreateDraftTab,
  onCreateTerminalTab,
  onCreateBrowserTab,
  showCreateBrowserTab = false,
  disableCreateTerminal = false,
  isWaitingOnTerminalReadiness = false,
  onReorderTabs,
  onSplitRight,
  onSplitDown,
  externalDndContext = false,
  activeDragTabId = null,
  tabDropPreviewIndex = null,
  tabDropIndicator = null,
  showPaneSplitActions = true,
}: WorkspaceDesktopTabsRowProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const newTabKeys = useShortcutKeys("workspace-tab-new");
  const splitRightKeys = useShortcutKeys("workspace-pane-split-right");
  const splitDownKeys = useShortcutKeys("workspace-pane-split-down");
  const [tabsContainerWidth, setTabsContainerWidth] = useState<number>(0);
  const [tabsActionsWidth, setTabsActionsWidth] = useState<number>(0);
  const [inlineAddButtonWidth, setInlineAddButtonWidth] = useState<number>(0);
  const tabsScrollRef = useRef<ScrollView>(null);
  const tabsScrollOffsetRef = useRef(0);

  const handleTabsContainerLayout = useCallback((event: LayoutChangeEvent) => {
    updateMeasuredWidth(setTabsContainerWidth, event);
  }, []);

  const handleTabsActionsLayout = useCallback((event: LayoutChangeEvent) => {
    updateMeasuredWidth(setTabsActionsWidth, event);
  }, []);

  const handleInlineAddButtonLayout = useCallback((event: LayoutChangeEvent) => {
    updateMeasuredWidth(setInlineAddButtonWidth, event);
  }, []);

  const layoutMetrics = useMemo(
    () => ({
      rowHorizontalInset: 0,
      actionsReservedWidth: Math.max(
        0,
        tabsActionsWidth + (inlineAddButtonWidth || DEFAULT_INLINE_ADD_BUTTON_RESERVED_WIDTH),
      ),
      rowPaddingHorizontal: 0,
      tabGap: 0,
      maxTabWidth: 200,
      tabIconWidth: 14,
      tabHorizontalPadding: 12,
      estimatedCharWidth: 7,
      minimumLabelCharacters: 4,
      closeButtonWidth: 22,
    }),
    [inlineAddButtonWidth, tabsActionsWidth],
  );

  const fallbackTabLabels = useMemo(
    () => ({
      newAgent: t("workspace.tabs.fallback.newAgent"),
      setup: t("workspace.tabs.fallback.setup"),
      terminal: t("workspace.tabs.fallback.terminal"),
      agent: t("workspace.tabs.fallback.agent"),
    }),
    [t],
  );
  const tabMenuLabels = useWorkspaceTabMenuLabels();
  const { onMoveTabToStart, onMoveTabToEnd } = useWorkspaceTabEdgeReorder(tabs, onReorderTabs);
  const tabLabelLengths = useMemo(
    () =>
      tabs.map((tab) => {
        const label = getFallbackTabLabel(tab.tab, fallbackTabLabels);
        return label.length;
      }),
    [fallbackTabLabels, tabs],
  );

  const { layout } = useWorkspaceTabLayout({
    tabLabelLengths,
    viewportWidthOverride: tabsContainerWidth > 0 ? tabsContainerWidth : null,
    metrics: layoutMetrics,
  });
  useHorizontalWheelScroll(tabsScrollRef, layout.requiresHorizontalScrollFallback);
  const activeDragSortableId = useMemo(
    () => resolveActiveSortableTabId(tabs, activeDragTabId),
    [activeDragTabId, tabs],
  );

  const activeTabIndex = useMemo(() => tabs.findIndex((tab) => tab.isActive), [tabs]);
  const activeTabId = activeTabIndex >= 0 ? (tabs[activeTabIndex]?.tab.tabId ?? null) : null;
  const tabsViewportWidth = Math.max(0, tabsContainerWidth - tabsActionsWidth);
  const tabsContentWidth = useMemo(
    () =>
      layout.items.reduce((total, item) => total + item.width, 0) +
      (inlineAddButtonWidth || DEFAULT_INLINE_ADD_BUTTON_RESERVED_WIDTH),
    [inlineAddButtonWidth, layout.items],
  );
  const activeTabStart = useMemo(
    () =>
      activeTabIndex < 0
        ? null
        : layout.items.slice(0, activeTabIndex).reduce((total, item) => total + item.width, 0),
    [activeTabIndex, layout.items],
  );
  const activeTabEnd =
    activeTabStart === null ? null : activeTabStart + (layout.items[activeTabIndex]?.width ?? 0);

  const handleTabsScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    tabsScrollOffsetRef.current = event.nativeEvent.contentOffset.x;
  }, []);

  useEffect(() => {
    const scrollView = tabsScrollRef.current;
    if (!scrollView) return;

    if (!layout.requiresHorizontalScrollFallback) {
      if (tabsScrollOffsetRef.current !== 0) {
        tabsScrollOffsetRef.current = 0;
        scrollView.scrollTo({ x: 0, y: 0, animated: false });
      }
      return;
    }

    if (
      !activeTabId ||
      activeTabStart === null ||
      activeTabEnd === null ||
      tabsViewportWidth <= 0
    ) {
      return;
    }
    const nextOffset = getWorkspaceTabRevealOffset({
      currentOffset: tabsScrollOffsetRef.current,
      viewportWidth: tabsViewportWidth,
      contentWidth: tabsContentWidth,
      itemStart: activeTabStart,
      itemEnd: activeTabEnd,
    });
    if (Math.abs(nextOffset - tabsScrollOffsetRef.current) <= 1) return;

    tabsScrollOffsetRef.current = nextOffset;
    scrollView.scrollTo({ x: nextOffset, y: 0, animated: false });
  }, [
    activeTabEnd,
    activeTabId,
    activeTabStart,
    layout.requiresHorizontalScrollFallback,
    tabsContentWidth,
    tabsViewportWidth,
  ]);

  const handleDragEnd = useCallback(
    (nextTabs: WorkspaceDesktopTabRowItem[]) => {
      onReorderTabs(nextTabs.map((tab) => tab.tab));
    },
    [onReorderTabs],
  );

  const getTabDragData = useMemo(() => {
    if (!paneId) return undefined;
    return (tab: WorkspaceDesktopTabRowItem) => ({
      kind: "workspace-tab" as const,
      orientation: "horizontal" as const,
      paneId,
      tabId: tab.tab.tabId,
    });
  }, [paneId]);

  const handleCreateAgentTab = useCallback(() => {
    onCreateDraftTab({ paneId });
  }, [onCreateDraftTab, paneId]);

  const handleCreateTerminal = useCallback(() => {
    onCreateTerminalTab({ paneId });
  }, [onCreateTerminalTab, paneId]);

  const handleCreateTerminalWithProfile = useCallback(
    (profile: TerminalProfileInput) => {
      onCreateTerminalTab({ paneId, profile });
    },
    [onCreateTerminalTab, paneId],
  );

  const handleEditProfiles = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(normalizedServerId, "terminals") as Href);
  }, [normalizedServerId, router]);

  const handleCreateBrowser = useCallback(() => {
    onCreateBrowserTab({ paneId });
  }, [onCreateBrowserTab, paneId]);

  const terminalDisabled = disableCreateTerminal || isWaitingOnTerminalReadiness;

  const renderTab = useCallback(
    ({
      item,
      index,
      dragHandleProps,
      isActive,
    }: DraggableRenderItemInfo<WorkspaceDesktopTabRowItem>) => {
      const shouldShowCloseButton = layout.closeButtonPolicy === "all";
      const layoutItem = layout.items[index] ?? null;
      const resolvedTabWidth = layoutItem?.width ?? 150;
      const showLabel = layoutItem?.showLabel ?? true;
      const showDropIndicatorBefore =
        activeDragTabId !== null &&
        (tabDropIndicator?.kind === "tab"
          ? tabDropIndicator.tabId === item.tab.tabId && tabDropIndicator.edge === "before"
          : tabDropPreviewIndex === index);
      const showDropIndicatorAfter =
        activeDragTabId !== null &&
        (tabDropIndicator?.kind === "tab"
          ? tabDropIndicator.tabId === item.tab.tabId && tabDropIndicator.edge === "after"
          : tabDropPreviewIndex === tabs.length && index === tabs.length - 1);

      return (
        <ResolvedDesktopTabChip
          key={`${item.tab.key}:${item.tab.kind}`}
          item={item}
          isFocused={isFocused}
          isDragging={isActive}
          index={index}
          tabCount={tabs.length}
          normalizedServerId={normalizedServerId}
          normalizedWorkspaceId={normalizedWorkspaceId}
          onCopyResumeCommand={onCopyResumeCommand}
          onCopyAgentId={onCopyAgentId}
          onCopyFilePath={onCopyFilePath}
          onReloadAgent={onReloadAgent}
          onRenameTab={onRenameTab}
          onCloseTabsToLeft={onCloseTabsToLeft}
          onCloseTabsToRight={onCloseTabsToRight}
          onCloseOtherTabs={onCloseOtherTabs}
          onMoveTabToStart={onMoveTabToStart}
          onMoveTabToEnd={onMoveTabToEnd}
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
      normalizedServerId,
      normalizedWorkspaceId,
      onCloseOtherTabs,
      onCloseTab,
      onCloseTabsToLeft,
      onCloseTabsToRight,
      onCopyAgentId,
      onCopyFilePath,
      onCopyResumeCommand,
      onNavigateTab,
      onReloadAgent,
      onRenameTab,
      onMoveTabToStart,
      onMoveTabToEnd,
      setHoveredCloseTabKey,
      tabMenuLabels,
      tabDropPreviewIndex,
      tabDropIndicator,
      tabs.length,
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
      <ScrollView
        ref={tabsScrollRef}
        horizontal
        scrollEnabled={layout.requiresHorizontalScrollFallback}
        onScroll={handleTabsScroll}
        scrollEventThrottle={16}
        testID="workspace-tabs-scroll"
        style={tabsScrollStyle}
        contentContainerStyle={styles.tabsContent}
        showsHorizontalScrollIndicator={false}
      >
        <SortableInlineList
          data={tabs}
          keyExtractor={tabKeyExtractor}
          useDragHandle
          disabled={!externalDndContext && tabs.length < 2}
          onDragEnd={handleDragEnd}
          externalDndContext={externalDndContext}
          activeId={activeDragSortableId}
          getItemData={getTabDragData}
          renderItem={renderTab}
        />
        <WorkspaceInlineAddTabButton
          shortcutKeys={newTabKeys}
          onCreateAgentTab={handleCreateAgentTab}
          onLayout={handleInlineAddButtonLayout}
        />
      </ScrollView>
      <View style={styles.tabsActions} onLayout={handleTabsActionsLayout}>
        <WorkspaceTabRowExtras
          onCreateAgentTab={handleCreateAgentTab}
          onCreateTerminal={handleCreateTerminal}
          onCreateBrowser={handleCreateBrowser}
          onCreateTerminalWithProfile={handleCreateTerminalWithProfile}
          onEditProfiles={handleEditProfiles}
          normalizedServerId={normalizedServerId}
          showCreateBrowserTab={showCreateBrowserTab}
          terminalDisabled={terminalDisabled}
        />
        {showPaneSplitActions ? (
          <>
            <SplitActionButton
              icon="split-right"
              onPress={onSplitRight}
              label={t("workspace.tabs.actions.splitRight")}
              shortcutKeys={splitRightKeys}
            />
            <SplitActionButton
              icon="split-down"
              onPress={onSplitDown}
              label={t("workspace.tabs.actions.splitDown")}
              shortcutKeys={splitDownKeys}
            />
          </>
        ) : null}
      </View>
    </View>
  );

  return <RenderProfile id="WorkspaceDesktopTabsRow">{row}</RenderProfile>;
}

function getWorkspaceTabTreeGroupStatus(
  group: WorkspaceTabTreeGroup,
  presentations: ReadonlyMap<string, WorkspaceTabTreePresentationSnapshot>,
): SidebarStateBucket | null {
  let resolved: SidebarStateBucket | null = null;
  for (const tabId of group.descendantTabIds) {
    const candidate = presentations.get(tabId)?.statusBucket ?? null;
    if (!candidate || candidate === "done") continue;
    if (
      !resolved ||
      getWorkspaceStateBucketPriority(candidate) < getWorkspaceStateBucketPriority(resolved)
    ) {
      resolved = candidate;
    }
  }
  return resolved;
}

function resolveWorkspaceTabTreeGroupDropIndicator(
  hasActiveDrag: boolean,
  indicator: WorkspaceTabDropIndicator | null,
  groupId: string,
): Extract<WorkspaceTabDropIndicator, { kind: "group" }> | null {
  if (!hasActiveDrag || indicator?.kind !== "group" || indicator.groupId !== groupId) return null;
  return indicator;
}

function hasWorkspaceTabTreeLeafDropIndicator(
  hasActiveDrag: boolean,
  indicator: WorkspaceTabDropIndicator | null,
  tabId: string,
  edge: "before" | "after",
): boolean {
  return (
    hasActiveDrag &&
    indicator?.kind === "tab" &&
    indicator.tabId === tabId &&
    indicator.edge === edge
  );
}

function workspaceTabTreeGroupRowStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.railTreeGroupRow, (Boolean(hovered) || pressed) && styles.railTreeGroupRowActive];
}

function WorkspaceTabTreeGroupRow({
  row,
  paneId,
  isFocused,
  hasActiveDescendant,
  statusBucket,
  dropIndicator,
  dragHandleProps,
  canMoveToStart,
  canMoveToEnd,
  onMoveToStart,
  onMoveToEnd,
  onToggle,
}: {
  row: Extract<WorkspaceTabTreeRow, { kind: "group" }>;
  paneId?: string;
  isFocused: boolean;
  hasActiveDescendant: boolean;
  statusBucket: SidebarStateBucket | null;
  dropIndicator: Extract<WorkspaceTabDropIndicator, { kind: "group" }> | null;
  dragHandleProps: DraggableListDragHandleProps | undefined;
  canMoveToStart: boolean;
  canMoveToEnd: boolean;
  onMoveToStart: (groupId: string) => void;
  onMoveToEnd: (groupId: string) => void;
  onToggle: (groupId: string) => void;
}) {
  const { t } = useTranslation();
  const { setNodeRef } = useDroppable({
    id: `workspace-tab-tree-group-drop:${paneId ?? "none"}:${row.group.id}`,
    disabled: !paneId,
    data: {
      kind: "workspace-tab-tree-group",
      paneId,
      groupId: row.group.id,
      parentGroupId: row.group.parentGroupId,
    },
  });
  const handlePress = useCallback(() => onToggle(row.group.id), [onToggle, row.group.id]);
  const handleMoveToStart = useCallback(
    () => onMoveToStart(row.group.id),
    [onMoveToStart, row.group.id],
  );
  const handleMoveToEnd = useCallback(() => onMoveToEnd(row.group.id), [onMoveToEnd, row.group.id]);
  const moveToStartIcon = useMemo(
    () => <ThemedArrowUpToLine size={16} uniProps={mutedColorMapping} />,
    [],
  );
  const moveToEndIcon = useMemo(
    () => <ThemedArrowDownToLine size={16} uniProps={mutedColorMapping} />,
    [],
  );
  const accessibilityState = useMemo(() => ({ expanded: !row.collapsed }), [row.collapsed]);
  const leftStyle = useMemo(
    () => [
      styles.railTreeGroupContent,
      inlineUnistylesStyle({ paddingLeft: treeRowPaddingLeft(row.depth) }),
    ],
    [row.depth],
  );
  const presentation = useMemo<WorkspaceTabPresentation>(
    () => ({
      key: row.group.id,
      kind: "agent",
      label: row.group.label,
      subtitle: row.group.path,
      titleState: "ready",
      icon: Folder,
      statusBucket: row.collapsed ? statusBucket : null,
    }),
    [row.collapsed, row.group.id, row.group.label, row.group.path, statusBucket],
  );
  const focusIndicatorStyle = useMemo(
    () => [styles.railTabFocusIndicator, !isFocused && styles.tabFocusIndicatorUnfocused],
    [isFocused],
  );

  return (
    <View ref={setNodeRef as unknown as Ref<View>} style={styles.railTreeGroupSlot}>
      {dropIndicator?.edge === "before" ? (
        <View style={RAIL_TAB_DROP_INDICATOR_BEFORE_STYLE} />
      ) : null}
      <ContextMenu>
        <ContextMenuTrigger
          {...(dragHandleProps?.attributes as object | undefined)}
          {...(dragHandleProps?.listeners as object | undefined)}
          testID={`workspace-tab-group-${encodeURIComponent(row.group.path)}`}
          triggerRef={dragHandleProps?.setActivatorNodeRef as unknown as undefined}
          enabledOnMobile={false}
          onPress={handlePress}
          style={workspaceTabTreeGroupRowStyle}
          accessibilityRole="button"
          accessibilityLabel={row.group.path}
          accessibilityState={accessibilityState}
        >
          <TreeIndentGuides depth={row.depth} />
          {row.collapsed && hasActiveDescendant ? <View style={focusIndicatorStyle} /> : null}
          <View style={leftStyle}>
            <TreeChevron expanded={!row.collapsed} />
            <View style={styles.railTreeGroupIcon}>
              <WorkspaceTabIcon
                presentation={presentation}
                active={row.collapsed && hasActiveDescendant}
              />
            </View>
            <Text style={styles.railTreeGroupLabel} numberOfLines={1} ellipsizeMode="tail">
              {row.group.label}
            </Text>
            <Text style={styles.railTreeGroupCount}>{row.group.descendantTabIds.length}</Text>
          </View>
        </ContextMenuTrigger>
        <ContextMenuContent side="right" align="start" width={DROPDOWN_WIDTH}>
          <ContextMenuItem
            testID={`workspace-tab-group-${encodeURIComponent(row.group.path)}-move-to-top`}
            disabled={!canMoveToStart}
            onSelect={handleMoveToStart}
            leading={moveToStartIcon}
          >
            {t("workspace.tabs.menu.moveToTop")}
          </ContextMenuItem>
          <ContextMenuItem
            testID={`workspace-tab-group-${encodeURIComponent(row.group.path)}-move-to-bottom`}
            disabled={!canMoveToEnd}
            onSelect={handleMoveToEnd}
            leading={moveToEndIcon}
          >
            {t("workspace.tabs.menu.moveToBottom")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {dropIndicator?.edge === "after" ? (
        <View style={RAIL_TAB_DROP_INDICATOR_AFTER_STYLE} />
      ) : null}
    </View>
  );
}

function WorkspaceTabTreeToggleAllButton({
  allCollapsed,
  onPress,
}: {
  allCollapsed: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const label = allCollapsed
    ? t("workspace.tabs.actions.expandAllGroups")
    : t("workspace.tabs.actions.collapseAllGroups");
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        testID="workspace-tabs-rail-toggle-all-groups"
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={newTabActionButtonStyle}
      >
        {allCollapsed ? (
          <ThemedListChevronsUpDown size={14} uniProps={mutedColorMapping} />
        ) : (
          <ThemedListChevronsDownUp size={14} uniProps={mutedColorMapping} />
        )}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.newTabTooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export function WorkspaceDesktopTabsRail({
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
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  onCreateDraftTab,
  onCreateTerminalTab,
  onCreateBrowserTab,
  showCreateBrowserTab = false,
  disableCreateTerminal = false,
  isWaitingOnTerminalReadiness = false,
  onReorderTabs,
  onSplitRight,
  onSplitDown,
  externalDndContext = false,
  activeDragTabId = null,
  activeDragTreeGroup = null,
  tabDropIndicator = null,
  showPaneSplitActions = true,
}: WorkspaceDesktopTabsRowProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const newTabKeys = useShortcutKeys("workspace-tab-new");
  const splitRightKeys = useShortcutKeys("workspace-pane-split-right");
  const splitDownKeys = useShortcutKeys("workspace-pane-split-down");
  const tabMenuLabels = useWorkspaceTabMenuLabels();
  const railScrollRef = useRef<ScrollView>(null);
  const railScrollOffsetRef = useRef(0);
  const [railViewportHeight, setRailViewportHeight] = useState(0);
  const [railContentHeight, setRailContentHeight] = useState(0);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const [treePresentations, setTreePresentations] = useState<
    Map<string, WorkspaceTabTreePresentationSnapshot>
  >(() => new Map());
  const fallbackLabels = useMemo(
    () => ({
      newAgent: t("workspace.tabs.fallback.newAgent"),
      setup: t("workspace.tabs.fallback.setup"),
      terminal: t("workspace.tabs.fallback.terminal"),
      agent: t("workspace.tabs.fallback.agent"),
    }),
    [t],
  );
  const handlePresentationChange = useCallback(
    (tabId: string, snapshot: WorkspaceTabTreePresentationSnapshot) => {
      setTreePresentations((current) => {
        const previous = current.get(tabId);
        if (
          previous?.label === snapshot.label &&
          previous.titleState === snapshot.titleState &&
          previous.statusBucket === snapshot.statusBucket
        ) {
          return current;
        }
        const next = new Map(current);
        next.set(tabId, snapshot);
        return next;
      });
    },
    [],
  );
  const sourceTabIds = useMemo(() => tabs.map((item) => item.tab.tabId), [tabs]);
  const tabItemsById = useMemo(() => new Map(tabs.map((item) => [item.tab.tabId, item])), [tabs]);
  const treeModel = useMemo(
    () =>
      buildWorkspaceTabTree(
        tabs.map((item) => {
          const presentation = treePresentations.get(item.tab.tabId);
          const label =
            presentation?.titleState === "ready" && presentation.label
              ? presentation.label
              : getFallbackTabLabel(item.tab, fallbackLabels);
          const pathLabel =
            (item.tab.kind === "agent" || item.tab.kind === "terminal") &&
            presentation?.titleState === "ready"
              ? presentation.label
              : null;
          return { tabId: item.tab.tabId, label, pathLabel };
        }),
      ),
    [fallbackLabels, tabs, treePresentations],
  );
  const treeRows = useMemo(
    () => projectWorkspaceTabTree(treeModel, collapsedGroupIds),
    [collapsedGroupIds, treeModel],
  );
  const activeDragSortableId = useMemo(() => {
    if (activeDragTabId && treeModel.leavesByTabId.has(activeDragTabId)) {
      return getWorkspaceTabTreeLeafNodeId(activeDragTabId);
    }
    if (!activeDragTreeGroup || activeDragTreeGroup.paneId !== paneId) return null;
    const activeGroupId = activeDragTreeGroup.groupId;
    const groupRow = treeRows.find((row) => row.kind === "group" && row.group.id === activeGroupId);
    return groupRow ? getWorkspaceTabTreeRowSortableId(groupRow, paneId) : null;
  }, [activeDragTabId, activeDragTreeGroup, paneId, treeModel.leavesByTabId, treeRows]);
  const treeRowKeyExtractor = useCallback(
    (row: WorkspaceTabTreeRow) => getWorkspaceTabTreeRowSortableId(row, paneId),
    [paneId],
  );

  const activeTabId = useMemo(() => tabs.find((tab) => tab.isActive)?.tab.tabId ?? null, [tabs]);
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
    updateMeasuredHeight(setRailViewportHeight, event);
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
    const liveTabIds = new Set(sourceTabIds);
    setTreePresentations((current) => {
      if ([...current.keys()].every((tabId) => liveTabIds.has(tabId))) return current;
      return new Map([...current].filter(([tabId]) => liveTabIds.has(tabId)));
    });
  }, [sourceTabIds]);

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
    const ancestors = new Set(getWorkspaceTabTreeAncestorGroupIds(treeModel, activeTabId));
    if (ancestors.size === 0) return;
    setCollapsedGroupIds((current) => {
      if (![...ancestors].some((groupId) => current.has(groupId))) return current;
      const next = new Set(current);
      for (const groupId of ancestors) next.delete(groupId);
      return next;
    });
  }, [activeTabId, treeModel]);

  const allGroupsCollapsed = useMemo(
    () =>
      treeModel.groupIds.length > 0 &&
      treeModel.groupIds.every((groupId) => collapsedGroupIds.has(groupId)),
    [collapsedGroupIds, treeModel.groupIds],
  );
  const handleToggleAllGroups = useCallback(() => {
    setCollapsedGroupIds((current) =>
      treeModel.groupIds.every((groupId) => current.has(groupId))
        ? new Set()
        : new Set(treeModel.groupIds),
    );
  }, [treeModel.groupIds]);
  const handleToggleGroup = useCallback((groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const descriptorsForTabIds = useCallback(
    (tabIds: readonly string[]) =>
      tabIds
        .map((tabId) => tabItemsById.get(tabId)?.tab)
        .filter((tab): tab is WorkspaceTabDescriptor => Boolean(tab)),
    [tabItemsById],
  );
  const handleCloseTreeTabsBefore = useCallback(
    (tabId: string) => {
      const siblings = getWorkspaceTabTreeSiblingLeafIds(treeModel, tabId);
      return onCloseTabsToLeft(tabId, descriptorsForTabIds(siblings));
    },
    [descriptorsForTabIds, onCloseTabsToLeft, treeModel],
  );
  const handleCloseTreeTabsAfter = useCallback(
    (tabId: string) => {
      const siblings = getWorkspaceTabTreeSiblingLeafIds(treeModel, tabId);
      return onCloseTabsToRight(tabId, descriptorsForTabIds(siblings));
    },
    [descriptorsForTabIds, onCloseTabsToRight, treeModel],
  );
  const reorderTreeTabToEdge = useCallback(
    (tabId: string, edge: "start" | "end") => {
      const nextTabIds = moveWorkspaceTabTreeLeafToSiblingEdge(
        sourceTabIds,
        treeModel,
        tabId,
        edge,
      );
      if (nextTabIds !== sourceTabIds) onReorderTabs(descriptorsForTabIds(nextTabIds));
    },
    [descriptorsForTabIds, onReorderTabs, sourceTabIds, treeModel],
  );
  const handleMoveTreeTabToStart = useCallback(
    (tabId: string) => reorderTreeTabToEdge(tabId, "start"),
    [reorderTreeTabToEdge],
  );
  const handleMoveTreeTabToEnd = useCallback(
    (tabId: string) => reorderTreeTabToEdge(tabId, "end"),
    [reorderTreeTabToEdge],
  );
  const reorderTreeGroupToEdge = useCallback(
    (groupId: string, edge: "start" | "end") => {
      const nextTabIds = moveWorkspaceTabTreeGroupToSiblingEdge(
        sourceTabIds,
        treeModel,
        groupId,
        edge,
      );
      if (nextTabIds !== sourceTabIds) onReorderTabs(descriptorsForTabIds(nextTabIds));
    },
    [descriptorsForTabIds, onReorderTabs, sourceTabIds, treeModel],
  );
  const handleMoveTreeGroupToStart = useCallback(
    (groupId: string) => reorderTreeGroupToEdge(groupId, "start"),
    [reorderTreeGroupToEdge],
  );
  const handleMoveTreeGroupToEnd = useCallback(
    (groupId: string) => reorderTreeGroupToEdge(groupId, "end"),
    [reorderTreeGroupToEdge],
  );

  const handleDragEnd = useCallback((_nextRows: WorkspaceTabTreeRow[]) => {
    // Vertical tree reorder is applied by the enclosing split DnD context,
    // which has the active/over IDs needed to enforce same-parent ordering.
  }, []);

  const getTreeRowDragData = useMemo(() => {
    if (!paneId) return undefined;
    return (row: WorkspaceTabTreeRow) => {
      if (row.kind === "group") {
        return {
          kind: "workspace-tab-tree-group-drag",
          paneId,
          groupId: row.group.id,
          label: row.group.path,
          tree: {
            parentGroupId: row.group.parentGroupId,
            siblingNodes: getWorkspaceTabTreeGroupSiblingNodeOrder(treeModel, row.group.id),
          } satisfies WorkspaceTabTreeDragMetadata,
        };
      }
      return {
        kind: "workspace-tab" as const,
        orientation: "vertical" as const,
        paneId,
        tabId: row.leaf.tabId,
        tree: {
          parentGroupId: row.leaf.parentGroupId,
          siblingNodes: getWorkspaceTabTreeSiblingNodeOrder(treeModel, row.leaf.tabId),
        } satisfies WorkspaceTabTreeDragMetadata,
      };
    };
  }, [paneId, treeModel]);

  const handleCreateAgentTab = useCallback(() => {
    onCreateDraftTab({ paneId });
  }, [onCreateDraftTab, paneId]);

  const handleCreateTerminal = useCallback(() => {
    onCreateTerminalTab({ paneId });
  }, [onCreateTerminalTab, paneId]);

  const handleCreateTerminalWithProfile = useCallback(
    (profile: TerminalProfileInput) => {
      onCreateTerminalTab({ paneId, profile });
    },
    [onCreateTerminalTab, paneId],
  );

  const handleEditProfiles = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(normalizedServerId, "terminals") as Href);
  }, [normalizedServerId, router]);

  const handleCreateBrowser = useCallback(() => {
    onCreateBrowserTab({ paneId });
  }, [onCreateBrowserTab, paneId]);

  const terminalDisabled = disableCreateTerminal || isWaitingOnTerminalReadiness;
  const hasActiveDrag = activeDragTabId !== null || activeDragTreeGroup !== null;

  const renderTreeRow = useCallback(
    ({ item: row, dragHandleProps, isActive }: DraggableRenderItemInfo<WorkspaceTabTreeRow>) => {
      if (row.kind === "group") {
        const siblingNodes = getWorkspaceTabTreeGroupSiblingNodeOrder(treeModel, row.group.id);
        const groupIndex = siblingNodes.findIndex((node) => node.id === row.group.id);
        return (
          <WorkspaceTabTreeGroupRow
            row={row}
            paneId={paneId}
            isFocused={isFocused}
            hasActiveDescendant={Boolean(
              activeTabId && row.group.descendantTabIds.includes(activeTabId),
            )}
            statusBucket={getWorkspaceTabTreeGroupStatus(row.group, treePresentations)}
            dropIndicator={resolveWorkspaceTabTreeGroupDropIndicator(
              hasActiveDrag,
              tabDropIndicator,
              row.group.id,
            )}
            dragHandleProps={dragHandleProps}
            canMoveToStart={groupIndex > 0}
            canMoveToEnd={groupIndex >= 0 && groupIndex < siblingNodes.length - 1}
            onMoveToStart={handleMoveTreeGroupToStart}
            onMoveToEnd={handleMoveTreeGroupToEnd}
            onToggle={handleToggleGroup}
          />
        );
      }

      const item = tabItemsById.get(row.leaf.tabId);
      if (!item) return <View />;
      const siblingTabIds = getWorkspaceTabTreeSiblingLeafIds(treeModel, row.leaf.tabId);
      const siblingNodes = getWorkspaceTabTreeSiblingNodeOrder(treeModel, row.leaf.tabId);
      const siblingIndex = siblingTabIds.indexOf(row.leaf.tabId);
      const orderingIndex = siblingNodes.findIndex(
        (node) => node.id === getWorkspaceTabTreeLeafNodeId(row.leaf.tabId),
      );
      const showDropIndicatorBefore = hasWorkspaceTabTreeLeafDropIndicator(
        hasActiveDrag,
        tabDropIndicator,
        row.leaf.tabId,
        "before",
      );
      const showDropIndicatorAfter = hasWorkspaceTabTreeLeafDropIndicator(
        hasActiveDrag,
        tabDropIndicator,
        row.leaf.tabId,
        "after",
      );

      return (
        <ResolvedDesktopTabChip
          key={`${item.tab.key}:${item.tab.kind}`}
          item={item}
          isFocused={isFocused}
          isDragging={isActive}
          index={siblingIndex}
          tabCount={siblingTabIds.length}
          orderingIndex={orderingIndex}
          orderingItemCount={siblingNodes.length}
          totalTabCount={tabs.length}
          normalizedServerId={normalizedServerId}
          normalizedWorkspaceId={normalizedWorkspaceId}
          onCopyResumeCommand={onCopyResumeCommand}
          onCopyAgentId={onCopyAgentId}
          onCopyFilePath={onCopyFilePath}
          onReloadAgent={onReloadAgent}
          onRenameTab={onRenameTab}
          onCloseTabsToLeft={handleCloseTreeTabsBefore}
          onCloseTabsToRight={handleCloseTreeTabsAfter}
          onCloseOtherTabs={onCloseOtherTabs}
          onMoveTabToStart={handleMoveTreeTabToStart}
          onMoveTabToEnd={handleMoveTreeTabToEnd}
          resolvedTabWidth={WORKSPACE_TAB_RAIL_WIDTH}
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
          onPresentationChange={handlePresentationChange}
        />
      );
    },
    [
      activeTabId,
      handleCloseTreeTabsAfter,
      handleCloseTreeTabsBefore,
      handleMoveTreeTabToEnd,
      handleMoveTreeTabToStart,
      handleMoveTreeGroupToEnd,
      handleMoveTreeGroupToStart,
      handlePresentationChange,
      handleToggleGroup,
      hasActiveDrag,
      isFocused,
      normalizedServerId,
      normalizedWorkspaceId,
      onCloseOtherTabs,
      onCloseTab,
      onCopyAgentId,
      onCopyFilePath,
      onCopyResumeCommand,
      onNavigateTab,
      onReloadAgent,
      onRenameTab,
      paneId,
      setHoveredCloseTabKey,
      tabDropIndicator,
      tabMenuLabels,
      tabItemsById,
      treeModel,
      treePresentations,
      tabs.length,
    ],
  );

  const visibleTreeLeafIds = useMemo(
    () => new Set(treeRows.flatMap((row) => (row.kind === "leaf" ? [row.leaf.tabId] : []))),
    [treeRows],
  );
  const hiddenTreeTabs = useMemo(
    () => tabs.filter((item) => !visibleTreeLeafIds.has(item.tab.tabId)),
    [tabs, visibleTreeLeafIds],
  );

  const rail = (
    <View style={styles.railContainer} testID="workspace-tabs-rail">
      <ScrollView
        ref={railScrollRef}
        onLayout={handleRailViewportLayout}
        onContentSizeChange={handleRailContentSizeChange}
        onScroll={handleRailScroll}
        scrollEventThrottle={16}
        testID="workspace-tabs-rail-scroll"
        style={styles.railScroll}
        contentContainerStyle={styles.railTabsContent}
        showsVerticalScrollIndicator={false}
      >
        {hiddenTreeTabs.map((item) => (
          <WorkspaceTabPresentationObserver
            key={`workspace-tab-tree-observer:${item.tab.tabId}`}
            tab={item.tab}
            serverId={normalizedServerId}
            workspaceId={normalizedWorkspaceId}
            onChange={handlePresentationChange}
          />
        ))}
        <SortableInlineList
          data={treeRows}
          keyExtractor={treeRowKeyExtractor}
          useDragHandle
          disabled={!externalDndContext}
          onDragEnd={handleDragEnd}
          externalDndContext={externalDndContext}
          activeId={activeDragSortableId}
          getItemData={getTreeRowDragData}
          renderItem={renderTreeRow}
          orientation="vertical"
        />
      </ScrollView>
      <View style={styles.railActions}>
        {treeModel.groupIds.length > 0 ? (
          <WorkspaceTabTreeToggleAllButton
            allCollapsed={allGroupsCollapsed}
            onPress={handleToggleAllGroups}
          />
        ) : null}
        <WorkspaceInlineAddTabButton
          shortcutKeys={newTabKeys}
          onCreateAgentTab={handleCreateAgentTab}
          orientation="vertical"
        />
        <WorkspaceTabRowExtras
          onCreateAgentTab={handleCreateAgentTab}
          onCreateTerminal={handleCreateTerminal}
          onCreateBrowser={handleCreateBrowser}
          onCreateTerminalWithProfile={handleCreateTerminalWithProfile}
          onEditProfiles={handleEditProfiles}
          normalizedServerId={normalizedServerId}
          showCreateBrowserTab={showCreateBrowserTab}
          terminalDisabled={terminalDisabled}
          orientation="vertical"
        />
        {showPaneSplitActions ? (
          <>
            <SplitActionButton
              icon="split-right"
              onPress={onSplitRight}
              label={t("workspace.tabs.actions.splitRight")}
              shortcutKeys={splitRightKeys}
              orientation="vertical"
            />
            <SplitActionButton
              icon="split-down"
              onPress={onSplitDown}
              label={t("workspace.tabs.actions.splitDown")}
              shortcutKeys={splitDownKeys}
              orientation="vertical"
            />
          </>
        ) : null}
      </View>
    </View>
  );

  return <RenderProfile id="WorkspaceDesktopTabsRail">{rail}</RenderProfile>;
}

function ResolvedDesktopTabChip({
  item,
  isFocused,
  isDragging,
  index,
  tabCount,
  orderingIndex,
  orderingItemCount,
  totalTabCount,
  normalizedServerId,
  normalizedWorkspaceId,
  onCopyResumeCommand,
  onCopyAgentId,
  onCopyFilePath,
  onReloadAgent,
  onRenameTab,
  onCloseTabsToLeft,
  onCloseTabsToRight,
  onCloseOtherTabs,
  onMoveTabToStart,
  onMoveTabToEnd,
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
  onPresentationChange,
}: {
  item: WorkspaceDesktopTabRowItem;
  isFocused: boolean;
  isDragging: boolean;
  index: number;
  tabCount: number;
  orderingIndex?: number;
  orderingItemCount?: number;
  totalTabCount?: number;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onMoveTabToStart: (tabId: string) => Promise<void> | void;
  onMoveTabToEnd: (tabId: string) => Promise<void> | void;
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
  onPresentationChange?: (tabId: string, snapshot: WorkspaceTabTreePresentationSnapshot) => void;
}) {
  const { t } = useTranslation();
  const resolvedTab = useMemo(
    () =>
      buildWorkspaceDesktopTabActions({
        orientation,
        tab: item.tab,
        index,
        tabCount,
        orderingIndex,
        orderingItemCount,
        totalTabCount,
        onCopyResumeCommand,
        onCopyAgentId,
        onCopyFilePath,
        onReloadAgent,
        onRenameTab,
        onCloseTab,
        onCloseTabsToLeft,
        onCloseTabsToRight,
        onCloseOtherTabs,
        onMoveTabToStart,
        onMoveTabToEnd,
        labels,
      }),
    [
      index,
      item.tab,
      onCloseOtherTabs,
      onCloseTab,
      onCloseTabsToLeft,
      onCloseTabsToRight,
      onCopyAgentId,
      onCopyFilePath,
      onCopyResumeCommand,
      labels,
      onMoveTabToEnd,
      onMoveTabToStart,
      onReloadAgent,
      onRenameTab,
      orientation,
      orderingIndex,
      orderingItemCount,
      tabCount,
      totalTabCount,
    ],
  );

  return (
    <WorkspaceTabPresentationResolver
      tab={item.tab}
      serverId={normalizedServerId}
      workspaceId={normalizedWorkspaceId}
    >
      {(presentation) => {
        const tooltipLabel =
          presentation.titleState === "loading"
            ? t("workspace.tabs.loadingAgentTitle")
            : presentation.label;

        return (
          <View style={orientation === "vertical" ? styles.railTabSlot : styles.tabSlot}>
            {onPresentationChange ? (
              <WorkspaceTabPresentationReporter
                tabId={item.tab.tabId}
                presentation={presentation}
                onChange={onPresentationChange}
              />
            ) : null}
            {showDropIndicatorBefore ? (
              <View
                style={
                  orientation === "vertical"
                    ? RAIL_TAB_DROP_INDICATOR_BEFORE_STYLE
                    : TAB_DROP_INDICATOR_BEFORE_STYLE
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
                    ? RAIL_TAB_DROP_INDICATOR_AFTER_STYLE
                    : TAB_DROP_INDICATOR_AFTER_STYLE
                }
              />
            ) : null}
          </View>
        );
      }}
    </WorkspaceTabPresentationResolver>
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
    paddingHorizontal: theme.spacing[1],
    overflow: "visible",
  },
  railPinnedTargetsScroll: {
    flex: 1,
    minWidth: 0,
    height: 22,
  },
  railPinnedTargetsContent: {
    alignItems: "center",
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
  tabsScrollFitContent: {
    flex: 1,
  },
  tabsScrollOverflow: {
    flex: 1,
  },
  tabsContent: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  tabsActions: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
  },
  inlineAddButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[1],
  },
  tab: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    userSelect: "none",
  },
  railTab: {
    width: "100%",
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    userSelect: "none",
  },
  railTreeGroupRow: {
    position: "relative",
    width: "100%",
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    userSelect: "none",
  },
  railTreeGroupSlot: {
    width: "100%",
  },
  railTreeGroupRowActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  railTreeGroupContent: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    paddingRight: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  railTreeGroupIcon: {
    flexShrink: 0,
  },
  railTreeGroupLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  railTreeGroupCount: {
    flexShrink: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  tabSlot: {
    position: "relative",
    overflow: "visible",
  },
  railTabSlot: {
    position: "relative",
    width: "100%",
    overflow: "visible",
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
    flexShrink: 0,
  },
  tabFocusIndicator: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: theme.colors.accent,
  },
  railTabFocusIndicator: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 2,
    backgroundColor: theme.colors.accent,
  },
  tabFocusIndicatorUnfocused: {
    backgroundColor: theme.colors.borderAccent,
  },
  tabDropIndicator: {
    position: "absolute",
    top: theme.spacing[2],
    bottom: theme.spacing[2],
    width: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    zIndex: 10,
    pointerEvents: "none",
  },
  tabDropIndicatorBefore: {
    left: -3,
  },
  tabDropIndicatorAfter: {
    right: -3,
  },
  railTabDropIndicator: {
    position: "absolute",
    left: theme.spacing[2],
    right: theme.spacing[2],
    height: 5,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
    zIndex: 10,
    pointerEvents: "none",
  },
  railTabDropIndicatorBefore: {
    top: -3,
  },
  railTabDropIndicatorAfter: {
    bottom: -3,
  },
  tabLabel: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    userSelect: "none",
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
  tabLabelSkeletonWithCloseButton: {
    width: LOADING_TAB_LABEL_SKELETON_WIDTH,
  },
  tabLabelWithCloseButton: {
    paddingRight: 0,
  },
  tabLabelActive: {
    color: theme.colors.foreground,
  },
  tabCloseButton: {
    width: 18,
    height: 18,
    marginLeft: 0,
    borderRadius: theme.borderRadius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tabCloseButtonShown: {
    opacity: 1,
  },
  tabCloseButtonActive: {
    backgroundColor: theme.colors.surface3,
  },
  newTabActionButton: {
    width: 22,
    height: 22,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineAddActionButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  newTabActionButtonDisabled: {
    opacity: 0.5,
  },
  newTabActionButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  newTabTooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  newTabTooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  newTabTooltipShortcut: {},
  tooltipAgentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipAgentId: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  menuItemHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  terminalProfileIconWrapper: {
    width: 14,
    height: 14,
  },
}));

const TAB_DROP_INDICATOR_BEFORE_STYLE = [styles.tabDropIndicator, styles.tabDropIndicatorBefore];
const TAB_DROP_INDICATOR_AFTER_STYLE = [styles.tabDropIndicator, styles.tabDropIndicatorAfter];
const RAIL_TAB_DROP_INDICATOR_BEFORE_STYLE = [
  styles.railTabDropIndicator,
  styles.railTabDropIndicatorBefore,
];
const RAIL_TAB_DROP_INDICATOR_AFTER_STYLE = [
  styles.railTabDropIndicator,
  styles.railTabDropIndicatorAfter,
];
