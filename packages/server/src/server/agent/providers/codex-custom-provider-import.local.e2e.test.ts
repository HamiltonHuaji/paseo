import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { AgentSession, AgentStreamEvent } from "../agent-sdk-types.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import { CodexAppServerAgentClient } from "./codex-app-server-agent.js";

// Runs the real `codex` binary against a local Responses endpoint standing in
// for a custom provider's OPENAI_BASE_URL, so no login is needed.

function sse(events: Array<Record<string, unknown>>): string {
  return events
    .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

function finalAnswer(index: number): string {
  return sse([
    { type: "response.created", response: { id: `resp-${index}` } },
    {
      type: "response.output_item.done",
      item: {
        type: "message",
        role: "assistant",
        id: `msg-${index}`,
        content: [{ type: "output_text", text: "done" }],
      },
    },
    {
      type: "response.completed",
      response: {
        id: `resp-${index}`,
        usage: {
          input_tokens: 0,
          input_tokens_details: null,
          output_tokens: 0,
          output_tokens_details: null,
          total_tokens: 0,
        },
      },
    },
  ]);
}

async function startResponsesEndpoint(): Promise<{
  baseUrl: string;
  server: Server;
  requestCount: () => number;
  bodies: Array<Record<string, unknown>>;
}> {
  let requests = 0;
  const bodies: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/v1/responses") {
        res.statusCode = 404;
        res.end();
        return;
      }
      requests += 1;
      bodies.push(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>);
      res.setHeader("content-type", "text/event-stream");
      res.end(finalAnswer(requests));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no server address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    server,
    requestCount: () => requests,
    bodies,
  };
}

function expectExecution(
  body: Record<string, unknown> | undefined,
  model: string,
  effort: string,
  tier: string,
): void {
  expect(body).toMatchObject({ model, reasoning: { effort } });
  expect(body?.service_tier ?? "default").toBe(tier);
}

async function closeServer(server: Server): Promise<void> {
  server.close();
  await once(server, "close");
}

