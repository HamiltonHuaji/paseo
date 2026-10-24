import equal from "fast-deep-equal/es6";
import {
  normalizeStoredHostProfile,
  normalizeStoredHostConnection,
  type HostProfile,
} from "@/types/host-connection";

interface RegistryStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const REGISTRY_KEY = "@paseo:daemon-registry";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Apply edits to understood fields without rewriting fields only another version knows. */
function mergeEdits(raw: unknown, before: unknown, after: unknown): unknown {
  if (equal(before, after)) return raw;
  if (!isRecord(raw) || !isRecord(before) || !isRecord(after)) return after;
  const merged = { ...raw };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!(key in after)) delete merged[key];
    else merged[key] = mergeEdits(raw[key], before[key], after[key]);
  }
  return merged;
}

function mergeHost(raw: unknown, before: HostProfile | undefined, after: HostProfile): unknown {
  if (!isRecord(raw) || !before) return after;
  const edits = mergeEdits(raw, before, after);
  if (!isRecord(edits) || !Array.isArray(raw.connections)) return edits;
  const merged = { ...edits };
  const oldConnections = new Map(
    before.connections.map((connection) => [connection.id, connection]),
  );
  const nextConnections = new Map(
    after.connections.map((connection) => [connection.id, connection]),
  );
  const connections: unknown[] = [];
  for (const entry of raw.connections) {
    const known = normalizeStoredHostConnection(entry);
    if (!known) {
      connections.push(entry);
      continue;
    }
    const next = nextConnections.get(known.id);
    if (!next) continue;
    let changed = mergeEdits(entry, oldConnections.get(known.id), next);
    if (isRecord(changed) && before.password !== after.password) {
      const withoutPassword = { ...changed };
      delete withoutPassword.password;
      changed = withoutPassword;
    }
    connections.push(changed);
    nextConnections.delete(known.id);
  }
  connections.push(...nextConnections.values());
  merged.connections = connections;
  return merged;
}

/** The single saved registry retains unreadable records and unknown fields in place. */
export class HostRegistryStorage {
  private entries: unknown[] = [];
  private known = new Map<string, HostProfile>();
  private writes: Promise<void> = Promise.resolve();
  private readable = false;

  constructor(private readonly storage: RegistryStorage) {}

  async read(): Promise<HostProfile[]> {
    this.readable = false;
    const raw = await this.storage.getItem(REGISTRY_KEY);
    const decoded: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(decoded))
      throw new Error("Saved host registry is not a list; original data was retained");
    this.entries = decoded;
    this.known = new Map();
    for (const entry of decoded) {
      const profile = normalizeStoredHostProfile(entry);
      if (profile) this.known.set(profile.serverId, profile);
    }
    this.readable = true;
    return [...this.known.values()];
  }

  write(hosts: readonly HostProfile[]): Promise<void> {
    const write = this.writes.then(async () => {
      if (!this.readable) throw new Error("Cannot overwrite an unreadable saved host registry");
      const pending = new Map(hosts.map((host) => [host.serverId, host]));
      const lastKnownEntry = new Map<string, unknown>();
      for (const raw of this.entries) {
        const profile = normalizeStoredHostProfile(raw);
        if (profile) lastKnownEntry.set(profile.serverId, raw);
      }
      const entries: unknown[] = [];
      for (const raw of this.entries) {
        if (
          isRecord(raw) &&
          typeof raw.serverId === "string" &&
          this.known.has(raw.serverId) &&
          !hosts.some((host) => host.serverId === raw.serverId)
        )
          continue;
        const before = normalizeStoredHostProfile(raw);
        if (!before) {
          entries.push(raw);
          continue;
        }
        const after = pending.get(before.serverId);
        if (!after) continue;
        if (lastKnownEntry.get(before.serverId) !== raw) {
          entries.push(raw);
          continue;
        }
        entries.push(mergeHost(raw, this.known.get(before.serverId), after));
        pending.delete(before.serverId);
      }
      entries.push(...pending.values());
      await this.storage.setItem(REGISTRY_KEY, JSON.stringify(entries));
      this.entries = entries;
      this.known = new Map(hosts.map((host) => [host.serverId, host]));
      return undefined;
    });
    this.writes = write.catch(() => {});
    return write;
  }
}
