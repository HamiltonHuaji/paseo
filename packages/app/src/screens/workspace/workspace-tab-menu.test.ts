import { describe, expect, it, vi } from "vitest";
import {
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
    const onCloseTab = vi.fn();
    const onCloseTabsBefore = vi.fn();
    const onCloseTabsAfter = vi.fn();
    const onCloseOtherTabs = vi.fn();
    const onMoveTabToStart = vi.fn();
    const onMoveTabToEnd = vi.fn();

    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop",
      tab: createAgentTab(),
      index: 1,
      tabCount: 3,
      menuTestIDBase: "workspace-tab-context-agent_123",
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
    });

    expect(
      entries.map((entry) => (entry.kind === "separator" ? `separator:${entry.key}` : entry.key)),
    ).toEqual([
      "copy-resume-command",
      "copy-agent-id",
      "rename",
      "separator:actions-separator",
      "move-to-start",
      "move-to-end",
      "separator:ordering-separator",
      "reload-agent",
      "close-before",
      "close-after",
      "close-others",
      "close",
    ]);

    const moveToStart = entries.find(
      (entry) => entry.kind === "item" && entry.key === "move-to-start",
    );
    const moveToEnd = entries.find((entry) => entry.kind === "item" && entry.key === "move-to-end");
    if (!moveToStart || moveToStart.kind !== "item") throw new Error("Move to top missing");
    if (!moveToEnd || moveToEnd.kind !== "item") throw new Error("Move to bottom missing");

    expect(moveToStart).toMatchObject({
      label: "Move to top",
      icon: "arrow-up-to-line",
      disabled: false,
      testID: "workspace-tab-context-agent_123-move-to-top",
    });
    expect(moveToEnd).toMatchObject({
      label: "Move to bottom",
      icon: "arrow-down-to-line",
      disabled: false,
      testID: "workspace-tab-context-agent_123-move-to-bottom",
    });

    moveToStart.onSelect();
    moveToEnd.onSelect();
    expect(onMoveTabToStart).toHaveBeenCalledWith("agent_123");
    expect(onMoveTabToEnd).toHaveBeenCalledWith("agent_123");
  });

  it("moves a tab to either edge without changing an already-edge order", () => {
    const first = createAgentTab();
    const middle: WorkspaceTabDescriptor = {
      ...createAgentTab(),
      key: "agent_456",
      tabId: "agent_456",
      target: { kind: "agent", agentId: "agent-456" },
    };
    const last: WorkspaceTabDescriptor = {
      ...createAgentTab(),
      key: "agent_789",
      tabId: "agent_789",
      target: { kind: "agent", agentId: "agent-789" },
    };
    const tabs = [first, middle, last];

    expect(moveWorkspaceTabToEdge(tabs, middle.tabId, "start")).toEqual([middle, first, last]);
    expect(moveWorkspaceTabToEdge(tabs, middle.tabId, "end")).toEqual([first, last, middle]);
    expect(moveWorkspaceTabToEdge(tabs, first.tabId, "start")).toBe(tabs);
    expect(moveWorkspaceTabToEdge(tabs, last.tabId, "end")).toBe(tabs);
    expect(moveWorkspaceTabToEdge(tabs, "missing", "start")).toBe(tabs);
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
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
      onMoveTabToStart,
      onMoveTabToEnd,
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

    const moveToStart = entries.find(
      (entry) => entry.kind === "item" && entry.key === "move-to-start",
    );
    const moveToEnd = entries.find((entry) => entry.kind === "item" && entry.key === "move-to-end");
    if (!moveToStart || moveToStart.kind !== "item") throw new Error("Move to top missing");
    if (!moveToEnd || moveToEnd.kind !== "item") throw new Error("Move to bottom missing");
    moveToStart.onSelect();
    moveToEnd.onSelect();
    expect(onMoveTabToStart).toHaveBeenCalledWith("agent_123");
    expect(onMoveTabToEnd).toHaveBeenCalledWith("agent_123");
  });

  it("uses vertical ordering labels, test IDs, and icons for desktop rail menus", () => {
    const onCloseTabsBefore = vi.fn();
    const onCloseTabsAfter = vi.fn();
    const entries = buildWorkspaceTabMenuEntries({
      surface: "desktop-rail",
      tab: createAgentTab(),
      index: 1,
      tabCount: 3,
      menuTestIDBase: "workspace-tab-context-agent_123",
      onCopyResumeCommand: vi.fn(),
      onCopyAgentId: vi.fn(),
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
      onCloseTab: vi.fn(),
      onCloseTabsBefore,
      onCloseTabsAfter,
      onCloseOtherTabs: vi.fn(),
    });

    const closeBefore = entries.find(
      (entry) => entry.kind === "item" && entry.key === "close-before",
    );
    const closeAfter = entries.find(
      (entry) => entry.kind === "item" && entry.key === "close-after",
    );
    if (!closeBefore || closeBefore.kind !== "item") throw new Error("Close above entry missing");
    if (!closeAfter || closeAfter.kind !== "item") throw new Error("Close below entry missing");

    expect(closeBefore).toMatchObject({
      label: "Close tabs above",
      icon: "arrow-up-to-line",
      testID: "workspace-tab-context-agent_123-close-above",
    });
    expect(closeAfter).toMatchObject({
      label: "Close tabs below",
      icon: "arrow-down-to-line",
      testID: "workspace-tab-context-agent_123-close-below",
    });

    closeBefore.onSelect();
    closeAfter.onSelect();
    expect(onCloseTabsBefore).toHaveBeenCalledWith("agent_123");
    expect(onCloseTabsAfter).toHaveBeenCalledWith("agent_123");
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
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab: vi.fn(),
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

  it("includes rename as the first entry for terminal tabs", () => {
    const onRenameTab = vi.fn();
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
      onCopyFilePath: vi.fn(),
      onReloadAgent: vi.fn(),
      onRenameTab,
      onCloseTab: vi.fn(),
      onCloseTabsBefore: vi.fn(),
      onCloseTabsAfter: vi.fn(),
      onCloseOtherTabs: vi.fn(),
    });

    const labels = entries.filter((entry) => entry.kind === "item").map((entry) => entry.label);
    expect(labels[0]).toBe("Rename");
    expect(labels).not.toContain("Copy resume command");
    expect(labels).not.toContain("Copy agent id");
    expect(labels).not.toContain("Copy file path");
    expect(labels).not.toContain("Reload agent");

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
