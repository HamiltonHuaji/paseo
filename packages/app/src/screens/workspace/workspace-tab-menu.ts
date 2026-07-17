import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import type { DragOrientation } from "@/components/drag-orientation";
import { i18n } from "@/i18n/i18next";
import { encodeFilePathForPathSegment, encodeWorkspaceIdForPathSegment } from "@/utils/host-routes";
import { buildDeterministicWorkspaceTabId } from "@/workspace-tabs/identity";

export type WorkspaceTabMenuSurface = "desktop" | "desktop-rail" | "mobile";

export interface WorkspaceTabMenuLabels {
  copyResumeCommand: string;
  copyAgentId: string;
  copyFilePath: string;
  rename: string;
  moveToTop: string;
  moveToBottom: string;
  closeAbove: string;
  closeBelow: string;
  closeLeft: string;
  closeRight: string;
  closeOthers: string;
  reloadAgent: string;
  reloadAgentTooltip: string;
  close: string;
}

export const DEFAULT_WORKSPACE_TAB_MENU_LABELS: WorkspaceTabMenuLabels = {
  copyResumeCommand: i18n.t("workspace.tabs.menu.copyResumeCommand"),
  copyAgentId: i18n.t("workspace.tabs.menu.copyAgentId"),
  copyFilePath: i18n.t("workspace.tabs.menu.copyFilePath"),
  rename: i18n.t("workspace.tabs.menu.rename"),
  moveToTop: i18n.t("workspace.tabs.menu.moveToTop"),
  moveToBottom: i18n.t("workspace.tabs.menu.moveToBottom"),
  closeAbove: i18n.t("workspace.tabs.menu.closeAbove"),
  closeBelow: i18n.t("workspace.tabs.menu.closeBelow"),
  closeLeft: i18n.t("workspace.tabs.menu.closeLeft"),
  closeRight: i18n.t("workspace.tabs.menu.closeRight"),
  closeOthers: i18n.t("workspace.tabs.menu.closeOthers"),
  reloadAgent: i18n.t("workspace.tabs.menu.reloadAgent"),
  reloadAgentTooltip: i18n.t("workspace.tabs.menu.reloadAgentTooltip"),
  close: i18n.t("workspace.tabs.menu.close"),
};

export type WorkspaceTabMenuEntry =
  | {
      kind: "item";
      key: string;
      label: string;
      icon?:
        | "copy"
        | "rotate-cw"
        | "arrow-up-to-line"
        | "arrow-down-to-line"
        | "arrow-left-to-line"
        | "arrow-right-to-line"
        | "copy-x"
        | "pencil"
        | "x";
      hint?: string;
      tooltip?: string;
      disabled?: boolean;
      destructive?: boolean;
      testID: string;
      onSelect: () => void;
    }
  | {
      kind: "separator";
      key: string;
    };

interface BuildWorkspaceTabMenuEntriesInput {
  surface: WorkspaceTabMenuSurface;
  tab: WorkspaceTabDescriptor;
  index: number;
  tabCount: number;
  menuTestIDBase: string;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCloseTabsBefore: (tabId: string) => Promise<void> | void;
  onCloseTabsAfter: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onMoveTabToStart?: (tabId: string) => Promise<void> | void;
  onMoveTabToEnd?: (tabId: string) => Promise<void> | void;
  labels?: WorkspaceTabMenuLabels;
}

interface BuildWorkspaceDesktopTabActionsInput {
  orientation?: DragOrientation;
  tab: WorkspaceTabDescriptor;
  index: number;
  tabCount: number;
  onCopyResumeCommand: (agentId: string) => Promise<void> | void;
  onCopyAgentId: (agentId: string) => Promise<void> | void;
  onCopyFilePath: (path: string) => Promise<void> | void;
  onReloadAgent: (agentId: string) => Promise<void> | void;
  onRenameTab: (tab: WorkspaceTabDescriptor) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onCloseTabsToLeft: (tabId: string) => Promise<void> | void;
  onCloseTabsToRight: (tabId: string) => Promise<void> | void;
  onCloseOtherTabs: (tabId: string) => Promise<void> | void;
  onMoveTabToStart: (tabId: string) => Promise<void> | void;
  onMoveTabToEnd: (tabId: string) => Promise<void> | void;
  labels?: WorkspaceTabMenuLabels;
}

export interface WorkspaceDesktopTabActions {
  contextMenuTestId: string;
  menuEntries: WorkspaceTabMenuEntry[];
  closeButtonTestId: string;
}

