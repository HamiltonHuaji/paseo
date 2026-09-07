import type { CodexThreadForkParams, CodexThreadForkResponse } from "./app-server-transport.js";
import { parseCodexThreadForkResponse } from "./app-server-transport.js";

export interface CodexRewindClient {
  forkThread?(params: CodexThreadForkParams): Promise<CodexThreadForkResponse>;
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
}

async function forkCodexThread(
  client: CodexRewindClient,
  params: CodexThreadForkParams,
): Promise<CodexThreadForkResponse> {
  if (client.forkThread) {
    return client.forkThread(params);
  }
  return parseCodexThreadForkResponse(await client.request("thread/fork", params));
}

export async function revertCodexConversation(input: {
  client: CodexRewindClient;
  threadId: string | null;
  beforeTurnId: string;
  cwd?: string | null;
  model?: string | null;
  serviceTier?: string | null;
  config?: Record<string, unknown> | null;
  developerInstructions?: string | null;
  setThreadId: (threadId: string) => void | Promise<void>;
}): Promise<void> {
  if (!input.threadId) {
    throw new Error("Codex thread is not ready for rewind");
  }

  // Forking before the selected turn is the native non-destructive rewind:
  // the old thread stays on disk while this Paseo agent rebinds to the new id.
  const forked = await forkCodexThread(input.client, {
    threadId: input.threadId,
    beforeTurnId: input.beforeTurnId,
    cwd: input.cwd ?? null,
    model: input.model ?? null,
    serviceTier: input.serviceTier ?? null,
    ...(input.config ? { config: input.config } : {}),
    ...(input.developerInstructions ? { developerInstructions: input.developerInstructions } : {}),
    excludeTurns: true,
  });
  await input.setThreadId(forked.thread.id);
}
