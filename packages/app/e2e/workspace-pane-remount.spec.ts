import { expect, test } from "./fixtures";
import { expectComposerVisible } from "./helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";

test.describe("Workspace pane mounting", () => {
  test("switching a left tab rail to top tabs during split keeps the composer mounted", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await page.goto("/");
    await page.evaluate(() => {
      const key = "@paseo:app-settings";
      const current = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({ ...current, workspaceTabPlacement: "left" }));
    });
    await page.reload();

    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "pane-remount-",
      title: `pane-remount-${Date.now()}`,
    });

    try {
      await openAgentRoute(page, {
        agentId: workspace.agentId,
        workspaceId: workspace.workspaceId,
      });
      await expectComposerVisible(page);
      await expect(
        page.getByTestId("workspace-tabs-rail").filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByTestId("workspace-new-agent-tab-inline").filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 30_000 });

      const originalComposer = await page
        .getByTestId("message-input-root")
        .filter({ visible: true })
        .first()
        .elementHandle();
      expect(originalComposer).not.toBeNull();

      await page.getByRole("button", { name: "Split pane right" }).first().click();
      await expect(page.getByTestId("message-input-root").filter({ visible: true })).toHaveCount(
        2,
        { timeout: 30_000 },
      );
      await expect(page.getByTestId("workspace-tabs-rail").filter({ visible: true })).toHaveCount(
        0,
      );
      await expect(page.getByTestId("workspace-tabs-row").filter({ visible: true })).toHaveCount(2);

      const originalStillConnected = await originalComposer!.evaluate((node) => node.isConnected);
      expect(originalStillConnected).toBe(true);
    } finally {
      await workspace.cleanup();
    }
  });
});