export function moveWorkspaceTabToEdge(
  tabs: WorkspaceTabDescriptor[],
  tabId: string,
  edge: "start" | "end",
): WorkspaceTabDescriptor[] {
  const currentIndex = tabs.findIndex((tab) => tab.tabId === tabId);
  const destinationIndex = edge === "start" ? 0 : tabs.length - 1;
  if (currentIndex < 0 || currentIndex === destinationIndex) {
    return tabs;
  }

  const nextTabs = [...tabs];
  const [tab] = nextTabs.splice(currentIndex, 1);
  if (!tab) {
    return tabs;
  }
  if (edge === "start") {
    nextTabs.unshift(tab);
  } else {
    nextTabs.push(tab);
  }
  return nextTabs;
}

function buildCloseBeforeLabel(
  surface: WorkspaceTabMenuSurface,
  labels: WorkspaceTabMenuLabels,
): string {
  return surface === "desktop" ? labels.closeLeft : labels.closeAbove;
}

function buildCloseAfterLabel(
  surface: WorkspaceTabMenuSurface,
  labels: WorkspaceTabMenuLabels,
): string {
  return surface === "desktop" ? labels.closeRight : labels.closeBelow;
}

function buildCloseBeforeTestIDSuffix(surface: WorkspaceTabMenuSurface): string {
  return surface === "desktop" ? "close-left" : "close-above";
}

function buildCloseAfterTestIDSuffix(surface: WorkspaceTabMenuSurface): string {
  return surface === "desktop" ? "close-right" : "close-below";
}

function buildCloseBeforeIcon(
  surface: WorkspaceTabMenuSurface,
): Extract<WorkspaceTabMenuEntry, { kind: "item" }>["icon"] {
  return surface === "desktop-rail" ? "arrow-up-to-line" : "arrow-left-to-line";
}

function buildCloseAfterIcon(
  surface: WorkspaceTabMenuSurface,
): Extract<WorkspaceTabMenuEntry, { kind: "item" }>["icon"] {
  return surface === "desktop-rail" ? "arrow-down-to-line" : "arrow-right-to-line";
}

function getCloseButtonTestId(tab: WorkspaceTabDescriptor): string {
  if (tab.target.kind === "agent") {
    return `workspace-agent-close-${tab.target.agentId}`;
  }
  if (tab.target.kind === "terminal") {
    return `workspace-terminal-close-${tab.target.terminalId}`;
  }
  if (tab.target.kind === "draft") {
    return `workspace-draft-close-${tab.target.draftId}`;
  }
  if (tab.target.kind === "browser") {
    return `workspace-browser-close-${tab.target.browserId}`;
  }
  if (tab.target.kind === "setup") {
    return `workspace-setup-close-${encodeWorkspaceIdForPathSegment(tab.target.workspaceId)}`;
  }
  if (tab.target.kind === "provider_subagent") {
    return `workspace-provider-subagent-close-${tab.target.subagentId}`;
  }
  return `workspace-file-close-${encodeFilePathForPathSegment(tab.target.path)}`;
}

