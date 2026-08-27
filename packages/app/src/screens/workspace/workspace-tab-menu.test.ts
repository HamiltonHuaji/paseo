import { describe, expect, it, vi } from "vitest";
import {
  buildWorkspaceDesktopTabActions,
  buildWorkspaceTabMenuEntries,
  moveWorkspaceTabToEdge,
} from "@/screens/workspace/workspace-tab-menu";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";

function createAgentTab(): WorkspaceTabDescriptor {
  return {
    key: "agent_123",
    tabId: "agent_123",
    kind: "agent",
    target: { kind: "agent", agentId: "agent-123" },
  };
}

describe("buildWorkspaceTabMenuEntries", () => {
  it("uses desktop tab ordering labels for desktop menus", () => {
    const onCopyResumeCommand = vi.fn();
    const onCopyAgentId = vi.fn();
    const onCopyFilePath = vi.fn();
    const onReloadAgent = vi.fn();
    const onRenameTab = vi.fn();
    const onMoveTabToStart = vi.fn();
    const onMoveTabToEnd = vi.fn();
    const onCloseTab = vi.fn();
    const onCloseTabsBefore = vi.fn();
    const onCloseTabsAfter = vi.fn();
    const onCloseOtherTabs = vi.fn();

    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: createAgentTab(),
      index: 1,
      tabCount: 3,
      menuTestIDBase: "workspace-tab-context-agent_123",
      onCopyResumeCommand,
      onCopyAgentId,
      onCopyTerminalId: vi.fn(),
      onCopyFilePath,
      onReloadAgent,
      onRenameTab,
      onMoveTabToStart,
      onMoveTabToEnd,
      onCloseTab,
      onCloseTabsBefore,
      onCloseTabsAfter,
      onCloseOtherTabs,
    });

    expect(entries.map((entry) => entry.key)).toEqual([
      "copy-resume-command",
      "copy-agent-id",
      "rename",
      "actions-separator",
      "move-to-start",
      "move-to-end",
      "ordering-separator",
      "reload-agent",
      "close-before",
      "close-after",
      "close-others",
      "close",
    ]);
    expect(entries.filter((entry) => entry.kind === "item").map((entry) => entry.label)).toEqual([
      "Copy resume command",
      "Copy agent id",
      "Rename",
      "Move to top",
      "Move to bottom",
      "Reload agent",
      "Close to the left",
      "Close to the right",
      "Close other tabs",
      "Close",
    ]);

    const moveToStart = entries.find((entry) => entry.key === "move-to-start");
    const moveToEnd = entries.find((entry) => entry.key === "move-to-end");
    if (moveToStart?.kind !== "item" || moveToEnd?.kind !== "item") {
      throw new Error("Move entries missing");
    }
    moveToStart.onSelect();
    moveToEnd.onSelect();
    expect(onMoveTabToStart).toHaveBeenCalledWith("agent_123");
    expect(onMoveTabToEnd).toHaveBeenCalledWith("agent_123");
  });

  it("uses stacked ordering labels for mobile menus", () => {
    const onMoveTabToStart = vi.fn();
    const onMoveTabToEnd = vi.fn();
    const entries = buildWorkspaceTabMenuEntries({
      surface: "mobile",
      tab: createAgentTab(),
      index: 1,
      tabCount: 3,
      menuTestIDBase: "workspace-tab-menu-agent_123",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onMoveTabToStart,
      onMoveTabToEnd,
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries.filter((entry) => entry.kind === "item").map((entry) => entry.label)).toEqual([
      "Copy resume command",
      "Copy agent id",
      "Rename",
      "Move to top",
      "Move to bottom",
      "Reload agent",
      "Close tabs above",
      "Close tabs below",
      "Close other tabs",
      "Close",
    ]);

    const moveToStart = entries.find((entry) => entry.key === "move-to-start");
    const moveToEnd = entries.find((entry) => entry.key === "move-to-end");
    if (moveToStart?.kind !== "item" || moveToEnd?.kind !== "item") {
      throw new Error("Mobile move entries missing");
    }
    moveToStart.onSelect();
    moveToEnd.onSelect();
    expect(onMoveTabToStart).toHaveBeenCalledWith("agent_123");
    expect(onMoveTabToEnd).toHaveBeenCalledWith("agent_123");
  });

  it("does not render partial mobile ordering actions as no-ops", () => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "mobile",
      tab: createAgentTab(),
      index: 1,
      tabCount: 3,
      menuTestIDBase: "workspace-tab-menu-agent_123",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onMoveTabToStart: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries.map((entry) => entry.key)).not.toContain("move-to-start");
    expect(entries.map((entry) => entry.key)).not.toContain("move-to-end");
    expect(entries.map((entry) => entry.key)).not.toContain("ordering-separator");
  });

  it("uses above and below semantics for desktop rail close actions", () => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop-rail",
      tab: createAgentTab(),
      index: 1,
      tabCount: 3,
      menuTestIDBase: "workspace-tab-context-agent_123",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onMoveTabToStart: vi.fn(),
      onMoveTabToEnd: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries).toContainEqual(
      expect.objectContaining({
        key: "close-before",
        label: "Close tabs above",
        icon: "arrow-up-to-line",
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        key: "close-after",
        label: "Close tabs below",
        icon: "arrow-down-to-line",
      }),
    );
  });

  it("moves a tab to either edge without mutating the source order", () => {
    const first = createAgentTab();
    const middle: WorkspaceTabDescriptor = {
      key: "terminal_123",
      tabId: "terminal_123",
      kind: "terminal",
      target: { kind: "terminal", terminalId: "terminal-123" },
    };
    const last: WorkspaceTabDescriptor = {
      key: "draft_123",
      tabId: "draft_123",
      kind: "draft",
      target: { kind: "draft", draftId: "draft_123" },
    };
    const tabs = [first, middle, last];

    expect(moveWorkspaceTabToEdge(tabs, middle.tabId, "start")).toEqual([middle, first, last]);
    expect(moveWorkspaceTabToEdge(tabs, middle.tabId, "end")).toEqual([first, last, middle]);
    expect(tabs).toEqual([first, middle, last]);
    expect(moveWorkspaceTabToEdge(tabs, first.tabId, "start")).toBe(tabs);
    expect(moveWorkspaceTabToEdge(tabs, "missing", "end")).toBe(tabs);
  });

  it("disables the move action for the edge the tab already occupies", () => {
    const buildEntries = (index: number) =>
      buildWorkspaceTabMenuEntries({
        surface: "desktop",
        tab: createAgentTab(),
        index,
        tabCount: 3,
        menuTestIDBase: "workspace-tab-context-agent_123",
        onCopyResumeCommand: vi.fn(),
        onCopyAgentId: vi.fn(),
        onCopyTerminalId: vi.fn(),
        onCopyFilePath: vi.fn(),
        onReloadAgent: vi.fn(),
        onRenameTab: vi.fn(),
        onMoveTabToStart: vi.fn(),
        onMoveTabToEnd: vi.fn(),
        onCloseTab: vi.fn(),
        onCloseTabsBefore: vi.fn(),
        onCloseTabsAfter: vi.fn(),
        onCloseOtherTabs: vi.fn(),
      });

    expect(buildEntries(0)).toContainEqual(
      expect.objectContaining({ key: "move-to-start", disabled: true }),
    );
    expect(buildEntries(2)).toContainEqual(
      expect.objectContaining({ key: "move-to-end", disabled: true }),
    );
  });

  it("omits agent copy actions and rename for draft tabs", () => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "mobile",
      tab: {
        key: "draft_123",
        tabId: "draft_123",
        kind: "draft",
        target: { kind: "draft", draftId: "draft_123" },
      },
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-menu-draft_123",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onMoveTabToStart: vi.fn(),
      onMoveTabToEnd: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries.some((entry) => entry.kind === "item" && entry.label === "Copy agent id")).toBe(
      false,
    );
    expect(entries.some((entry) => entry.kind === "item" && entry.label === "Reload agent")).toBe(
      false,
    );
    expect(entries.some((entry) => entry.kind === "item" && entry.label === "Rename")).toBe(false);
    expect(entries.filter((entry) => entry.kind === "separator").map((entry) => entry.key)).toEqual(
      ["ordering-separator"],
    );
  });

  it("adds reload tooltip copy for agent tabs", () => {
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: createAgentTab(),
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-agent_123",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(entries).toContainEqual(
      expect.objectContaining({
        kind: "item",
        key: "reload-agent",
        tooltip: "Reload agent to update skills, MCPs or login status.",
      }),
    );
  });

  it("invokes onRenameTab when the rename entry is selected for agent tabs", () => {
    const onRenameTab = vi.fn();
    const tab = createAgentTab();
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab,
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-agent_123",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab,
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    const renameEntry = entries.find((entry) => entry.kind === "item" && entry.label === "Rename");
    if (!renameEntry || renameEntry.kind !== "item") {
      throw new Error("Rename entry missing");
    }
    renameEntry.onSelect();

    expect(onRenameTab).toHaveBeenCalledWith(tab);
  });

  it("includes copy id and rename for terminal tabs", () => {
    const onRenameTab = vi.fn();
    const onCopyTerminalId = vi.fn();
    const terminalTab: WorkspaceTabDescriptor = {
      key: "terminal_abc",
      tabId: "terminal_abc",
      kind: "terminal",
      target: { kind: "terminal", terminalId: "terminal-abc" },
    };
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: terminalTab,
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-terminal_abc",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId,
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab,
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    const labels = entries.filter((entry) => entry.kind === "item").map((entry) => entry.label);
    expect(labels[0]).toBe("Copy terminal id");
    expect(labels[1]).toBe("Rename");
    expect(labels).not.toContain("Copy resume command");
    expect(labels).not.toContain("Copy agent id");
    expect(labels).not.toContain("Copy file path");
    expect(labels).not.toContain("Reload agent");

    const copyTerminalIdEntry = entries.find(
      (entry) => entry.kind === "item" && entry.key === "copy-terminal-id",
    );
    if (!copyTerminalIdEntry || copyTerminalIdEntry.kind !== "item") {
      throw new Error("Copy terminal id entry missing");
    }
    copyTerminalIdEntry.onSelect();
    expect(onCopyTerminalId).toHaveBeenCalledWith("terminal-abc");

    const renameEntry = entries.find((entry) => entry.kind === "item" && entry.label === "Rename");
    if (!renameEntry || renameEntry.kind !== "item") {
      throw new Error("Rename entry missing");
    }
    renameEntry.onSelect();
    expect(onRenameTab).toHaveBeenCalledWith(terminalTab);
  });

  it("includes copy file path for file tabs", () => {
    const onCopyFilePath = vi.fn();
    const fileTab: WorkspaceTabDescriptor = {
      key: "file_abc",
      tabId: "file_abc",
      kind: "file",
      target: { kind: "file", path: "/some/path.ts", lineStart: 1, lineEnd: 10 },
    };
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: fileTab,
      index: 0,
      tabCount: 1,
      menuTestIDBase: "workspace-tab-context-file_abc",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath,
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    const labels = entries.filter((entry) => entry.kind === "item").map((entry) => entry.label);
    expect(labels[0]).toBe("Copy file path");
    expect(labels).not.toContain("Copy resume command");
    expect(labels).not.toContain("Copy agent id");
    expect(labels).not.toContain("Rename");
    expect(labels).not.toContain("Reload agent");

    const copyFilePathEntry = entries.find(
      (entry) => entry.kind === "item" && entry.key === "copy-file-path",
    );
    if (!copyFilePathEntry || copyFilePathEntry.kind !== "item") {
      throw new Error("Copy file path entry missing");
    }
    copyFilePathEntry.onSelect();
    expect(onCopyFilePath).toHaveBeenCalledWith("/some/path.ts");
  });

  it("uses a Changes close id for the working diff tab", () => {
    const actions = buildWorkspaceDesktopTabActions({
      tab: {
        key: "working_diff_abc",
        tabId: "working_diff_abc",
        kind: "working_diff",
        target: {
          kind: "working_diff",
          focusPath: "src/example.ts",
          focusRequestId: 1,
        },
      },
      index: 0,
      tabCount: 1,
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onMoveTabToStart: vi.fn(),
      onMoveTabToEnd: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsToLeft: vi.fn(),
      onCloseTabsToRight: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    expect(actions.closeButtonTestId).toMatch(/^workspace-working-diff-close-/);
    expect(actions.menuEntries).not.toContainEqual(
      expect.objectContaining({ kind: "item", key: "copy-file-path" }),
    );
  });

  it("uses the same rename entry shape for agent and terminal tabs", () => {
    const terminalTab: WorkspaceTabDescriptor = {
      key: "terminal_abc",
      tabId: "terminal_abc",
      kind: "terminal",
      target: { kind: "terminal", terminalId: "terminal-abc" },
    };
    const menuTestIDBase = "workspace-tab-context";
    const sharedInput = {
      surface: "desktop" as const,
      index: 0,
      tabCount: 1,
      menuTestIDBase,
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyTerminalId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    };

    const agentEntries = buildWorkspaceTabMenuEntries({ ...sharedInput, tab: createAgentTab() });
    const terminalEntries = buildWorkspaceTabMenuEntries({ ...sharedInput, tab: terminalTab });

    const agentRename = agentEntries.find(
      (entry) => entry.kind === "item" && entry.key === "rename",
    );
    const terminalRename = terminalEntries.find(
      (entry) => entry.kind === "item" && entry.key === "rename",
    );
    if (!agentRename || agentRename.kind !== "item") throw new Error("Agent rename missing");
    if (!terminalRename || terminalRename.kind !== "item")
      throw new Error("Terminal rename missing");

    expect({
      key: agentRename.key,
      label: agentRename.label,
      icon: agentRename.icon,
      testID: agentRename.testID,
    }).toEqual({
      key: terminalRename.key,
      label: terminalRename.label,
      icon: terminalRename.icon,
      testID: terminalRename.testID,
    });

    const agentSeparator = agentEntries
      .slice(agentEntries.indexOf(agentRename) + 1)
      .find((entry) => entry.kind === "separator");
    const terminalSeparator = terminalEntries
      .slice(terminalEntries.indexOf(terminalRename) + 1)
      .find((entry) => entry.kind === "separator");
    expect(agentSeparator?.key).toBe("actions-separator");
    expect(terminalSeparator?.key).toBe("actions-separator");
  });
});
