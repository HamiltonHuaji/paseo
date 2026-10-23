import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import type { SessionOutboundMessage } from "../messages.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import type { AgentClient, AgentPermissionRequest } from "../agent/agent-sdk-types.js";

function tmpCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "daemon-e2e-"));
}

describe("daemon E2E - persistence", () => {
  let ctx: DaemonTestContext;
  let messages: SessionOutboundMessage[] = [];
  let unsubscribe: (() => void) | null = null;
  let cleaned = false;

  beforeEach(async () => {
    cleaned = false;
    ctx = await createDaemonTestContext();
    messages = [];
    unsubscribe = ctx.client.subscribeRawMessages((message) => {
      messages.push(message);
    });
  });

  afterEach(async () => {
    unsubscribe?.();
    if (!cleaned) {
      await ctx.cleanup();
    }
  }, 60_000);

  test("persists and resumes Codex agent with conversation context", async () => {
    const cwd = tmpCwd();
    try {
      const agent = await ctx.client.createAgent({
        provider: "codex",
        cwd,
        title: "Persistence Test Agent",
        modeId: "full-access",
      });

      messages.length = 0;
      await ctx.client.sendMessage(agent.id, "Say 'state saved' and nothing else");
      const afterMessage = await ctx.client.waitForFinish(agent.id, 5_000);
      expect(afterMessage.status).toBe("idle");
      expect(afterMessage.final?.persistence).toBeTruthy();
      expect(afterMessage.final?.persistence?.provider).toBe("codex");
      expect(afterMessage.final?.persistence?.sessionId).toBeTruthy();
      expect(
        (afterMessage.final?.persistence?.metadata as { conversationId?: string } | undefined)
          ?.conversationId,
      ).toBeTruthy();

      const handle = afterMessage.final!.persistence!;

      await ctx.client.deleteAgent(agent.id);

      const resumed = await ctx.client.resumeAgent(handle);
      expect(resumed.provider).toBe("codex");
      expect(resumed.cwd).toBe(cwd);
      await ctx.client.subscribeAgentTimeline(resumed.id, () => {}).ready;

      messages.length = 0;
      await ctx.client.sendMessage(resumed.id, "What did I ask you to say earlier?");
      const afterResume = await ctx.client.waitForFinish(resumed.id, 5_000);
      expect(afterResume.status).toBe("idle");

      const assistantText = extractAssistantText(messages, resumed.id);
      expect(assistantText.toLowerCase()).toContain("state saved");

      await ctx.client.deleteAgent(resumed.id);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("closed history queries and attention clearing keep the agent closed until explicit interaction", async () => {
    const cwd = tmpCwd();
    const manager = ctx.daemon.daemon.agentManager;
    const storage = ctx.daemon.daemon.agentStorage;
    try {
      const agent = await ctx.client.createAgent({
        provider: "codex",
        cwd,
        model: "gpt-5.4",
        modeId: "full-access",
      });
      await ctx.client.sendMessage(agent.id, "Say 'closed history proof' and nothing else");
      await ctx.client.waitForFinish(agent.id, 5_000);
      await manager.closeAgent(agent.id);
      const before = (await storage.get(agent.id))!;
      expect(before.requiresAttention).toBe(true);
      messages.length = 0;
      const timeline = await ctx.client.fetchAgentTimeline(agent.id, { limit: 0 });
      expect(timeline.agent?.status).toBe("closed");
      expect(timeline.entries.some((entry) => entry.item.type === "assistant_message")).toBe(true);
      const search = await ctx.client.searchAgentTimeline({
        agentId: agent.id,
        query: "closed history proof",
      });
      expect(search.locations.length).toBeGreaterThan(0);
      expect((await ctx.client.listAgentTimelinePrompts(agent.id)).prompts).toHaveLength(1);
      expect((await ctx.client.buildAgentForkContext(agent.id)).itemCount).toBeGreaterThan(0);
      expect((await ctx.client.listProviderSubagents(agent.id)).subagents).toEqual([]);
      await ctx.client.listCommands(agent.id);
      await ctx.client.clearAgentAttention(agent.id);
      expect(manager.getAgent(agent.id)).toBeNull();
      expect(manager.getMetricsSnapshot().total).toBe(0);
      const after = (await storage.get(agent.id))!;
      expect(after.lastStatus).toBe("closed");
      expect(after.persistence).toEqual(before.persistence);
      expect(after.requiresAttention).toBe(false);
      expect(
        messages
          .filter(
            (message) =>
              message.type === "agent_update" &&
              message.payload.kind === "upsert" &&
              message.payload.agent.id === agent.id,
          )
          .every(
            (message) =>
              message.type === "agent_update" &&
              message.payload.kind === "upsert" &&
              message.payload.agent.status === "closed",
          ),
      ).toBe(true);
      await ctx.client.sendMessage(agent.id, "Say 'explicit continuation' and nothing else");
      expect((await ctx.client.waitForFinish(agent.id, 5_000)).status).toBe("idle");
      expect(manager.getAgent(agent.id)?.lifecycle).toBe("idle");
      await manager.closeAgent(agent.id);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("answering a question displayed in closed history explicitly resumes its writer", async () => {
    const cwd = tmpCwd();
    const base = createTestAgentClients().codex!;
    const pending: AgentPermissionRequest = {
      id: "recoverable-question",
      provider: "codex",
      name: "request_user_input",
      kind: "question",
      title: "Choose",
      input: { questions: [{ title: "Which?", options: ["Blue", "Green"] }] },
    };
    let answered = false;
    const purposes: unknown[] = [];
    const provider: AgentClient = {
      provider: base.provider,
      capabilities: base.capabilities,
      isAvailable: () => base.isAvailable(),
      fetchCatalog: (options) => base.fetchCatalog(options),
      createSession: (config, context) => base.createSession(config, context),
      resumeSession: async (handle, config, context, options) => {
        purposes.push(options?.purpose);
        const session = await base.resumeSession(handle, config, context, options);
        session.getPendingPermissions = () => (answered ? [] : [pending]);
        session.respondToPermission = async (requestId, response) => {
          expect(requestId).toBe(pending.id);
          expect(response).toMatchObject({
            behavior: "allow",
            updatedInput: { answers: { "Question 1": "Green" } },
          });
          answered = true;
        };
        return session;
      },
    };
    await ctx.cleanup();
    ctx = await createDaemonTestContext({ agentClients: { codex: provider } });
    try {
      const agent = await ctx.client.createAgent({ provider: "codex", cwd, model: "gpt-5.4" });
      await ctx.daemon.daemon.agentManager.closeAgent(agent.id);
      const history = await ctx.client.fetchAgentTimeline(agent.id);
      expect(history.agent?.status).toBe("closed");
      expect(history.agent?.pendingPermissions.map((request) => request.id)).toEqual([pending.id]);
      expect(ctx.daemon.daemon.agentManager.getAgent(agent.id)).toBeNull();
      await ctx.client.respondToPermission(agent.id, pending.id, {
        behavior: "allow",
        updatedInput: { answers: { "Question 1": "Green" } },
      });
      await expect.poll(() => answered).toBe(true);
      expect(purposes).toEqual(["history", "interactive"]);
      expect(ctx.daemon.daemon.agentManager.getAgent(agent.id)?.lifecycle).toBe("idle");
      await ctx.daemon.daemon.agentManager.closeAgent(agent.id);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("timeline survives daemon restart", async () => {
    const cwd = tmpCwd();
    const paseoHomeRoot = mkdtempSync(path.join(tmpdir(), "paseo-home-root-"));
    try {
      // Start daemon with a stable on-disk home so "restart" can observe persisted timeline.
      await ctx.cleanup();
      ctx = await createDaemonTestContext({ paseoHomeRoot, cleanup: false });
      unsubscribe?.();
      messages = [];
      unsubscribe = ctx.client.subscribeRawMessages((message) => {
        messages.push(message);
      });

      const agent = await ctx.client.createAgent({
        provider: "codex",
        cwd,
        title: "Restart Timeline Test Agent",
        modeId: "full-access",
      });
      const agentId = agent.id;

      messages.length = 0;
      await ctx.client.sendMessage(agentId, "Say 'timeline test' and nothing else");
      const afterMessage = await ctx.client.waitForFinish(agentId, 5_000);
      expect(afterMessage.status).toBe("idle");
      expect(afterMessage.final?.persistence).toBeTruthy();

      await ctx.cleanup();
      ctx = await createDaemonTestContext({ paseoHomeRoot, cleanup: false });
      unsubscribe?.();
      messages = [];
      unsubscribe = ctx.client.subscribeRawMessages((message) => {
        messages.push(message);
      });

      const timeline = await ctx.client.fetchAgentTimeline(agentId, {
        direction: "tail",
        limit: 0,
      });
      const timelineItems = timeline.entries.map((entry) => entry.item);
      expect(timelineItems.length).toBeGreaterThan(0);
      const assistantMessages = timelineItems.filter(
        (item): item is Extract<(typeof timelineItems)[number], { type: "assistant_message" }> =>
          item.type === "assistant_message",
      );
      expect(assistantMessages.length).toBeGreaterThan(0);
      expect(assistantMessages.map((item) => item.text).join("")).toBe("timeline test");
    } finally {
      await ctx.cleanup();
      cleaned = true;
      rmSync(cwd, { recursive: true, force: true });
      rmSync(paseoHomeRoot, { recursive: true, force: true });
    }
  }, 30_000);
});

function extractAssistantText(queue: SessionOutboundMessage[], agentId: string): string {
  const parts: string[] = [];
  for (const m of queue) {
    if (m.type !== "agent_stream") continue;
    if (m.payload.agentId !== agentId) continue;
    if (m.payload.event.type !== "timeline") continue;
    const item = m.payload.event.item;
    if (item.type === "assistant_message") {
      parts.push(item.text);
    }
  }
  return parts.join("");
}