export function buildWorkspaceTabMenuEntries(
  input: BuildWorkspaceTabMenuEntriesInput,
): WorkspaceTabMenuEntry[] {
  const {
    surface,
    tab,
    index,
    tabCount,
    menuTestIDBase,
    onCopyResumeCommand,
    onCopyAgentId,
    onCopyFilePath,
    onReloadAgent,
    onRenameTab,
    onCloseTab,
    onCloseTabsBefore,
    onCloseTabsAfter,
    onCloseOtherTabs,
    onMoveTabToStart,
    onMoveTabToEnd,
  } = input;
  const labels = input.labels ?? DEFAULT_WORKSPACE_TAB_MENU_LABELS;
  const isFirstTab = index === 0;
  const isLastTab = index === tabCount - 1;
  const isOnlyTab = tabCount <= 1;
  const entries: WorkspaceTabMenuEntry[] = [];

  if (tab.target.kind === "agent") {
    const { agentId } = tab.target;
    entries.push({
      kind: "item",
      key: "copy-resume-command",
      label: labels.copyResumeCommand,
      icon: "copy",
      testID: `${menuTestIDBase}-copy-resume-command`,
      onSelect: () => {
        void onCopyResumeCommand(agentId);
      },
    });
    entries.push({
      kind: "item",
      key: "copy-agent-id",
      label: labels.copyAgentId,
      icon: "copy",
      hint: agentId.slice(0, 7),
      testID: `${menuTestIDBase}-copy-agent-id`,
      onSelect: () => {
        void onCopyAgentId(agentId);
      },
    });
  }

  if (tab.target.kind === "file") {
    const filePath = tab.target.path;
    entries.push({
      kind: "item",
      key: "copy-file-path",
      label: labels.copyFilePath,
      icon: "copy",
      testID: `${menuTestIDBase}-copy-file-path`,
      onSelect: () => {
        void onCopyFilePath(filePath);
      },
    });
  }

  if (tab.target.kind === "agent" || tab.target.kind === "terminal") {
    entries.push({
      kind: "item",
      key: "rename",
      label: labels.rename,
      icon: "pencil",
      testID: `${menuTestIDBase}-rename`,
      onSelect: () => {
        onRenameTab(tab);
      },
    });
  }

  const closeBeforeEntry: WorkspaceTabMenuEntry = {
    kind: "item",
    key: "close-before",
    label: buildCloseBeforeLabel(surface, labels),
    icon: buildCloseBeforeIcon(surface),
    disabled: isFirstTab,
    testID: `${menuTestIDBase}-${buildCloseBeforeTestIDSuffix(surface)}`,
    onSelect: () => {
      void onCloseTabsBefore(tab.tabId);
    },
  };
  const closeAfterEntry: WorkspaceTabMenuEntry = {
    kind: "item",
    key: "close-after",
    label: buildCloseAfterLabel(surface, labels),
    icon: buildCloseAfterIcon(surface),
    disabled: isLastTab,
    testID: `${menuTestIDBase}-${buildCloseAfterTestIDSuffix(surface)}`,
    onSelect: () => {
      void onCloseTabsAfter(tab.tabId);
    },
  };
  const closeOthersEntry: WorkspaceTabMenuEntry = {
    kind: "item",
    key: "close-others",
    label: labels.closeOthers,
    icon: "copy-x",
    disabled: isOnlyTab,
    testID: `${menuTestIDBase}-close-others`,
    onSelect: () => {
      void onCloseOtherTabs(tab.tabId);
    },
  };
  const closeEntry: WorkspaceTabMenuEntry = {
    kind: "item",
    key: "close",
    label: labels.close,
    icon: "x",
    testID: `${menuTestIDBase}-close`,
    onSelect: () => {
      void onCloseTab(tab.tabId);
    },
  };
  const reloadAgentId = tab.target.kind === "agent" ? tab.target.agentId : null;
  const reloadAgentEntry: WorkspaceTabMenuEntry | null =
    reloadAgentId !== null
      ? {
          kind: "item",
          key: "reload-agent",
          label: labels.reloadAgent,
          icon: "rotate-cw",
          tooltip: labels.reloadAgentTooltip,
          testID: `${menuTestIDBase}-reload-agent`,
          onSelect: () => {
            void onReloadAgent(reloadAgentId);
          },
        }
      : null;

  if (entries.length > 0) {
    entries.push({ kind: "separator", key: "actions-separator" });
  }
  entries.push({
    kind: "item",
    key: "move-to-start",
    label: labels.moveToTop,
    icon: "arrow-up-to-line",
    disabled: isFirstTab,
    testID: `${menuTestIDBase}-move-to-top`,
    onSelect: () => {
      void onMoveTabToStart?.(tab.tabId);
    },
  });
  entries.push({
    kind: "item",
    key: "move-to-end",
    label: labels.moveToBottom,
    icon: "arrow-down-to-line",
    disabled: isLastTab,
    testID: `${menuTestIDBase}-move-to-bottom`,
    onSelect: () => {
      void onMoveTabToEnd?.(tab.tabId);
    },
  });
  entries.push({ kind: "separator", key: "ordering-separator" });

  if (reloadAgentEntry) {
    entries.push(reloadAgentEntry);
  }
  entries.push(closeBeforeEntry, closeAfterEntry, closeOthersEntry, closeEntry);

  return entries;
}

export function buildWorkspaceDesktopTabActions(
  input: BuildWorkspaceDesktopTabActionsInput,
): WorkspaceDesktopTabActions {
  const contextMenuTestId = `workspace-tab-context-${buildDeterministicWorkspaceTabId(input.tab.target)}`;
  return {
    contextMenuTestId,
    menuEntries: buildWorkspaceTabMenuEntries({
      surface: input.orientation === "vertical" ? "desktop-rail" : "desktop",
      tab: input.tab,
      index: input.index,
      tabCount: input.tabCount,
      menuTestIDBase: contextMenuTestId,
      onCopyResumeCommand: input.onCopyResumeCommand,
      onCopyAgentId: input.onCopyAgentId,
      onCopyFilePath: input.onCopyFilePath,
      onReloadAgent: input.onReloadAgent,
      onRenameTab: input.onRenameTab,
      onCloseTab: input.onCloseTab,
      onCloseTabsBefore: input.onCloseTabsToLeft,
      onCloseTabsAfter: input.onCloseTabsToRight,
      onCloseOtherTabs: input.onCloseOtherTabs,
      onMoveTabToStart: input.onMoveTabToStart,
      onMoveTabToEnd: input.onMoveTabToEnd,
      labels: input.labels,
    }),
    closeButtonTestId: getCloseButtonTestId(input.tab),
  };
}