describe("Codex custom provider import list", () => {
  const cleanups: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
  });

  test("lists a custom provider's session under that provider and imports it there", async () => {
    const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-custom-import-home-"));
    const cwd = mkdtempSync(path.join(os.tmpdir(), "codex-custom-import-cwd-"));
    cleanups.push(() => rmSync(codexHome, { recursive: true, force: true }));
    cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
    const { baseUrl, server, requestCount } = await startResponsesEndpoint();
    cleanups.push(() => closeServer(server));

    const logger = createTestLogger();
    const customCodex = new CodexAppServerAgentClient(
      logger,
      { env: { CODEX_HOME: codexHome, OPENAI_BASE_URL: baseUrl, OPENAI_API_KEY: "test-key" } },
      { customProvider: { id: "my-codex", label: "My Codex", extends: "codex" } },
    );
    const stockCodex = new CodexAppServerAgentClient(logger, { env: { CODEX_HOME: codexHome } });

    const session = await customCodex.createSession({
      provider: "codex",
      cwd,
      model: "mock-model",
    });
    try {
      await session.run("hello from the custom provider");
    } finally {
      await session.close();
    }

    const customSessions = await customCodex.listImportableSessions({ cwd });
    const stockSessions = await stockCodex.listImportableSessions({ cwd });

    expect(customSessions.map((entry) => entry.firstPromptPreview)).toEqual([
      "hello from the custom provider",
    ]);
    expect(stockSessions).toEqual([]);

    const config = { provider: "codex", cwd, model: "mock-model" };
    const imported = await customCodex.importSession(
      { providerHandleId: customSessions[0].providerHandleId, cwd },
      { config, storedConfig: config },
    );
    const requestsBeforeImportedTurn = requestCount();
    try {
      await imported.session.run("hello again after import");
    } finally {
      await imported.session.close();
    }
    expect(requestCount()).toBeGreaterThan(requestsBeforeImportedTurn);
  }, 120_000);

  test("project profiles execute their defaults, retain selection intent, and discover sibling worktrees", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codex-project-context-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const { baseUrl, server, bodies } = await startResponsesEndpoint();
    cleanups.push(() => closeServer(server));
    const handles: string[] = [];
    for (const [name, model, effort, tier] of [
      ["alpha", "gpt-6-astra", "xhigh", "priority"],
      ["beta", "gpt-6-sol", "high", "default"],
    ]) {
      const cwd = path.join(root, name!);
      const home = path.join(root, `${name}-profile`);
      const worktree = path.join(root, `${name}-checkout`);
      mkdirSync(cwd);
      mkdirSync(home);
      execFileSync("git", ["init", "-q", cwd]);
      execFileSync("git", [
        "-C",
        cwd,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "--allow-empty",
        "-qm",
        "fixture",
      ]);
      execFileSync("git", ["-C", cwd, "worktree", "add", "-qb", "fixture", worktree]);
      const writeConfig = (nextModel: string, nextEffort: string, nextTier: string) =>
        writeFileSync(
          path.join(home, "config.toml"),
          `model=${JSON.stringify(nextModel)}
model_reasoning_effort=${JSON.stringify(nextEffort)}
service_tier=${JSON.stringify(nextTier)}
model_provider="fixture"
approval_policy="never"
sandbox_mode="read-only"
[model_providers.fixture]
name="Fixture"
base_url=${JSON.stringify(baseUrl)}
wire_api="responses"
request_max_retries=0
stream_max_retries=0
`,
        );
      writeConfig(model!, effort!, tier!);
      const skills = path.join(home, "skills", "context-proof");
      mkdirSync(skills, { recursive: true });
      writeFileSync(
        path.join(skills, "SKILL.md"),
        "---\nname: context-proof\ndescription: Use to verify shared project context.\n---\nShared skill sentinel for context verification.\n",
      );
      const makeClient = () =>
        new CodexAppServerAgentClient(createTestLogger(), {
          env: { CODEX_HOME: home, PASEO_CODEX_STORAGE: "project" },
        });
      const client = makeClient();
      const catalog = await client.fetchCatalog({ scope: "workspace", cwd: worktree, force: true });
      expect(catalog.models.find((entry) => entry.isDefault)?.id).toBe(model);
      const session = await client.createSession({ provider: "codex", cwd: worktree });
      cleanups.push(() => session.close());
      expect(
        (await session.listCommands()).some((command) => command.name === "context-proof"),
      ).toBe(true);
      await session.run("/context-proof Reply with done.");
      expectExecution(bodies.at(-1), model!, effort!, tier!);
      expect(JSON.stringify(bodies.at(-1)?.input)).toContain("Shared skill sentinel");
      const handle = session.describePersistence()!;
      expect(handle.metadata.model).toBeNull();
      expect(handle.metadata.thinkingOptionId).toBeNull();
      handles.push(handle.sessionId);
      await session.close();
      const listed = await client.listImportableSessionsPage({ cwd, limit: 100 });
      expect(listed.cwdScoped).toBe(true);
      expect(listed.sessions.map((entry) => entry.providerHandleId)).toEqual([handle.sessionId]);
      if (handles.length > 1)
        expect(listed.sessions.map((entry) => entry.providerHandleId)).not.toContain(handles[0]);
      const nextModel = model === "gpt-6-astra" ? "gpt-6-sol" : "gpt-6-astra";
      const keyBefore = await client.getCatalogCacheKey({ scope: "workspace", cwd });
      writeConfig(nextModel, "medium", "default");
      expect(await client.getCatalogCacheKey({ scope: "workspace", cwd })).not.toBe(keyBefore);
      const restarted = await makeClient().resumeSession(handle);
      cleanups.push(() => restarted.close());
      await restarted.run("defaults after restart");
      expectExecution(bodies.at(-1), nextModel, "medium", "default");
      writeConfig(model!, effort!, tier!);
      await restarted.run("defaults after configuration update");
      expectExecution(bodies.at(-1), model!, effort!, tier!);
      await restarted.setModel!(model!);
      await restarted.setThinkingOption!("low");
      await restarted.setFeature!("service_tier", "default");
      const selected = restarted.describePersistence()!;
      expect(selected.metadata).toMatchObject({
        model,
        thinkingOptionId: "low",
        featureValues: { service_tier: "default" },
      });
      await restarted.close();
      writeConfig(nextModel, "high", "priority");
      const explicit = await makeClient().resumeSession(selected);
      cleanups.push(() => explicit.close());
      await explicit.run("explicit choices survive changed defaults and restart");
      expectExecution(bodies.at(-1), model!, "low", "default");
      await explicit.close();
      writeConfig(model!, effort!, tier!);
      const config = { provider: "codex", cwd };
      const imported = await makeClient().importSession(
        { providerHandleId: handle.sessionId, cwd },
        { config, storedConfig: config },
      );
      cleanups.push(() => imported.session.close());
      expect(imported.session.id).toBe(handle.sessionId);
      expect(JSON.stringify(imported.timeline)).toContain("defaults after restart");
      const turn = async (active: AgentSession, prompt: string) => {
        const events: AgentStreamEvent[] = [];
        const unsubscribe = active.subscribe((event) => events.push(event));
        try {
          await active.run(prompt);
        } finally {
          unsubscribe();
        }
        expect(bodies.at(-1)).toMatchObject({ model, reasoning: { effort } });
        expect(bodies.at(-1)?.service_tier ?? "default").toBe(tier);
        const user = events.findLast(
          (event) => event.type === "timeline" && event.item.type === "user_message",
        );
        if (user?.type !== "timeline" || user.item.type !== "user_message" || !user.item.messageId)
          throw new Error("Missing native user message boundary");
        return user.item.messageId;
      };
      const boundary = await turn(imported.session, "continue the imported source");
      const fork = await makeClient().forkSession(imported.session, {
        boundaryMessageId: boundary,
        isLatestCompletedTurn: true,
        targetConfig: config,
      });
      cleanups.push(() => fork.close());
      expect(fork.id).not.toBe(handle.sessionId);
      expect(fork.describePersistence()?.metadata.paseoCodexHome).toBe(
        handle.metadata.paseoCodexHome,
      );
      await turn(fork, "execute the conversation fork");
      await fork.close();
      const copied = await makeClient().importSession(
        { providerHandleId: handle.sessionId, cwd, fork: true },
        { config, storedConfig: config },
      );
      cleanups.push(() => copied.session.close());
      expect(copied.session.id).not.toBe(handle.sessionId);
      await turn(copied.session, "keep this copy turn");
      const rewindBoundary = await turn(copied.session, "remove this copy turn");
      const beforeRewind = copied.session.describePersistence()!;
      await copied.session.revertConversation!({ messageId: rewindBoundary });
      const rewound = copied.session.describePersistence()!;
      expect(rewound.sessionId).not.toBe(beforeRewind.sessionId);
      expect(rewound.metadata.paseoCodexHome).toBe(handle.metadata.paseoCodexHome);
      expect(rewound.metadata.branchOperations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operation: "rewind", sourceThreadId: beforeRewind.sessionId }),
        ]),
      );
      await copied.session.close();
      await client.archiveNativeSession(rewound);
      const archived = await makeClient().resumeSession(rewound, undefined, undefined, {
        purpose: "history",
      });
      cleanups.push(() => archived.close());
      const archivedEvents = [];
      for await (const event of archived.streamHistory()) archivedEvents.push(event);
      expect(JSON.stringify(archivedEvents)).toContain("keep this copy turn");
      expect(JSON.stringify(archivedEvents)).not.toContain("remove this copy turn");
      await archived.close();
      await client.unarchiveNativeSession(rewound);
      const restored = await makeClient().resumeSession(rewound);
      cleanups.push(() => restored.close());
      await turn(restored, "continue restored branch");
      await restored.close();
      await imported.session.close();
      expect(existsSync(path.join(home, "sessions"))).toBe(false);
      const legacyClient = new CodexAppServerAgentClient(createTestLogger(), {
        env: { CODEX_HOME: home, PASEO_CODEX_STORAGE: "global" },
      });
      const legacy = await legacyClient.createSession(config);
      cleanups.push(() => legacy.close());
      await turn(legacy, "existing user-home session");
      const legacyHandle = legacy.describePersistence()!;
      await legacy.close();
      const discovered: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await client.listImportableSessionsPage({ cwd, limit: 100, cursor });
        discovered.push(...page.sessions.map((entry) => entry.providerHandleId));
        cursor = page.nextCursor;
      } while (cursor);
      expect(discovered).toContain(legacyHandle.sessionId);
      const legacyImported = await makeClient().importSession(
        { providerHandleId: legacyHandle.sessionId, cwd },
        { config, storedConfig: config },
      );
      cleanups.push(() => legacyImported.session.close());
      expect(legacyImported.session.describePersistence()?.metadata.paseoCodexHome).toBe(home);
      await legacyImported.session.close();
      try {
        const legacyCopy = await makeClient().importSession(
          { providerHandleId: legacyHandle.sessionId, cwd, fork: true },
          { config, storedConfig: config },
        );
        cleanups.push(() => legacyCopy.session.close());
        expect(legacyCopy.persistence.metadata?.paseoCodexHome).toBe(
          handle.metadata.paseoCodexHome,
        );
        expect(legacyCopy.persistence.sessionId).not.toBe(legacyHandle.sessionId);
        expect(JSON.stringify(legacyCopy.timeline)).toContain("existing user-home session");
        await turn(legacyCopy.session, "continue legacy copy in project storage");
        await legacyCopy.session.close();
      } catch (error) {
        // Codex 0.162.1 cannot resolve a paginated source tree through a path in
        // another home. Future native versions may support the same request.
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain(
          "cannot copy this session between Codex storage homes",
        );
      }
      const originalLegacy = await legacyClient.resumeSession(legacyHandle, undefined, undefined, {
        purpose: "history",
      });
      cleanups.push(() => originalLegacy.close());
      const legacyEvents = [];
      for await (const event of originalLegacy.streamHistory()) legacyEvents.push(event);
      expect(JSON.stringify(legacyEvents)).toContain("existing user-home session");
      expect(JSON.stringify(legacyEvents)).not.toContain("continue legacy copy in project storage");
      await originalLegacy.close();
      expect(readFileSync(path.join(skills, "SKILL.md"), "utf8")).toContain(
        "Shared skill sentinel",
      );
      execFileSync("git", ["-C", cwd, "worktree", "remove", worktree]);
      const history = await makeClient().resumeSession(handle, undefined, undefined, {
        purpose: "history",
      });
      cleanups.push(() => history.close());
      const events = [];
      for await (const event of history.streamHistory()) events.push(event);
      expect(JSON.stringify(events)).toContain("defaults after configuration update");
      await history.close();
    }
  }, 120_000);
});
