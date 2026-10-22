import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { StoredAgentRecord } from "./agent-storage.js";

export interface ProviderSessionLineage {
  sessionId: string;
  parentSessionId?: string;
  createdAt: string;
  lastAssistantMessageAt?: string;
}

// Creation receipts retain the initial handle even after rewind replaces the live handle.
export async function readInitialSessionIds(paseoHome: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const directory = path.join(paseoHome, "creations");
  const files = await readdir(directory).catch(() => []);
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const receipt = JSON.parse(await readFile(path.join(directory, file), "utf8"));
      const agent = receipt?.snapshot?.agent;
      const sessionId = agent?.persistence?.sessionId;
      if (typeof agent?.id === "string" && typeof sessionId === "string") {
        result.set(agent.id, sessionId);
      }
    } catch {
      // A missing or incomplete receipt does not invalidate the agent registry.
    }
  }
  return result;
}

function ancestry({
  id,
  nodes,
}: {
  id: string;
  nodes: Map<string, ProviderSessionLineage>;
}): ProviderSessionLineage[] {
  const result: ProviderSessionLineage[] = [];
  const seen = new Set<string>();
  let node = nodes.get(id);
  while (node && !seen.has(node.sessionId)) {
    seen.add(node.sessionId);
    result.push(node);
    node = node.parentSessionId ? nodes.get(node.parentSessionId) : undefined;
  }
  return result;
}

/** All records must belong to one configured provider, including other workspaces and archives. */
interface RecoverSessionLineageInput {
  records: StoredAgentRecord[];
  history: ProviderSessionLineage[];
  initialIds: Map<string, string>;
}

export function recoverSessionLineage({
  records,
  history,
  initialIds,
}: RecoverSessionLineageInput): Map<
  string,
  Pick<StoredAgentRecord, "providerSessionIds" | "forkedFrom" | "lastAssistantMessageAt">
> {
  const nodes = new Map(history.map((node) => [node.sessionId, node]));
  const owners = new Map<string, Set<string>>();
  const idsByAgent = new Map<string, Set<string>>();
  const claim = (agentId: string, sessionId: string) => {
    const ids = idsByAgent.get(agentId) ?? new Set<string>();
    ids.add(sessionId);
    idsByAgent.set(agentId, ids);
    const agents = owners.get(sessionId) ?? new Set<string>();
    agents.add(agentId);
    owners.set(sessionId, agents);
  };
  seedOwnership({ records: records, initialIds: initialIds, claim: claim });
  // Collapse provider forks used for rewind into the stable Paseo identity first.
  // Receipts and retained aliases establish known segments. Never infer ownership
  // from relative creation timestamps when those records are missing.
  for (const record of records) {
    const chain = ancestry({ id: record.persistence?.sessionId ?? "", nodes: nodes });
    const ids = idsByAgent.get(record.id)!;
    const knownBoundary = chain.findLastIndex((node) => ids.has(node.sessionId));
    for (let index = 0; index < chain.length; index++) {
      const node = chain[index]!;
      const owned = owners.get(node.sessionId);
      if (owned && (owned.size !== 1 || !owned.has(record.id))) break;
      claim(record.id, node.sessionId);
      if (index < knownBoundary) continue;
      // Dates cannot prove ownership: separately imported forks can have the same
      // creation time. Only receipts and saved aliases establish rewind segments.
      break;
    }
  }
  const result = new Map<
    string,
    Pick<StoredAgentRecord, "providerSessionIds" | "forkedFrom" | "lastAssistantMessageAt">
  >();
  for (const record of records) {
    const ids = idsByAgent.get(record.id);
    if (!ids?.size) continue;
    const chain = ancestry({ id: record.persistence?.sessionId ?? "", nodes: nodes });
    let forkedFrom = record.forkedFrom;
    forkedFrom ??= findForkOrigin({ chain: chain, ids: ids, agentId: record.id, owners: owners });
    result.set(record.id, {
      providerSessionIds: [...ids],
      forkedFrom,
      lastAssistantMessageAt: recoveredReplyTime({
        record: record,
        nodes: nodes,
        fork: forkedFrom,
      }),
    });
  }
  return result;
}

function recoveredReplyTime({
  record,
  nodes,
  fork,
}: {
  record: StoredAgentRecord;
  nodes: Map<string, ProviderSessionLineage>;
  fork: StoredAgentRecord["forkedFrom"];
}): string | null | undefined {
  if (record.lastAssistantMessageAt) return record.lastAssistantMessageAt;
  const reply = nodes.get(record.persistence?.sessionId ?? "")?.lastAssistantMessageAt;
  if (!reply || (fork && Date.parse(reply) < Date.parse(fork.forkedAt)))
    return record.lastAssistantMessageAt;
  return reply;
}

function seedOwnership({
  records,
  initialIds,
  claim,
}: {
  records: StoredAgentRecord[];
  initialIds: Map<string, string>;
  claim: (agentId: string, sessionId: string) => void;
}): void {
  for (const record of records) {
    const ids = [
      initialIds.get(record.id),
      ...(record.providerSessionIds ?? []),
      record.persistence?.sessionId,
    ];
    for (const id of ids) if (id) claim(record.id, id);
  }
}

function findForkOrigin({
  chain,
  ids,
  agentId,
  owners,
}: {
  chain: ProviderSessionLineage[];
  ids: Set<string>;
  agentId: string;
  owners: Map<string, Set<string>>;
}): StoredAgentRecord["forkedFrom"] {
  for (const node of chain) {
    if (!ids.has(node.sessionId)) break;
    const parents = node.parentSessionId ? owners.get(node.parentSessionId) : undefined;
    if (parents?.size === 1 && !parents.has(agentId)) {
      return { agentId: [...parents][0]!, forkedAt: node.createdAt };
    }
  }
  return undefined;
}
