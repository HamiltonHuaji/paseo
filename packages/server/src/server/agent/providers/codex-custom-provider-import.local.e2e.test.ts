import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

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
      expect(bodies.at(-1)).toMatchObject({ model, reasoning: { effort } });
      expect(bodies.at(-1)?.service_tier ?? "default").toBe(tier);
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
      expect(bodies.at(-1)).toMatchObject({ model: nextModel, reasoning: { effort: "medium" } });
      expect(bodies.at(-1)?.service_tier ?? "default").toBe("default");
      writeConfig(model!, effort!, tier!);
      await restarted.run("defaults after configuration update");
      expect(bodies.at(-1)).toMatchObject({ model, reasoning: { effort } });
      expect(bodies.at(-1)?.service_tier ?? "default").toBe(tier);
      await restarted.close();
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
