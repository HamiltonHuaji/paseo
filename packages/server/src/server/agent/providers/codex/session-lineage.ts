import { createReadStream } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import type { ProviderSessionLineage } from "../../session-lineage.js";

async function readHeader(file: string): Promise<ProviderSessionLineage | null> {
  const stream = createReadStream(file, { encoding: "utf8", highWaterMark: 4096 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const row = JSON.parse(line);
      const meta = row.payload;
      if (
        row.type !== "session_meta" ||
        typeof meta?.id !== "string" ||
        typeof meta.timestamp !== "string"
      )
        return null;
      return {
        sessionId: meta.id,
        createdAt: meta.timestamp,
        ...(typeof meta.forked_from_id === "string"
          ? { parentSessionId: meta.forked_from_id }
          : {}),
      };
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return null;
}

/** Reads lineage headers and requested reply timestamps without starting provider sessions. */
interface ReadCodexSessionLineageInput {
  codexHome: string;
  activitySessionIds?: readonly string[];
}

export async function readCodexSessionLineage({
  codexHome,
  activitySessionIds = [],
}: ReadCodexSessionLineageInput): Promise<ProviderSessionLineage[]> {
  const nodes: ProviderSessionLineage[] = [];
  const activityIds = new Set(activitySessionIds);
  const directories = [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")];
  while (directories.length) {
    const directory = directories.pop()!;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) directories.push(file);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const node = await readHeader(file).catch(() => null);
        if (!node) continue;
        node.lastAssistantMessageAt = activityIds.has(node.sessionId)
          ? await readLastReply(file).catch(() => undefined)
          : undefined;
        nodes.push(node);
      }
    }
  }
  return nodes;
}

function replyTimestamp(line: string): string | undefined {
  try {
    const row = JSON.parse(line);
    const p = row.payload;
    const reply =
      (row.type === "response_item" && p?.type === "message" && p.role === "assistant") ||
      (row.type === "event_msg" &&
        (p?.type === "agent_message" ||
          (p?.type === "item_completed" && p.item?.type === "agentMessage")));
    return reply && typeof row.timestamp === "string" ? row.timestamp : undefined;
  } catch {
    return undefined;
  }
}

// Seek backwards to the last reply rather than loading multi-megabyte tool histories.
async function readLastReply(file: string): Promise<string | undefined> {
  const handle = await open(file, "r");
  try {
    let offset = (await handle.stat()).size;
    let pending = Buffer.alloc(0);
    while (offset > 0) {
      const size = Math.min(offset, 64 * 1024);
      offset -= size;
      const chunk = Buffer.alloc(size);
      const { bytesRead } = await handle.read(chunk, 0, size, offset);
      const data = Buffer.concat([chunk.subarray(0, bytesRead), pending]);
      let end = data.length;
      for (let index = data.length - 1; index >= 0; index--) {
        if (data[index] !== 10) continue;
        const timestamp = replyTimestamp(data.subarray(index + 1, end).toString("utf8"));
        if (timestamp) return timestamp;
        end = index;
      }
      pending = data.subarray(0, end);
    }
    return replyTimestamp(pending.toString("utf8"));
  } finally {
    await handle.close();
  }
}
