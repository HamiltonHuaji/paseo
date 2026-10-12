import { createHash } from "node:crypto";
import { decodeProto, messages, numberField, textField, type ProtoMessage } from "./binary.js";

export interface WandbRow {
  step: number | null;
  time: number | null;
  values: Map<string, unknown>;
}
export interface WandbValue {
  value: unknown;
  time: number | null;
  step: number | null;
}
export interface WandbArtifactFile {
  path: string;
  digest: string;
  ref: string;
  size: number;
  localPath: string;
}
export interface WandbArtifact {
  id: string;
  name: string;
  type: string;
  description: string;
  aliases: string[];
  files: WandbArtifactFile[];
  manifestPath: string;
}
export interface WandbRun {
  id: string;
  name: string;
  project: string;
  entity: string;
  startedAt: string | null;
  ended: boolean | null;
  rows: WandbRow[];
  config: Map<string, unknown>;
  summary: Map<string, unknown>;
  artifacts: Map<string, WandbArtifact>;
  uuids: Set<string>;
  activityAt: string | null;
  latest: Map<string, WandbValue>;
}
export function emptyRun(): WandbRun {
  return {
    id: "",
    name: "",
    project: "",
    entity: "",
    startedAt: null,
    ended: null,
    rows: [],
    config: new Map(),
    summary: new Map(),
    artifacts: new Map(),
    uuids: new Set(),
    activityAt: null,
    latest: new Map(),
  };
}

// Field numbers follow wandb/proto/wandb_internal.proto (MIT).
// Decode the published wire contract without requiring the Python SDK.
export function applyRecord(run: WandbRun, bytes: Buffer): void {
  const record = decodeProto(bytes);
  const uuid = textField(record, 19);
  if (uuid && run.uuids.has(uuid)) return;
  if (uuid) run.uuids.add(uuid);
  for (const info of messages(record, 17)) applyRun(run, info);
  for (const history of messages(record, 2)) applyHistory(run, history);
  for (const config of messages(record, 5)) applyMap(run.config, config);
  for (const summary of messages(record, 3)) applyMap(run.summary, summary);
  for (const artifact of messages(record, 8)) {
    const decoded = decodeArtifact(artifact);
    run.artifacts.set(decoded.id, decoded);
  }
  for (const exit of messages(record, 18)) {
    if (numberField(exit, 3) !== 1) run.ended = true;
  }
}
function applyRun(run: WandbRun, info: ProtoMessage): void {
  run.id = textField(info, 1);
  run.entity = textField(info, 2);
  run.project = textField(info, 3);
  run.name = textField(info, 8);
  const timestamp = messages(info, 17)[0];
  if (timestamp)
    run.startedAt = new Date(
      numberField(timestamp, 1) * 1000 + numberField(timestamp, 2) / 1e6,
    ).toISOString();
  for (const config of messages(info, 4)) applyMap(run.config, config);
  for (const summary of messages(info, 5)) applyMap(run.summary, summary);
  run.ended = false;
}
function applyHistory(run: WandbRun, history: ProtoMessage): void {
  const values = new Map<string, unknown>();
  for (const item of messages(history, 1)) values.set(itemKey(item), historyValue(item));
  const stepRecord = messages(history, 2)[0];
  const step = numeric(values.get('["_step"]')) ?? (stepRecord ? numberField(stepRecord, 1) : null);
  const time = numeric(values.get('["_timestamp"]'));
  run.rows.push({ step, time, values });
  for (const [key, value] of values) run.latest.set(key, { value, time, step });
  run.ended = false;
  if (time !== null) run.activityAt = new Date(time * 1000).toISOString();
}
function applyMap(target: Map<string, unknown>, record: ProtoMessage): void {
  for (const item of messages(record, 1)) target.set(itemKey(item), jsonValue(textField(item, 16)));
  for (const item of messages(record, 2)) target.delete(itemKey(item));
}
function itemKey(item: ProtoMessage): string {
  const nested = (item.get(2) ?? []).filter(Buffer.isBuffer).map((value) => value.toString("utf8"));
  return JSON.stringify(nested.length ? nested : [textField(item, 1)]);
}
function historyValue(item: ProtoMessage): unknown {
  if (item.has(3)) return null;
  if (item.has(4)) return numberField(item, 4) !== 0;
  if (item.has(5)) {
    const encoded = item.get(5)![0];
    if (typeof encoded === "bigint") return Number((encoded >> 1n) ^ -(encoded & 1n));
  }
  if (item.has(6)) return numberField(item, 6);
  if (item.has(7)) return textField(item, 7);
  if (item.has(8)) return jsonValue(textField(item, 8));
  return jsonValue(textField(item, 16));
}
function decodeArtifact(record: ProtoMessage): WandbArtifact {
  const name = textField(record, 5);
  const digest = textField(record, 6);
  const id =
    textField(record, 15) ||
    createHash("sha256").update(`${name}:${digest}`).digest("hex").slice(0, 16);
  const manifest = messages(record, 12)[0];
  const files = manifest
    ? messages(manifest, 4).map((item) => ({
        path: textField(item, 1),
        digest: textField(item, 2),
        ref: textField(item, 3),
        size: numberField(item, 4),
        localPath: textField(item, 6),
      }))
    : [];
  const aliases = (record.get(11) ?? [])
    .filter(Buffer.isBuffer)
    .map((value) => value.toString("utf8"));
  return {
    id,
    name,
    type: textField(record, 4),
    description: textField(record, 7),
    aliases,
    files,
    manifestPath: manifest ? textField(manifest, 5) : "",
  };
}
export function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
export function jsonValue(value: string): unknown {
  if (!value) return null;
  // Python's JSON encoder permits these non-finite values in historical logs.
  const normalized = value.replace(/"(?:\\.|[^"\\])*"|\bNaN\b|-?\bInfinity\b/g, (token) =>
    token.startsWith('"') ? token : "null",
  );
  return JSON.parse(normalized);
}
