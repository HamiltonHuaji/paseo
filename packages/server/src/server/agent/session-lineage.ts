import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AgentSessionLineage } from "../messages.js";
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
  sourceHostId?: string;
  sourceRecords?: StoredAgentRecord[];
}

export function recoverSessionLineage({
  records,
  history,
  initialIds,
  sourceHostId,
  sourceRecords = records,
}: RecoverSessionLineageInput): Map<
  string,
  Pick<
    StoredAgentRecord,
    "providerSessionIds" | "forkedFrom" | "sessionLineage" | "lastAssistantMessageAt"
  >
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
  const rewindSegments = new Map<string, ProviderSessionLineage[]>();
  for (const record of records) {
    const chain = ancestry({ id: record.persistence?.sessionId ?? "", nodes: nodes });
    const ids = idsByAgent.get(record.id)!;
    const knownBoundary = chain.findLastIndex((node) => ids.has(node.sessionId));
    const segment = chain.slice(0, knownBoundary + 1);
    const conflict = segment.some((node) => {
      const owned = owners.get(node.sessionId);
      return owned && (owned.size !== 1 || !owned.has(record.id));
    });
    if (!conflict) rewindSegments.set(record.id, segment);
  }
  for (const [agentId, segment] of rewindSegments)
    for (const node of segment) claim(agentId, node.sessionId);
  const result = new Map<
    string,
    Pick<
      StoredAgentRecord,
      "providerSessionIds" | "forkedFrom" | "sessionLineage" | "lastAssistantMessageAt"
    >
  >();
  for (const record of records) {
    const ids = idsByAgent.get(record.id);
    if (!ids?.size) continue;
    const chain = ancestry({ id: record.persistence?.sessionId ?? "", nodes: nodes });
    const inferredOrigin = findForkOrigin({ chain, ids, agentId: record.id, owners });
    const { forkedFrom, sessionLineage } = recoverRecordOperations({
      record,
      chain,
      ids,
      owners,
      sourceHostId,
    });
    result.set(record.id, {
      providerSessionIds: [...ids],
      forkedFrom,
      sessionLineage: sessionLineage.map((entry) =>
        resolveSavedOrigin({
          entry,
          records: sourceRecords,
          owners,
          localHostId: sourceHostId,
          inferredOrigin,
          ambiguousIdentity: [...ids].some((id) => owners.get(id)?.size !== 1),
        }),
      ),
      lastAssistantMessageAt: recoveredReplyTime({
        record: record,
        nodes: nodes,
        fork: forkedFrom,
      }),
    });
  }
  return result;
}

