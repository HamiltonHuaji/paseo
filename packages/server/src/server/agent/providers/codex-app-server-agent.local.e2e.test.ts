import { describe, expect, test, vi } from "vitest";
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { createHash } from "node:crypto";

import { AgentManager } from "../agent-manager.js";
import { AgentStorage } from "../agent-storage.js";
import { ensureAgentLoaded } from "../agent-loading.js";

import { CodexAppServerAgentClient, CodexAppServerAgentSession } from "./codex-app-server-agent.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentStreamEvent } from "../agent-sdk-types.js";

function isCodexInstalled(): boolean {
  try {
    const out = execFileSync("which", ["codex"], { encoding: "utf8" }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

function sse(events: unknown[]): string {
  return events
    .map((event) => {
      const type =
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        typeof (event as { type?: unknown }).type === "string"
          ? (event as { type: string }).type
          : "message";
      return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
    })
    .join("");
}

function responseCreated(id: string): Record<string, unknown> {
  return {
    type: "response.created",
    response: { id },
  };
}

function responseCompleted(id: string): Record<string, unknown> {
  return {
    type: "response.completed",
    response: {
      id,
      usage: {
        input_tokens: 0,
        input_tokens_details: null,
        output_tokens: 0,
        output_tokens_details: null,
        total_tokens: 0,
      },
    },
  };
}

function functionCallEvent(
  callId: string,
  name: string,
  argumentsJson: string,
  namespace?: string,
): Record<string, unknown> {
  return {
    type: "response.output_item.done",
    item: {
      type: "function_call",
      call_id: callId,
      name,
      ...(namespace ? { namespace } : {}),
      arguments: argumentsJson,
    },
  };
}

function assistantMessageEvent(id: string, text: string): Record<string, unknown> {
  return {
    type: "response.output_item.done",
    item: {
      type: "message",
      role: "assistant",
      id,
      content: [{ type: "output_text", text }],
    },
  };
}

function requestUserInputSse(callId: string): string {
  return sse([
    responseCreated("resp-1"),
    functionCallEvent(
      callId,
      "request_user_input",
      JSON.stringify({
        questions: [
          {
            id: "confirm_path",
            header: "Confirm",
            question: "Proceed with the plan?",
            options: [
              {
                label: "Yes (Recommended)",
                description: "Continue the current plan.",
              },
              {
                label: "No",
                description: "Stop and revisit the approach.",
              },
            ],
          },
        ],
      }),
    ),
    responseCompleted("resp-1"),
  ]);
}

function assistantMessageSse(text: string): string {
  return sse([
    responseCreated("resp-2"),
    assistantMessageEvent("msg-1", text),
    responseCompleted("resp-2"),
  ]);
}

async function startMockResponsesServer(
  sequence: (string | null)[] | ((body: string, index: number) => string | null),
): Promise<{
  url: string;
  close: () => Promise<void>;
  requestBodies: string[];
}> {
  const requestBodies: string[] = [];
  let index = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      requestBodies.push(Buffer.concat(chunks).toString("utf8"));
      if (req.method !== "POST" || req.url !== "/v1/responses") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      let body: string | null;
      if (typeof sequence === "function") body = sequence(requestBodies.at(-1)!, index);
      else if (sequence[index] === null) body = null;
      else body = sequence[index] ?? assistantMessageSse("done");
      index += 1;
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.setHeader("cache-control", "no-cache");
      if (body === null) {
        res.write(sse([responseCreated("interrupted-response")]));
      } else {
        res.end(body);
      }
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP address for mock responses server");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    requestBodies,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  };
}

function writeMockCodexConfig(codexHome: string, serverUrl: string): void {
  writeFileSync(
    path.join(codexHome, "config.toml"),
    `
model = "mock-model"
approval_policy = "on-request"
sandbox_mode = "read-only"

model_provider = "mock_provider"

[model_providers.mock_provider]
name = "Mock provider for test"
base_url = "${serverUrl}/v1"
wire_api = "responses"
request_max_retries = 0
stream_max_retries = 0
`,
  );
}

function waitForEvent<TEvent extends AgentStreamEvent>(params: {
  session: {
    subscribe(callback: (event: AgentStreamEvent) => void): () => void;
  };
  predicate: (event: AgentStreamEvent) => event is TEvent;
  timeoutMs: number;
  label: string;
}): Promise<TEvent> {
  return new Promise<TEvent>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${params.label}`));
    }, params.timeoutMs);

    const unsubscribe = params.session.subscribe((event) => {
      if (!params.predicate(event)) {
        return;
      }
      clearTimeout(timeout);
      unsubscribe();
      resolve(event);
    });
  });
}

function isUserMessage(item: { role?: string }): boolean {
  return item.role === "user";
}

describe("Codex app-server provider (local e2e)", () => {
  test.runIf(isCodexInstalled()).each(["held", "completed", "failed"] as const)(
    "keeps real child lifecycle distinct from parent completion (%s)",
    async (childOutcome) => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "codex-child-lifecycle-"));
      const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-child-home-"));
      let parentRequests = 0;
      let childRequests = 0;
      const model = await startMockResponsesServer((body) => {
        const request = JSON.parse(body);
        const userMessages = request.input.filter(isUserMessage);
        if (JSON.stringify(userMessages.at(-1)).includes("ISOLATED_CHILD_TASK")) {
          childRequests++;
          if (childOutcome === "held") return null;
          if (childOutcome === "failed")
            return sse([
              { type: "error", code: "server_error", message: "isolated child model failed" },
            ]);
          return assistantMessageSse("child completed normally");
        }
        parentRequests++;
        return parentRequests === 1
          ? sse([
              responseCreated("spawn"),
              functionCallEvent(
                "child-spawn",
                "spawn_agent",
                JSON.stringify({ message: "ISOLATED_CHILD_TASK", fork_context: false }),
                "multi_agent_v1",
              ),
              responseCompleted("spawn"),
            ])
          : assistantMessageSse("parent finished independently");
      });
      const provider = new CodexAppServerAgentClient(createTestLogger());
      const config = { provider: "codex", cwd, modeId: "auto", model: "mock-model" };
      const context = { env: { CODEX_HOME: codexHome } };
      let session: Awaited<ReturnType<typeof provider.createSession>> | undefined;
      try {
        writeMockCodexConfig(codexHome, model.url);
        session = await provider.createSession(config, context);
        const events: AgentStreamEvent[] = [];
        session.subscribe((event) => events.push(event));
        const result = await session.run("Create one local child and finish without waiting.");
        expect(result.finalText).toContain("parent finished independently");
        await expect.poll(() => childRequests).toBeGreaterThan(0);
        const updates = () =>
          events.filter(
            (event): event is Extract<AgentStreamEvent, { type: "provider_subagent" }> =>
              event.type === "provider_subagent",
          );
        const childState = () =>
          updates()
            .map((event) => event.event)
            .findLast((event) => event.type === "upsert" && event.status !== undefined);
        await expect
          .poll(() => childState())
          .toMatchObject({ status: childOutcome === "held" ? "running" : childOutcome });
        expect(events.some((event) => event.type === "turn_completed")).toBe(true);
        const childId = childState()!.id;
        const nativeHistory = await (
          session as unknown as {
            client: {
              request(
                method: string,
                params: unknown,
              ): Promise<{
                thread: { turns: Array<{ id: string; status: string; error: unknown }> };
              }>;
            };
          }
        ).client.request("thread/read", { threadId: childId, includeTurns: true });
        process.stdout.write(
          "NATIVE_CHILD " +
            JSON.stringify({
              outcome: childOutcome,
              turns: nativeHistory.thread.turns.map((turn) => ({
                id: turn.id,
                status: turn.status,
                error: turn.error,
              })),
            }) +
            "\n",
        );
        const handle = session.describePersistence()!;
        await session.close();
        session = await provider.resumeSession(handle, config, context, { purpose: "history" });
        const history: AgentStreamEvent[] = [];
        for await (const event of session.streamHistory()) history.push(event);
        const replayed = history
          .filter(
            (event): event is Extract<AgentStreamEvent, { type: "provider_subagent" }> =>
              event.type === "provider_subagent",
          )
          .map((event) => event.event)
          .filter((event) => event.type === "upsert" && event.status !== undefined);
        if (childOutcome === "held") {
          expect(replayed).toEqual(
            expect.arrayContaining([expect.objectContaining({ executionStatus: "unknown" })]),
          );
        } else {
          expect(replayed.at(-1)).toMatchObject({ status: childOutcome, executionStatus: null });
          expect(
            history.findLast(
              (event) =>
                event.type === "timeline" &&
                event.item.type === "tool_call" &&
                event.item.callId === "child-spawn",
            ),
          ).toMatchObject({ item: { status: childOutcome, metadata: { executionStatus: null } } });
        }
      } finally {
        await session?.close();
        await model.close();
        rmSync(cwd, { recursive: true, force: true });
        rmSync(codexHome, { recursive: true, force: true });
      }
    },
    30_000,
  );

  test.runIf(isCodexInstalled() && process.platform !== "win32")(
    "recovers a durable rewind intent after the native fork process is killed before commit",
    async () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "codex-rewind-crash-"));
      const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-rewind-crash-home-"));
      const model = await startMockResponsesServer([
        assistantMessageSse("before boundary"),
        assistantMessageSse("after boundary"),
      ]);
      const storagePath = path.join(cwd, "agents");
      const workerPath = path.join(cwd, "crash.mjs");
      const receiptPath = path.join(cwd, "receipt.json");
      const logger = createTestLogger();
      let worker: ChildProcessWithoutNullStreams | undefined;
      let manager: AgentManager | undefined;
      let id: string | undefined;
      try {
        writeMockCodexConfig(codexHome, model.url);
        writeFileSync(
          workerPath,
          `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import pino from ${JSON.stringify(import.meta.resolve("pino"))};
import { AgentManager } from ${JSON.stringify(new URL("../agent-manager.ts", import.meta.url).href)};
import { AgentStorage } from ${JSON.stringify(new URL("../agent-storage.ts", import.meta.url).href)};
import { CodexAppServerAgentClient, CodexAppServerAgentSession } from ${JSON.stringify(new URL("./codex-app-server-agent.ts", import.meta.url).href)};
import { CodexAppServerClient } from ${JSON.stringify(new URL("./codex/app-server-transport.ts", import.meta.url).href)};
const logger = pino({ level: "silent" });
const cwd = ${JSON.stringify(cwd)};
const codexHome = ${JSON.stringify(codexHome)};
class NativeClient extends CodexAppServerAgentClient {
  async createSession(config) {
    const session = new CodexAppServerAgentSession(config, null, logger, async () => spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CODEX_HOME: codexHome } }), { codexHome, environment: { CODEX_HOME: codexHome } });
    await session.connect();
    return session;
  }
}
const storage = new AgentStorage(${JSON.stringify(storagePath)}, logger);
const manager = new AgentManager({ clients: { codex: new NativeClient(logger) }, registry: storage, logger, serverId: "rewind-crash-host" });
const agent = await manager.createAgent({ provider: "codex", cwd, modeId: "auto", model: "mock-model", title: "Retain after interrupted rewind" }, undefined, { workspaceId: "crash-workspace" });
await manager.runAgent(agent.id, "before-boundary");
await manager.runAgent(agent.id, "rewind-this-turn");
const user = manager.getTimeline(agent.id).filter(item => item.type === "user_message");
const before = manager.getAgent(agent.id).persistence;
const request = CodexAppServerClient.prototype.request;
CodexAppServerClient.prototype.request = async function(method, params, timeout) {
  const result = await request.call(this, method, params, timeout);
  if (method === "thread/fork") {
    writeFileSync(${JSON.stringify(receiptPath)}, JSON.stringify({ id: agent.id, before, boundary: user[1].messageId, forkId: result.thread.id }));
    // The worker owns this detached group; terminate it and its native app-server together.
    process.kill(-process.pid, "SIGKILL");
  }
  return result;
};
await manager.rewind(agent.id, user[1].messageId, "conversation");
throw new Error("Expected the interruption boundary to terminate the worker");
`,
        );
        worker = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), workerPath], {
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let diagnostic = "";
        worker.stderr.on("data", (chunk) => {
          diagnostic += chunk.toString();
        });
        const [code, signal] = await once(worker, "exit");
        expect({ code, signal }, diagnostic).toEqual({ code: null, signal: "SIGKILL" });
        const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
        id = receipt.id;
        const storage = new AgentStorage(storagePath, logger);
        const saved = await storage.get(receipt.id);
        expect(saved).toMatchObject({
          title: "Retain after interrupted rewind",
          workspaceId: "crash-workspace",
          persistence: {
            sessionId: receipt.before.sessionId,
            metadata: { rewindPending: { messageId: receipt.boundary } },
          },
          lastError: expect.stringContaining("original branch remains recoverable"),
        });
        expect(receipt.forkId).not.toBe(receipt.before.sessionId);
        manager = new AgentManager({
          clients: { codex: new CodexAppServerAgentClient(logger) },
          registry: storage,
          logger,
          serverId: "rewind-crash-host",
        });
        const historySnapshot = await ensureAgentLoaded(receipt.id, {
          agentManager: manager,
          agentStorage: storage,
          logger,
          purpose: "history",
        });
        expect(historySnapshot.lifecycle).toBe("closed");
        expect(historySnapshot.persistence?.sessionId).toBe(receipt.before.sessionId);
        expect(manager.getAgent(receipt.id)).toBeNull();
        expect(
          manager.getTimeline(receipt.id).filter((item) => item.type === "user_message"),
        ).toHaveLength(2);
        const completedBoundary = manager
          .getTimeline(receipt.id)
          .find((item) => item.type === "assistant_message");
        if (completedBoundary?.type !== "assistant_message")
          throw new Error("Expected a completed reply");
        const historicalFork = await manager.forkAgentFromConversation(
          { agentId: receipt.id, boundaryMessageId: completedBoundary.messageId },
          { provider: "codex", cwd, model: "mock-model", modeId: "full-access" },
          undefined,
          { workspaceId: "crash-workspace" },
        );
        expect(manager.getAgent(receipt.id)).toBeNull();
        expect(historicalFork.persistence!.sessionId).not.toBe(receipt.before.sessionId);
        expect(await storage.get(receipt.id)).toMatchObject({
          persistence: { metadata: { rewindPending: expect.anything() } },
        });
        await manager.closeAgent(historicalFork.id);
        // The retry is an explicit interaction after the closed history read.
        await ensureAgentLoaded(receipt.id, {
          agentManager: manager,
          agentStorage: storage,
          logger,
        });
        await manager.rewind(receipt.id, receipt.boundary, "conversation");
        const first = manager.getAgent(receipt.id)!;
        expect(first.id).toBe(receipt.id);
        expect(first.persistence?.sessionId).not.toBe(receipt.before.sessionId);
        expect(first.persistence?.metadata?.rewindPending).toBeUndefined();
        expect(
          manager.getTimeline(receipt.id).filter((item) => item.type === "user_message"),
        ).toHaveLength(1);
        const remaining = manager
          .getTimeline(receipt.id)
          .find((item) => item.type === "user_message")!;
        await manager.rewind(
          receipt.id,
          remaining.type === "user_message" ? remaining.messageId! : "",
          "conversation",
        );
        const second = manager.getAgent(receipt.id)!;
        expect(second.persistence?.sessionId).not.toBe(first.persistence?.sessionId);
        expect(second.sessionLineage?.filter((entry) => entry.operation === "rewind")).toHaveLength(
          2,
        );
        await manager.closeAgent(receipt.id);
        expect(
          (await new AgentStorage(storagePath, logger).get(receipt.id))?.sessionLineage,
        ).toHaveLength(2);
      } finally {
        if (id && manager?.getAgent(id)) await manager.closeAgent(id);
        if (worker?.pid && worker.exitCode === null && worker.signalCode === null)
          process.kill(-worker.pid, "SIGKILL");
        await model.close();
        rmSync(cwd, { recursive: true, force: true });
        rmSync(codexHome, { recursive: true, force: true });
      }
    },
    45_000,
  );

  test.runIf(isCodexInstalled())(
    "forks an old completed tool boundary during a long native turn and reads history without a writer",
    async () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "codex-long-lifecycle-"));
      const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-long-home-"));
      const workspaceFile = path.join(cwd, "keep.txt");
      writeFileSync(workspaceFile, "workspace stays unchanged\n");
      const tool = sse([
        responseCreated("context-tool"),
        functionCallEvent(
          "context-tool",
          "exec_command",
          JSON.stringify({ cmd: "printf TOOL_CONTEXT_BOUNDARY" }),
        ),
        responseCompleted("context-tool"),
      ]);
      const model = await startMockResponsesServer([
        tool,
        assistantMessageSse("boundary-complete"),
        ...Array.from({ length: 103 }, (_, index) =>
          assistantMessageSse("later-reply-" + index + "-" + "history ".repeat(64)),
        ),
        null,
        assistantMessageSse("fork restarted"),
        assistantMessageSse("source restored"),
      ]);
      const provider = new CodexAppServerAgentClient(createTestLogger());
      const config = { provider: "codex", cwd, modeId: "full-access", model: "mock-model" };
      const context = { env: { CODEX_HOME: codexHome } };
      let source: Awaited<ReturnType<typeof provider.createSession>> | undefined;
      let fork: Awaited<ReturnType<typeof provider.forkSession>> | undefined;
      let history: Awaited<ReturnType<typeof provider.resumeSession>> | undefined;
      const measurements: Record<string, number> = {};
      const rolloutHash = (id: string) => {
        const file = readdirSync(codexHome, { recursive: true }).find(
          (entry) => typeof entry === "string" && entry.includes(id) && entry.endsWith(".jsonl"),
        );
        if (typeof file !== "string") throw new Error("Native rollout missing");
        return createHash("sha256")
          .update(readFileSync(path.join(codexHome, file)))
          .digest("hex");
      };
      try {
        writeMockCodexConfig(codexHome, model.url);
        source = await provider.createSession(config, context);
        const userIds: string[] = [];
        source.subscribe((event) => {
          if (event.type === "timeline" && event.item.type === "user_message")
            userIds.push(event.item.messageId);
        });
        await source.run("first-tool-boundary");
        expect(model.requestBodies[1]).toContain("TOOL_CONTEXT_BOUNDARY");
        for (let index = 0; index < 103; index++) await source.run("later-turn-" + index);
        await source.startTurn("still-running-turn");
        await expect.poll(() => model.requestBodies.length).toBe(106);
        await expect(
          provider.forkSession(
            source,
            {
              boundaryMessageId: userIds.at(-1)!,
              targetConfig: config,
            },
            context,
          ),
        ).rejects.toThrow("Wait for the current turn");
        const oldBoundaryStarted = performance.now();
        fork = await provider.forkSession(
          source,
          { boundaryMessageId: userIds[0]!, targetConfig: config },
          context,
        );
        measurements.oldBoundaryForkMs = performance.now() - oldBoundaryStarted;
        const forkHistory: AgentStreamEvent[] = [];
        for await (const event of fork.streamHistory()) forkHistory.push(event);
        expect(
          forkHistory.filter(
            (event) => event.type === "timeline" && event.item.type === "user_message",
          ),
        ).toHaveLength(1);
        expect(JSON.stringify(forkHistory)).toContain("TOOL_CONTEXT_BOUNDARY");
        expect(JSON.stringify(forkHistory)).not.toContain("later-turn-");
        const sourceHandle = source.describePersistence()!;
        const forkHandle = fork.describePersistence()!;
        expect(forkHandle.sessionId).not.toBe(sourceHandle.sessionId);
        const canceled = waitForEvent({
          session: source,
          timeoutMs: 10_000,
          label: "long source interruption",
          predicate: (event): event is Extract<AgentStreamEvent, { type: "turn_canceled" }> =>
            event.type === "turn_canceled",
        });
        await source.interrupt();
        await canceled;
        await fork.close();
        fork = await provider.resumeSession(forkHandle, config, context);
        await fork.run("continue restarted fork");
        const resumedForkInput = JSON.stringify(JSON.parse(model.requestBodies[106]!).input);
        expect(resumedForkInput).toContain("TOOL_CONTEXT_BOUNDARY");
        expect(resumedForkInput).not.toContain("later-turn-");
        await source.close();
        const beforeRead = rolloutHash(sourceHandle.sessionId);
        const closedReadStarted = performance.now();
        history = await provider.resumeSession(sourceHandle, config, context, {
          purpose: "history",
        });
        const closedRows: AgentStreamEvent[] = [];
        for await (const event of history.streamHistory()) closedRows.push(event);
        measurements.closedHistoryReadMs = performance.now() - closedReadStarted;
        expect(
          closedRows.filter(
            (event) => event.type === "timeline" && event.item.type === "user_message",
          ),
        ).toHaveLength(105);
        expect(rolloutHash(sourceHandle.sessionId)).toBe(beforeRead);
        // Native archive succeeds while the history object is still open: reading acquired no writer.
        await provider.archiveNativeSession(sourceHandle);
        await history.close();
        const archivedReadStarted = performance.now();
        history = await provider.resumeSession(sourceHandle, config, context, {
          purpose: "history",
        });
        for await (const _event of history.streamHistory()) {
          /* Consume the actual history. */
        }
        measurements.archivedHistoryReadMs = performance.now() - archivedReadStarted;
        const archivedFiles = readdirSync(path.join(codexHome, "archived_sessions"), {
          recursive: true,
        });
        expect(archivedFiles.some((file) => String(file).includes(sourceHandle.sessionId))).toBe(
          true,
        );
        expect(rolloutHash(sourceHandle.sessionId)).toBe(beforeRead);
        const failedReadStarted = performance.now();
        await expect(
          provider.resumeSession(
            { ...sourceHandle, sessionId: "00000000-0000-4000-8000-000000000001" },
            config,
            context,
            { purpose: "history" },
          ),
        ).rejects.toThrow();
        measurements.failedHistoryReadMs = performance.now() - failedReadStarted;
        expect(rolloutHash(sourceHandle.sessionId)).toBe(beforeRead);
        await provider.unarchiveNativeSession(sourceHandle);
        await history.close();
        const resumeStarted = performance.now();
        source = await provider.resumeSession(sourceHandle, config, context);
        measurements.interactiveResumeMs = performance.now() - resumeStarted;
        await source.run("explicit interaction after history");
        expect(source.describePersistence()!.sessionId).toBe(sourceHandle.sessionId);
        expect(readFileSync(workspaceFile, "utf8")).toBe("workspace stays unchanged\n");
        process.stdout.write(
          "SESSION_NATIVE_LONG_HISTORY " + JSON.stringify({ turns: 105, measurements }) + "\n",
        );
      } finally {
        await history?.close();
        await source?.close();
        await fork?.close();
        await model.close();
        rmSync(cwd, { recursive: true, force: true });
        rmSync(codexHome, { recursive: true, force: true });
      }
    },
    120_000,
  );

  test.runIf(isCodexInstalled())(
    "reads native asynchronous message history without inventing structured questions",
    async () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "codex-native-async-message-"));
      const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-native-async-home-"));
      const model = await startMockResponsesServer([
        sse([
          responseCreated("async-message"),
          functionCallEvent(
            "async-update",
            "send_message_to_user_async",
            JSON.stringify({ message: "ASYNC_MESSAGE_HISTORY: Which color?" }),
          ),
          responseCompleted("async-message"),
        ]),
        assistantMessageSse("I can continue without an answer"),
      ]);
      const provider = new CodexAppServerAgentClient(createTestLogger());
      const config = { provider: "codex", cwd, modeId: "auto", model: "mock-model" };
      const context = { env: { CODEX_HOME: codexHome } };
      let session: Awaited<ReturnType<typeof provider.createSession>> | undefined;
      try {
        writeMockCodexConfig(codexHome, model.url);
        appendFileSync(
          path.join(codexHome, "config.toml"),
          "\n[features]\nsend_message_to_user_async = true\n",
        );
        session = await provider.createSession(config, context);
        const events: AgentStreamEvent[] = [];
        session.subscribe((event) => events.push(event));
        await session.run("ask asynchronously and keep working");
        const definition = JSON.parse(model.requestBodies[0]!).tools.find(
          (tool: { name: string }) => tool.name === "send_message_to_user_async",
        );
        expect(Object.keys(definition.parameters.properties)).toEqual(["message"]);
        expect(JSON.stringify(events)).toContain("ASYNC_MESSAGE_HISTORY");
        expect(session.getPendingPermissions()).toEqual([]);
        const handle = session.describePersistence()!;
        await session.close();
        session = await provider.resumeSession(handle, config, context, { purpose: "history" });
        const history: AgentStreamEvent[] = [];
        for await (const event of session.streamHistory()) history.push(event);
        expect(JSON.stringify(history)).toContain("ASYNC_MESSAGE_HISTORY");
        expect(session.getPendingPermissions()).toEqual([]);
      } finally {
        await session?.close();
        await model.close();
        rmSync(cwd, { recursive: true, force: true });
        rmSync(codexHome, { recursive: true, force: true });
      }
    },
    30_000,
  );

  test.runIf(isCodexInstalled())(
    "reports failed MCP discovery, retries it, and honors explicit disable and revocation",
    async () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "codex-mcp-failure-"));
      const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-mcp-failure-home-"));
      const fixture = path.join(cwd, "mcp.mjs");
      const unavailable = path.join(cwd, "unavailable");
      const revoked = path.join(cwd, "revoked");
      const calls = path.join(cwd, "calls.txt");
      writeFileSync(calls, "");
      writeFileSync(unavailable, "");
      writeFileSync(
        fixture,
        `import { appendFileSync, existsSync } from "node:fs";
import { McpServer } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
if (existsSync(${JSON.stringify(unavailable)})) process.exit(23);
const server = new McpServer({ name: "continuity", version: "1.0.0" });
server.registerTool("marker", { description: "Record an authorized call", inputSchema: {} }, async () => {
  if (existsSync(${JSON.stringify(revoked)})) return { isError: true, content: [{ type: "text", text: "Tool authorization revoked" }] };
  appendFileSync(${JSON.stringify(calls)}, "called\\n");
  return { content: [{ type: "text", text: "MCP_READY" }] };
});
await server.connect(new StdioServerTransport());
`,
      );
      const tool = sse([
        responseCreated("mcp"),
        functionCallEvent("marker", "marker", "{}", "mcp__continuity"),
        responseCompleted("mcp"),
      ]);
      const done = assistantMessageSse("done");
      const model = await startMockResponsesServer([
        done,
        tool,
        done,
        done,
        tool,
        done,
        tool,
        done,
      ]);
      const logger = createTestLogger();
      const config = {
        provider: "codex",
        cwd,
        modeId: "auto",
        model: "mock-model",
        mcpServers: {
          continuity: { type: "stdio" as const, command: process.execPath, args: [fixture] },
        },
        toolPolicy: { preapproved: [{ server: "continuity", tool: "marker" }] },
      };
      const notices: unknown[] = [];
      const events: AgentStreamEvent[] = [];
      let session: CodexAppServerAgentSession | undefined;
      const open = async (
        handle: ReturnType<CodexAppServerAgentSession["describePersistence"]>,
        enabled: boolean,
      ) => {
        const current = new CodexAppServerAgentSession(
          {
            ...config,
            mcpServers: enabled ? config.mcpServers : {},
            toolPolicy: enabled ? config.toolPolicy : { preapproved: [] },
          },
          handle,
          logger,
          async () => {
            const child = spawn("codex", ["app-server"], {
              stdio: ["pipe", "pipe", "pipe"],
              env: { ...process.env, CODEX_HOME: codexHome },
            });
            let buffer = "";
            child.stdout.on("data", (chunk) => {
              buffer += chunk.toString();
              let newline: number;
              while ((newline = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                try {
                  const event = JSON.parse(line);
                  if (/mcp|warning/i.test(event.method ?? "")) notices.push(event);
                } catch {
                  /* Native transport owns parse diagnostics. */
                }
              }
            });
            return child;
          },
          { codexHome, environment: { CODEX_HOME: codexHome } },
        );
        current.subscribe((event) => events.push(event));
        await current.connect();
        return current;
      };
      const toolDefinitions = (index: number) => JSON.parse(model.requestBodies[index]!).tools;
      try {
        writeMockCodexConfig(codexHome, model.url);
        session = await open(null, true);
        await session.run("show unavailable service");
        expect(toolDefinitions(0)).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ name: "mcp__continuity" })]),
        );
        expect(notices).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              method: "mcpServer/startupStatus/updated",
              params: expect.objectContaining({ name: "continuity", status: "failed" }),
            }),
          ]),
        );
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "timeline",
              item: expect.objectContaining({
                type: "notification",
                level: "warning",
                message: expect.stringContaining("continuity"),
              }),
            }),
          ]),
        );
        const handle = session.describePersistence()!;
        await session.close();
        rmSync(unavailable);
        session = await open(handle, true);
        await session.run("retry service discovery explicitly");
        expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
        await session.close();
        session = await open(handle, false);
        await session.run("service explicitly disabled");
        expect(toolDefinitions(3)).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ name: "mcp__continuity" })]),
        );
        expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
        await session.close();
        session = await open(handle, true);
        await session.run("service enabled again");
        expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
        writeFileSync(revoked, "");
        await session.run("service denies its revoked tool");
        expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
        expect(model.requestBodies[7]).toContain("Tool authorization revoked");
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "timeline",
              item: expect.objectContaining({ type: "tool_call", status: "failed" }),
            }),
          ]),
        );
      } finally {
        await session?.close();
        await model.close();
        rmSync(cwd, { recursive: true, force: true });
        rmSync(codexHome, { recursive: true, force: true });
      }
    },
    60_000,
  );

  test.runIf(isCodexInstalled())(
    "recovers MCP discovery after initialization interruption, fork and process reconnection",
    async () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "codex-mcp-reconnect-"));
      const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-mcp-reconnect-home-"));
      const fixture = path.join(cwd, "mcp.mjs");
      const calls = path.join(cwd, "calls.txt");
      const ready = path.join(cwd, "ready");
      const started = path.join(cwd, "started");
      writeFileSync(calls, "");
      writeFileSync(
        fixture,
        `import { appendFileSync, existsSync, watch } from "node:fs";
import { McpServer } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
appendFileSync(${JSON.stringify(started)}, "started\\n");
if (!existsSync(${JSON.stringify(ready)})) await new Promise(resolve => {
  const watcher = watch(${JSON.stringify(cwd)}, () => {
    if (existsSync(${JSON.stringify(ready)})) { watcher.close(); resolve(); }
  });
});
const server = new McpServer({ name: "continuity", version: "1.0.0" });
server.registerTool("marker", { description: "Record a call", inputSchema: {} }, async () => {
  appendFileSync(${JSON.stringify(calls)}, "called\\n");
  return { content: [{ type: "text", text: "MCP_READY" }] };
});
await server.connect(new StdioServerTransport());
`,
      );
      const tool = sse([
        responseCreated("mcp"),
        functionCallEvent("marker", "marker", "{}", "mcp__continuity"),
        responseCompleted("mcp"),
      ]);
      const done = assistantMessageSse("done");
      const model = await startMockResponsesServer([
        tool,
        done,
        tool,
        done,
        tool,
        done,
        tool,
        done,
      ]);
      const logger = createTestLogger();
      const config = {
        provider: "codex",
        cwd,
        modeId: "auto",
        model: "mock-model",
        mcpServers: {
          continuity: { type: "stdio" as const, command: process.execPath, args: [fixture] },
        },
        toolPolicy: { preapproved: [{ server: "continuity", tool: "marker" }] },
      };
      const children: ChildProcessWithoutNullStreams[] = [];
      const session = new CodexAppServerAgentSession(
        config,
        null,
        logger,
        async () => {
          const child = spawn("codex", ["app-server"], {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, CODEX_HOME: codexHome },
          });
          children.push(child);
          return child;
        },
        { codexHome, environment: { CODEX_HOME: codexHome } },
      );
      let fork: Awaited<ReturnType<CodexAppServerAgentClient["forkSession"]>> | undefined;
      try {
        writeMockCodexConfig(codexHome, model.url);
        const userIds: string[] = [];
        session.subscribe((event) => {
          if (event.type === "timeline" && event.item.type === "user_message")
            userIds.push(event.item.messageId);
        });
        const start = session.startTurn("cancel during MCP initialization");
        const startOutcome = start.then(
          () => "accepted",
          (error) => String(error),
        );
        await expect.poll(() => existsSync(started)).toBe(true);
        const canceled = waitForEvent({
          session,
          timeoutMs: 10_000,
          label: "initialization interruption",
          predicate: (event): event is Extract<AgentStreamEvent, { type: "turn_canceled" }> =>
            event.type === "turn_canceled",
        });
        const stop = session.interrupt();
        await stop;
        await canceled;
        writeFileSync(ready, "");
        expect(await startOutcome).toBe("accepted");
        expect(model.requestBodies).toHaveLength(0);
        await session.run("first call after initialization interruption");
        expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
        const threadId = session.describePersistence()!.sessionId;
        const provider = new CodexAppServerAgentClient(logger);
        fork = await provider.forkSession(
          session,
          {
            boundaryMessageId: userIds[0]!,
            targetConfig: config,
          },
          { env: { CODEX_HOME: codexHome } },
        );
        expect(fork.describePersistence()!.sessionId).not.toBe(threadId);
        await fork.run("independent fork call");
        expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
        await session.run("source can continue independently");
        expect(session.describePersistence()!.sessionId).toBe(threadId);
        expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(3);
        const previousChild = children.at(-1)!;
        const exited = once(previousChild, "exit");
        previousChild.kill("SIGKILL");
        await exited;
        await session.run("call after transport process reconnection");
        expect(session.describePersistence()!.sessionId).toBe(threadId);
        expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(4);
        expect(children).toHaveLength(2);
        for (const index of [0, 2, 4, 6]) {
          expect(JSON.parse(model.requestBodies[index]!).tools).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                name: "mcp__continuity",
                tools: expect.arrayContaining([expect.objectContaining({ name: "marker" })]),
              }),
            ]),
          );
        }
      } finally {
        writeFileSync(ready, "");
        await fork?.close();
        await session.close();
        await model.close();
        rmSync(cwd, { recursive: true, force: true });
        rmSync(codexHome, { recursive: true, force: true });
      }
    },
    60_000,
  );

  test.runIf(isCodexInstalled())(
    "keeps runtime MCP tools callable after interruption, rewind and resume",
    async () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "codex-mcp-continuity-"));
      const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-mcp-home-"));
      const fixture = path.join(cwd, "mcp.mjs");
      const calls = path.join(cwd, "calls.txt");
      writeFileSync(calls, "");
      writeFileSync(
        fixture,
        `import { appendFileSync } from "node:fs";
import { McpServer } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/mcp.js"))};
import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
const server = new McpServer({ name: "continuity", version: "1.0.0" });
server.registerTool("marker", { description: "Record an actual MCP call", inputSchema: {} }, async () => {
  appendFileSync(${JSON.stringify(calls)}, "called\\n");
  return { content: [{ type: "text", text: "MCP_CONTINUITY_OK" }] };
});
await server.connect(new StdioServerTransport());
`,
      );
      const toolResponse = sse([
        responseCreated("mcp-response"),
        functionCallEvent("marker-call", "marker", "{}", "mcp__continuity"),
        responseCompleted("mcp-response"),
      ]);
      const done = assistantMessageSse("done");
      const model = await startMockResponsesServer([
        toolResponse,
        done,
        toolResponse,
        done,
        null,
        toolResponse,
        done,
        toolResponse,
        done,
        toolResponse,
        done,
      ]);
      const client = new CodexAppServerAgentClient(createTestLogger());
      const config = {
        provider: "codex",
        cwd,
        modeId: "auto",
        model: "mock-model",
        mcpServers: {
          continuity: { type: "stdio" as const, command: process.execPath, args: [fixture] },
        },
        toolPolicy: { preapproved: [{ server: "continuity", tool: "marker" }] },
      };
      const context = { env: { CODEX_HOME: codexHome } };
      let session: Awaited<ReturnType<typeof client.createSession>> | undefined;
      try {
        writeMockCodexConfig(codexHome, model.url);
        session = await client.createSession(config, context);
        const active = session;
        const userIds: string[] = [];
        active.subscribe((event) => {
          if (event.type === "timeline" && event.item.type === "user_message") {
            userIds.push(event.item.messageId);
          }
        });
        const assertCalls = (count: number) => {
          expect(readFileSync(calls, "utf8").split("\n").filter(Boolean)).toHaveLength(count);
        };
        await active.run("first tool call");
        assertCalls(1);
        await active.run("second tool call");
        assertCalls(2);

        await active.startTurn("interrupt this response");
        await expect.poll(() => model.requestBodies.length).toBe(5);
        const canceled = waitForEvent({
          session: active,
          timeoutMs: 10_000,
          label: "interrupted turn completion",
          predicate: (event): event is Extract<AgentStreamEvent, { type: "turn_canceled" }> =>
            event.type === "turn_canceled",
        });
        await active.interrupt();
        await canceled;
        await active.run("tool call after interruption");
        assertCalls(3);

        const before = active.describePersistence()?.sessionId;
        expect(userIds[1]).toBeTruthy();
        await active.revertConversation({ messageId: userIds[1]! });
        expect(active.describePersistence()?.sessionId).not.toBe(before);
        await active.run("tool call after rewind");
        assertCalls(4);

        const persistence = active.describePersistence();
        expect(persistence).not.toBeNull();
        await active.close();
        session = await client.resumeSession(persistence!, config, context);
        await session.run("tool call after resume");
        assertCalls(5);
        for (const index of [0, 2, 5, 7, 9]) {
          expect(JSON.parse(model.requestBodies[index]!).tools).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                name: "mcp__continuity",
                tools: expect.arrayContaining([expect.objectContaining({ name: "marker" })]),
              }),
            ]),
          );
        }
      } finally {
        await session?.close();
        await model.close();
        rmSync(cwd, { recursive: true, force: true });
        rmSync(codexHome, { recursive: true, force: true });
      }
    },
    60_000,
  );

  test.runIf(isCodexInstalled())(
    "reloads a persisted idle thread repeatedly without overlapping writers",
    async () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "codex-reload-cwd-"));
      const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-reload-home-"));
      const mockServer = await startMockResponsesServer([assistantMessageSse("saved")]);
      const logger = createTestLogger();
      const storage = new AgentStorage(path.join(cwd, "agents"), logger);
      const manager = new AgentManager({
        clients: { codex: new CodexAppServerAgentClient(logger) },
        registry: storage,
        logger,
      });
      let agentId: string | undefined;
      try {
        writeMockCodexConfig(codexHome, mockServer.url);
        vi.stubEnv("CODEX_HOME", codexHome);
        const created = await manager.createAgent(
          { provider: "codex", cwd, modeId: "auto", model: "mock-model" },
          undefined,
          { workspaceId: undefined },
        );
        agentId = created.id;
        await manager.runAgent(agentId, "save this turn");
        const threadId = manager.getAgent(agentId)?.persistence?.sessionId;
        expect(threadId).toBeTruthy();
        for (let i = 0; i < 3; i++) {
          const reloaded = await manager.reloadAgentSession(agentId, undefined, {
            rehydrateFromDisk: true,
          });
          expect(reloaded.persistence?.sessionId).toBe(threadId);
          expect(reloaded.lifecycle).toBe("idle");
        }
        await manager.runAgent(agentId, "continue after reload");
        expect(manager.getAgent(agentId)?.lifecycle).toBe("idle");
      } finally {
        if (agentId && manager.getAgent(agentId)) await manager.closeAgent(agentId);
        await storage.flush();
        vi.unstubAllEnvs();
        await mockServer.close();
        rmSync(cwd, { recursive: true, force: true });
        rmSync(codexHome, { recursive: true, force: true });
      }
    },
    30_000,
  );

  test.runIf(isCodexInstalled())(
    "surfaces request_user_input from the app-server as question permissions and timeline tool calls",
    async () => {
      const cwd = mkdtempSync(path.join(os.tmpdir(), "codex-app-server-question-cwd-"));
      const codexHome = mkdtempSync(path.join(os.tmpdir(), "codex-app-server-question-home-"));
      const mockServer = await startMockResponsesServer([
        requestUserInputSse("call1"),
        assistantMessageSse("done"),
      ]);

      try {
        writeMockCodexConfig(codexHome, mockServer.url);

        const client = new CodexAppServerAgentClient(createTestLogger());
        const session = await client.createSession(
          {
            provider: "codex",
            cwd,
            modeId: "auto",
            model: "mock-model",
            thinkingOptionId: "medium",
          },
          {
            env: {
              CODEX_HOME: codexHome,
            },
          },
        );

        try {
          await session.setFeature?.("plan_mode", true);

          const events: AgentStreamEvent[] = [];
          session.subscribe((event) => {
            events.push(event);
          });

          const questionRequested = waitForEvent({
            session,
            timeoutMs: 15_000,
            label: "question permission request",
            predicate: (
              event,
            ): event is Extract<AgentStreamEvent, { type: "permission_requested" }> =>
              event.type === "permission_requested" &&
              event.request.provider === "codex" &&
              event.request.kind === "question" &&
              event.request.name === "request_user_input",
          });

          const turnFinished = waitForEvent({
            session,
            timeoutMs: 15_000,
            label: "turn completion",
            predicate: (
              event,
            ): event is Extract<
              AgentStreamEvent,
              { type: "turn_completed" | "turn_failed" | "turn_canceled" }
            > =>
              event.type === "turn_completed" ||
              event.type === "turn_failed" ||
              event.type === "turn_canceled",
          });

          await session.startTurn("ask something");

          const permissionEvent = await questionRequested;
          expect(permissionEvent.request.input).toEqual({
            questions: [
              {
                id: "confirm_path",
                header: "Confirm",
                question: "Proceed with the plan?",
                isOther: true,
                options: [
                  {
                    label: "Yes (Recommended)",
                    description: "Continue the current plan.",
                  },
                  {
                    label: "No",
                    description: "Stop and revisit the approach.",
                  },
                ],
              },
            ],
          });

          const runningQuestionCall = events.find(
            (event) =>
              event.type === "timeline" &&
              event.provider === "codex" &&
              event.item.type === "tool_call" &&
              event.item.name === "request_user_input" &&
              event.item.status === "running",
          );
          expect(runningQuestionCall).toBeDefined();

          await session.respondToPermission(permissionEvent.request.id, {
            behavior: "allow",
            updatedInput: {
              answers: {
                Confirm: "Yes (Recommended)",
              },
            },
          });

          const terminalEvent = await turnFinished;
          expect(terminalEvent.type).toBe("turn_completed");

          const completedQuestionCall = events.find(
            (event) =>
              event.type === "timeline" &&
              event.provider === "codex" &&
              event.item.type === "tool_call" &&
              event.item.name === "request_user_input" &&
              event.item.status === "completed",
          );
          expect(completedQuestionCall).toBeDefined();
          if (
            !completedQuestionCall ||
            completedQuestionCall.type !== "timeline" ||
            completedQuestionCall.item.type !== "tool_call"
          ) {
            throw new Error("Expected completed request_user_input tool call");
          }
          expect(completedQuestionCall.item.metadata).toMatchObject({
            answers: {
              confirm_path: ["Yes (Recommended)"],
            },
          });
          expect(
            mockServer.requestBodies.some(
              (body) =>
                body.includes('"type":"function_call_output"') &&
                body.includes('"call_id":"call1"'),
            ),
          ).toBe(true);

          const finalAssistantMessage = [...events]
            .toReversed()
            .find((event) => event.type === "timeline" && event.item.type === "assistant_message");
          expect(finalAssistantMessage).toBeDefined();
          if (
            !finalAssistantMessage ||
            finalAssistantMessage.type !== "timeline" ||
            finalAssistantMessage.item.type !== "assistant_message"
          ) {
            throw new Error("Expected final assistant message");
          }
          expect(finalAssistantMessage.item.text.trim()).toBe("done");
        } finally {
          await session.close();
        }
      } finally {
        await mockServer.close();
        rmSync(cwd, { recursive: true, force: true });
        rmSync(codexHome, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
