import { renameModalInput, renameModalSubmit } from "../support/helpers/rename";
import { expect, test as base } from "../support/fixtures";
import { awaitAssistantMessage } from "../support/helpers/agent-stream";
import {
  expectChatHistoryAttachment,
  expectInFlightForkAvailable,
  expectLiveAssistantText,
  forkInFlightTurnToNewTab,
  forkMostRecentAssistantTurnToNewTab,
  forkMostRecentAssistantTurnToNewWorkspace,
  observeForkAttachment,
} from "../support/helpers/assistant-fork";
import { expectComposerVisible, submitMessage } from "../support/helpers/composer";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentOptions,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { seedSavedSettingsHosts } from "../support/helpers/settings";
import { submitNewWorkspaceEmpty } from "../support/helpers/new-workspace";

const test = base.extend<{
  seedForkWorkspace: (options: MockAgentOptions) => Promise<MockAgentWorkspace>;
}>({
  seedForkWorkspace: async ({ browserName: _browserName }, provide) => {
    const sessions: MockAgentWorkspace[] = [];
    await provide(async (options) => {
      const session = await seedMockAgentWorkspace(options);
      sessions.push(session);
      return session;
    });
    await Promise.allSettled(sessions.map((session) => session.cleanup()));
  },
});

async function workspaceSessionEntries(session: MockAgentWorkspace) {
  const result = await session.client.fetchAgents({ scope: "active" });
  return result.entries.filter((entry) => entry.agent.workspaceId === session.workspaceId);
}