function recoverRecordOperations({
  record,
  chain,
  ids,
  owners,
  sourceHostId,
}: {
  record: StoredAgentRecord;
  chain: ProviderSessionLineage[];
  ids: Set<string>;
  owners: Map<string, Set<string>>;
  sourceHostId?: string;
}) {
  // Only a saved Paseo operation demonstrates a local source host. Native
  // headers can have been copied from another machine, even when IDs match.
  const forkedFrom = record.forkedFrom && {
    ...record.forkedFrom,
    sourceHostId:
      record.forkedFrom.sourceHostId ??
      (record.forkedFrom.operation === "native-fork" ||
      record.forkedFrom.operation === "import-copy"
        ? sourceHostId
        : undefined),
  };
  const sessionLineage = [...(record.sessionLineage ?? [])];
  // COMPAT(sessionLineage): added in v0.13.0-beta.1 fork; remove after 2027-04-23
  // once retained pre-lineage records have been reconciled.
  if (!sessionLineage.some((entry) => entry.operation !== "rewind")) {
    if (forkedFrom) {
      sessionLineage.unshift({
        operation: forkedFrom.operation ?? "unknown",
        createdAt: forkedFrom.forkedAt,
        sourceHostId: forkedFrom.sourceHostId,
        sourceAgentId: forkedFrom.agentId,
        sourceProviderSessionId: forkedFrom.sourceProviderSessionId,
        resultProviderSessionId: forkedFrom.resultProviderSessionId,
        boundaryMessageId: forkedFrom.boundaryMessageId,
        sourceResolution: forkedFrom.sourceHostId ? "resolved" : "unknown-host",
        sourceEvidence: forkedFrom.operation ? "paseo-operation" : "provider-history",
      });
    } else {
      const origin = findForkOrigin({ chain, ids, agentId: record.id, owners });
      if (origin) sessionLineage.push(origin);
    }
  }
  for (const operation of savedBranchOperations(record)) {
    if (
      operation.operation !== "rewind" ||
      sessionLineage.some(
        (entry) =>
          entry.operation === "rewind" &&
          entry.sourceProviderSessionId === operation.sourceThreadId &&
          entry.resultProviderSessionId === operation.resultThreadId &&
          entry.boundaryMessageId === operation.boundaryMessageId,
      )
    )
      continue;
    sessionLineage.push(
      recordSessionOperation({
        operation: "rewind",
        sourceHostId,
        sourceAgentId: record.id,
        sourcePersistence: { sessionId: operation.sourceThreadId },
        resultPersistence: { sessionId: operation.resultThreadId },
        boundaryMessageId: operation.boundaryMessageId,
        createdAt: operation.createdAt,
      }),
    );
  }
  return { forkedFrom, sessionLineage };
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
      ...savedBranchOperations(record)
        .filter((entry) => entry.operation === "rewind")
        .flatMap((entry) => [entry.sourceThreadId, entry.resultThreadId]),
      ...(record.sessionLineage ?? [])
        .filter((entry) => entry.operation === "rewind")
        .flatMap((entry) => [entry.sourceProviderSessionId, entry.resultProviderSessionId]),
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
}): AgentSessionLineage | undefined {
  for (const node of chain) {
    if (!ids.has(node.sessionId)) break;
    if (owners.get(node.sessionId)?.size !== 1) return undefined;
    if (!node.parentSessionId || ids.has(node.parentSessionId)) continue;
    const candidates = [...(owners.get(node.parentSessionId) ?? [])]
      .filter((id) => id !== agentId)
      .sort();
    return {
      operation: "provider-fork",
      createdAt: node.createdAt,
      sourceProviderSessionId: node.parentSessionId,
      resultProviderSessionId: node.sessionId,
      sourceResolution: candidateResolution(candidates),
      candidateAgentIds: candidates.length ? candidates : undefined,
      sourceEvidence: "provider-history",
    };
  }
  return undefined;
}

interface ResolveOriginInput {
  entry: AgentSessionLineage;
  records: StoredAgentRecord[];
  owners: Map<string, Set<string>>;
  localHostId?: string;
  inferredOrigin?: AgentSessionLineage;
  ambiguousIdentity?: boolean;
}

function resolveSavedOrigin({
  entry,
  records,
  owners,
  localHostId,
  inferredOrigin,
  ambiguousIdentity,
}: ResolveOriginInput): AgentSessionLineage {
  const explicit = entry.sourceEvidence === "paseo-operation" && entry.operation !== "import-copy";
  if (entry.sourceHostId && entry.sourceHostId !== localHostId) {
    const resolvedSource =
      entry.sourceResolution === "resolved" && entry.sourceAgentId
        ? { hostId: entry.sourceHostId, agentId: entry.sourceAgentId }
        : undefined;
    return { ...entry, resolvedSource };
  }
  if (explicit && entry.sourceHostId && entry.sourceAgentId) {
    const present = records.some((record) => record.id === entry.sourceAgentId);
    const resolvedSource =
      present && entry.sourceAgentId && entry.sourceHostId
        ? { hostId: entry.sourceHostId, agentId: entry.sourceAgentId }
        : undefined;
    return { ...entry, resolvedSource, sourceResolution: present ? "resolved" : "missing" };
  }
  if (entry.operation === "rewind") return entry;
  if (ambiguousIdentity)
    return { ...entry, resolvedSource: undefined, sourceResolution: "ambiguous" };
  return resolveNativeOrigin({ entry, records, owners, localHostId, inferredOrigin });
}

function resolveNativeOrigin({
  entry,
  owners,
  localHostId,
  inferredOrigin,
}: ResolveOriginInput): AgentSessionLineage {
  const native = inferredOrigin ?? entry;
  const parentId = native.sourceProviderSessionId;
  const candidates = [...(owners.get(parentId ?? "") ?? [])].sort();
  const disagrees = inferredOrigin && originConflicts({ entry, parentId, candidates });
  if (disagrees) {
    const candidateAgentIds = [
      ...new Set([...candidates, ...(entry.sourceAgentId ? [entry.sourceAgentId] : [])]),
    ].sort();
    return {
      ...entry,
      resolvedSource: undefined,
      sourceResolution: "ambiguous",
      candidateAgentIds,
    };
  }
  // A temporarily unreadable rollout must not erase the evidence already saved.
  if (!parentId) return entry;
  const sourceAgentId = candidates.length === 1 ? candidates[0] : undefined;
  const resolvedSource =
    sourceAgentId && localHostId ? { hostId: localHostId, agentId: sourceAgentId } : undefined;
  const sourceResolution = candidateResolution(candidates, localHostId);
  return {
    ...entry,
    operation:
      entry.operation === "unknown" && inferredOrigin ? inferredOrigin.operation : entry.operation,
    sourceProviderSessionId: parentId,
    resultProviderSessionId: native.resultProviderSessionId,
    resolvedSource,
    sourceResolution,
    sourceAgentId: sourceAgentId ?? entry.sourceAgentId,
    candidateAgentIds: candidates.length > 1 ? candidates : undefined,
  };
}

function originConflicts({
  entry,
  parentId,
  candidates,
}: {
  entry: AgentSessionLineage;
  parentId: string | undefined;
  candidates: string[];
}): boolean {
  if (entry.sourceProviderSessionId && entry.sourceProviderSessionId !== parentId) return true;
  return (
    !!entry.sourceAgentId && candidates.length > 0 && !candidates.includes(entry.sourceAgentId)
  );
}

export function candidateResolution(
  candidates: readonly string[],
  sourceHostId?: string,
): AgentSessionLineage["sourceResolution"] {
  if (candidates.length > 1) return "ambiguous";
  if (!candidates.length) return "missing";
  return sourceHostId ? "resolved" : "unknown-host";
}

export function recordSessionOperation(input: {
  operation: AgentSessionLineage["operation"];
  sourceHostId?: string;
  sourceAgentId?: string;
  sourcePersistence?: { sessionId: string; metadata?: Record<string, unknown> } | null;
  resultPersistence?: { sessionId: string; metadata?: Record<string, unknown> } | null;
  boundaryMessageId?: string;
  createdAt?: string;
  candidateAgentIds?: string[];
  sourceEvidence?: AgentSessionLineage["sourceEvidence"];
  sourceResolution?: AgentSessionLineage["sourceResolution"];
}): AgentSessionLineage {
  const sourceTree = input.sourcePersistence?.metadata?.providerSessionTreeId;
  const resultTree = input.resultPersistence?.metadata?.providerSessionTreeId;
  return {
    operation: input.operation,
    createdAt: input.createdAt ?? new Date().toISOString(),
    sourceHostId: input.sourceHostId,
    sourceAgentId: input.sourceAgentId,
    resolvedSource:
      input.sourceAgentId && input.sourceHostId
        ? { hostId: input.sourceHostId, agentId: input.sourceAgentId }
        : undefined,
    sourceProviderSessionId: input.sourcePersistence?.sessionId,
    resultProviderSessionId: input.resultPersistence?.sessionId,
    sourceProviderSessionTreeId: typeof sourceTree === "string" ? sourceTree : undefined,
    resultProviderSessionTreeId: typeof resultTree === "string" ? resultTree : undefined,
    boundaryMessageId: input.boundaryMessageId,
    sourceResolution:
      input.sourceResolution ??
      candidateResolution(
        input.candidateAgentIds ?? (input.sourceAgentId ? [input.sourceAgentId] : []),
        input.sourceHostId,
      ),
    candidateAgentIds: input.candidateAgentIds,
    sourceEvidence: input.sourceEvidence ?? "paseo-operation",
  };
}

const BranchOperationSchema = z.object({
  operation: z.enum(["fork", "import-copy", "rewind"]),
  sourceThreadId: z.string(),
  resultThreadId: z.string(),
  boundaryMessageId: z.string().optional(),
  createdAt: z.string(),
});

function savedBranchOperations(record: StoredAgentRecord) {
  return (
    z.array(BranchOperationSchema).safeParse(record.persistence?.metadata?.branchOperations).data ??
    []
  );
}

export function sessionOperationMetadata(
  origin: AgentSessionLineage,
): Pick<StoredAgentRecord, "forkedFrom" | "sessionLineage"> {
  const operation = origin.operation;
  const forkedFrom =
    origin.sourceAgentId &&
    (operation === "native-fork" || operation === "text-copy" || operation === "import-copy")
      ? {
          agentId: origin.sourceAgentId,
          sourceHostId: origin.sourceHostId,
          forkedAt: origin.createdAt,
          operation,
          sourceProviderSessionId: origin.sourceProviderSessionId,
          resultProviderSessionId: origin.resultProviderSessionId,
          boundaryMessageId: origin.boundaryMessageId,
        }
      : undefined;
  return { forkedFrom, sessionLineage: [origin] };
}