test.describe("Assistant fork menu", () => {
  test.describe.configure({ timeout: 180_000 });

  test("session canvas shows context forks, arranges vertically, renames and hosts a complete conversation", async ({
    page,
    seedForkWorkspace,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1600, height: 1050 });
    const session = await seedForkWorkspace({
      repoPrefix: "session-canvas-",
      title: "Canvas source",
      model: "ten-second-stream",
      initialPrompt: "emit 1 coalesced agent stream updates for the canvas source.",
    });
    await openAgentRoute(page, session);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);
    await forkMostRecentAssistantTurnToNewTab(page);
    await expectChatHistoryAttachment(page);
    await page
      .getByRole("textbox", { name: "Message agent..." })
      .first()
      .fill("emit 1 coalesced agent stream updates in the fork.");
    await page
      .getByRole("button", { name: /^(Send message|Create agent)$/ })
      .filter({ visible: true })
      .click();
    await expect
      .poll(async () => (await workspaceSessionEntries(session)).length, { timeout: 30_000 })
      .toBe(2);
    const fork = (await session.client.fetchAgents({ scope: "active" })).entries.find(
      (e) => e.agent.workspaceId === session.workspaceId && e.agent.id !== session.agentId,
    )!.agent;
    await session.client.waitForFinish(fork.id, 45_000);
    await page.getByTestId("workspace-session-canvas-button").filter({ visible: true }).click();
    const canvas = page.getByTestId("session-canvas-screen");
    const sourceCard = canvas.getByTestId(`canvas-card-open-${session.agentId}`);
    const forkCard = canvas.getByTestId(`canvas-card-open-${fork.id}`);
    await expect(sourceCard).toBeVisible();
    await expect(forkCard).toBeVisible();
    await expect(forkCard).toContainText("Forked from Canvas source");
    await expect(canvas.getByTestId(`canvas-edge-${fork.id}`)).toHaveCount(1);
    const sourceBox = (await sourceCard.boundingBox())!;
    const forkBox = (await forkCard.boundingBox())!;
    expect(forkBox.y).toBeGreaterThan(sourceBox.y + sourceBox.height);
    expect(forkBox.y - sourceBox.y - sourceBox.height).toBeLessThan(70);
    await canvas.getByTestId("session-sort-direction").click();
    await expect
      .poll(async () => (await forkCard.boundingBox())!.y < (await sourceCard.boundingBox())!.y)
      .toBe(true);
    await canvas.getByTestId("session-sort-direction").click();
    await page.screenshot({ path: testInfo.outputPath("session-canvas.png") });
    await sourceCard.click();
    const detail = canvas.getByTestId("session-canvas-detail");
    await expect(detail.getByTestId("assistant-message").first()).toBeVisible();
    await canvas.getByTestId("session-canvas-rename").click();
    const renameId = `workspace-tab-rename-modal-agent-${session.agentId}`;
    await renameModalInput(page, renameId).fill("Renamed canvas source");
    await renameModalSubmit(page, renameId).click();
    await expect(detail).toContainText("Renamed canvas source");
    const input = detail.getByRole("textbox", { name: "Message agent..." });
    await expect(input).toBeEditable();
    await input.fill("emit 1 coalesced agent stream updates from the canvas detail.");
    await expect(detail.getByRole("button", { name: "Send message", exact: true })).toBeEnabled();
    await input.press("Control+Enter");
    await expect(
      detail.getByText("emit 1 coalesced agent stream updates from the canvas detail.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("session-canvas-detail.png") });
    await canvas.getByTestId("session-canvas-close-detail").click();
    await expect(detail).toHaveCount(0);
    await canvas.getByTestId("session-sort-input").click();
    await expect
      .poll(async () => (await sourceCard.boundingBox())!.y > (await forkCard.boundingBox())!.y)
      .toBe(true);
    await page.reload();
    await page.getByTestId("workspace-session-canvas-button").filter({ visible: true }).click();
    await expect(canvas.getByTestId("session-sort-input")).toHaveAttribute("aria-selected", "true");
    await sourceCard.click();
    await page.setViewportSize({ width: 430, height: 932 });
    await page.getByTestId("workspace-session-canvas-button").filter({ visible: true }).click();
    await sourceCard.click();
    await expect(detail.getByRole("textbox", { name: "Message agent..." })).toBeEditable();
    await page.screenshot({ path: testInfo.outputPath("session-canvas-compact-detail.png") });
    await canvas.getByTestId("session-canvas-close-detail").click();
    await expect(detail).toHaveCount(0);
    await page.setViewportSize({ width: 1600, height: 1050 });
    await page.getByTestId("workspace-session-canvas-button").filter({ visible: true }).click();
    await sourceCard.click();
    await canvas.getByTestId("session-canvas-open-tab").click();
    await expect(canvas).not.toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message agent..." }).first()).toBeEditable();
  });

  test("forks a failed assistant turn that has no provider message id", async ({
    page,
    seedForkWorkspace,
  }) => {
    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-failed-turn-",
      title: "Assistant fork failed turn",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await submitMessage(page, "Emit a synthetic turn failure.");
    await expect(page.getByText("[System Error] Requested mock provider failure")).toBeVisible({
      timeout: 30_000,
    });

    await forkMostRecentAssistantTurnToNewTab(page);
    await expectChatHistoryAttachment(page);
  });

  test("forks a streaming assistant turn without interrupting it", async ({
    page,
    seedForkWorkspace,
  }) => {
    const visibleBeforeFork = "where the auto-scroll logic actually lives";
    const visibleAfterFork = "the first useful step is to read the relevant files";
    const sourceAgentTitle = "Assistant fork in flight";
    const forkAttachment = observeForkAttachment(page);

    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-in-flight-",
      title: sourceAgentTitle,
      model: "thirty-minute-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await submitMessage(page, "Walk me through the scroll anchor behavior.");

    await expectInFlightForkAvailable(page);
    await expectLiveAssistantText(page, visibleBeforeFork);

    await forkInFlightTurnToNewTab(page);
    await expectChatHistoryAttachment(page);
    expect(await forkAttachment.waitForText()).toContain(visibleBeforeFork);
    await expect(page.getByRole("button", { name: "Menu backdrop", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: sourceAgentTitle }).click();
    await expectLiveAssistantText(page, visibleAfterFork);
  });

  test("focuses a forked assistant turn in a new workspace draft tab", async ({
    page,
    seedForkWorkspace,
  }) => {
    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-focused-tab-",
      title: "Assistant fork focused tab",
      initialPrompt: "emit 1 coalesced agent stream updates for initial assistant fork turn.",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);

    await submitMessage(page, "emit 1 coalesced agent stream updates while this tab is visible.");
    await session.client.waitForFinish(session.agentId, 45_000);
    await awaitAssistantMessage(page);

    const agentTab = page.getByTestId(`workspace-tab-agent_${session.agentId}`);
    await expect(agentTab).toHaveAttribute("aria-selected", "true");

    await forkMostRecentAssistantTurnToNewTab(page);

    const selectedTab = page
      .getByTestId("workspace-tabs-row")
      .getByRole("button")
      .and(page.locator('[aria-selected="true"]'));
    await expect(selectedTab).toHaveAttribute("data-testid", /^workspace-tab-draft_/, {
      timeout: 30_000,
    });
    await expect(agentTab).toHaveAttribute("aria-selected", "false");
    await expectChatHistoryAttachment(page);
  });

  test("keeps the fork attachment after submitting an existing-workspace draft tab", async ({
    page,
    seedForkWorkspace,
  }) => {
    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-tab-submit-",
      title: "Assistant fork tab submit",
      initialPrompt: "emit 1 coalesced agent stream updates for assistant fork tab submit.",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);

    await forkMostRecentAssistantTurnToNewTab(page);
    await expectChatHistoryAttachment(page);

    await submitMessage(page, "");

    const userMessage = page.getByTestId("user-message").filter({ hasText: "Chat history" }).last();
    await expect(userMessage).toBeVisible({ timeout: 30_000 });
    await expect(userMessage).not.toContainText("Source agent:");
  });

  test("forks an assistant turn into New Workspace and keeps the attachment across host changes", async ({
    page,
    seedForkWorkspace,
  }) => {
    await seedSavedSettingsHosts(page, [
      {
        serverId: getServerId(),
        label: "localhost",
        endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
      },
      {
        serverId: "secondary-assistant-fork-host",
        label: "Secondary host",
        // The host does not need to be reachable; this pins that the draft-scoped
        // attachment survives changing the selected target host.
        endpoint: "127.0.0.1:9",
      },
    ]);

    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-workspace-",
      title: "Assistant fork workspace",
      initialPrompt: "emit 1 coalesced agent stream updates for assistant fork new workspace.",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);

    await forkMostRecentAssistantTurnToNewWorkspace(page);

    await expect(page).toHaveURL(/\/new\?.*draftId=/, { timeout: 30_000 });
    await expectChatHistoryAttachment(page);

    await page.getByTestId("host-picker-trigger").click();
    await page
      .getByTestId("new-workspace-host-picker-option-secondary-assistant-fork-host")
      .click();
    await expectChatHistoryAttachment(page);
  });

  test("keeps the fork attachment after the new agent receives its user message", async ({
    page,
    seedForkWorkspace,
  }) => {
    const session = await seedForkWorkspace({
      repoPrefix: "assistant-fork-submit-",
      title: "Assistant fork submit",
      initialPrompt: "emit 1 coalesced agent stream updates for assistant fork submit.",
      model: "ten-second-stream",
    });

    await openAgentRoute(page, session);
    await expectComposerVisible(page);
    await awaitAssistantMessage(page);
    await session.client.waitForFinish(session.agentId, 45_000);

    await forkMostRecentAssistantTurnToNewWorkspace(page);
    await expectChatHistoryAttachment(page);

    await submitNewWorkspaceEmpty(page);

    const userMessage = page.getByTestId("user-message").filter({ hasText: "Chat history" }).last();
    await expect(userMessage).toBeVisible({ timeout: 30_000 });
    await expect(userMessage).not.toContainText("Source agent:");
  });
});
