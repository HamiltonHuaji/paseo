import { createHash, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  WorkObjectSchema,
  WorkCardSchema,
  WorkItemSchema,
  WorkTouchSchema,
  WorkPlacementSchema,
  type WorkObject,
  type WorkCard,
  type WorkItem,
  type WorkCreateCard,
  type WorkCreateItem,
  type WorkUpdateCard,
  type WorkUpdateItem,
  type WorkListCards,
  type WorkListItems,
  type WorkComponents,
  type WorkProgressState,
  type WorkPlacement,
  type WorkStorage,
} from "@getpaseo/protocol/work-objects";

// The daemon runs on Node 22+, while its declarations still target @types/node 20.
interface Database {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...values: unknown[]): unknown[];
    get(...values: unknown[]): unknown;
    run(...values: unknown[]): unknown;
  };
  close(): void;
}
interface SqliteModule {
  DatabaseSync: new (filename: string) => Database;
}
const RecordRowSchema = z.object({ record: z.string() });
const CursorSchema = z.object({ binding: z.string(), createdAt: z.string(), id: z.string() });
const EMPTY_PROGRESS: WorkProgressState = {
  observation: null,
  checkedAt: null,
  error: null,
  catchingUp: false,
};

export class WorkError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
interface CreatedCard {
  card: WorkCard;
  items: WorkItem[];
}
interface WorkPage {
  objects: WorkObject[];
  nextCursor: string | null;
}
interface ProgressUpdate {
  objectId: string;
  state: WorkProgressState;
  activityAt?: string;
  executionStartedAt?: string;
  executionEndedAt?: string;
}

export class WorkStore {
  private constructor(
    readonly projectRoot: string,
    private readonly db: Database,
    private readonly now: () => string,
  ) {}

  static async open(projectRoot: string, now = () => new Date().toISOString()): Promise<WorkStore> {
    const directory = path.join(projectRoot, ".paseo", "v2");
    await mkdir(directory, { recursive: true });
    const specifier: string = "node:sqlite";
    const sqlite: SqliteModule = await import(specifier);
    const db = new sqlite.DatabaseSync(path.join(directory, "state.db"));
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS goals (name TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS cards (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, archived_at TEXT, label TEXT NOT NULL,
        goal TEXT, based_on TEXT, search_text TEXT NOT NULL, record TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY, parent_id TEXT NOT NULL, created_at TEXT NOT NULL, archived_at TEXT,
        label TEXT NOT NULL, search_text TEXT NOT NULL, record TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cards_order ON cards(created_at, id);
      CREATE INDEX IF NOT EXISTS items_parent_order ON items(parent_id, created_at, id);
      CREATE TABLE IF NOT EXISTS touches (object_id TEXT NOT NULL, agent_id TEXT NOT NULL, touched_at TEXT NOT NULL, PRIMARY KEY(object_id, agent_id));
      CREATE INDEX IF NOT EXISTS touches_agent ON touches(agent_id, object_id);
      CREATE TABLE IF NOT EXISTS sessions (object_id TEXT NOT NULL, agent_id TEXT NOT NULL, PRIMARY KEY(object_id, agent_id));
      CREATE INDEX IF NOT EXISTS sessions_agent ON sessions(agent_id, object_id);
      CREATE TABLE IF NOT EXISTS placements (card_id TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS observations (object_id TEXT PRIMARY KEY, record TEXT NOT NULL);
    `);
    return new WorkStore(projectRoot, db, now);
  }

  close(): void {
    this.db.close();
  }

  get(id: string): WorkObject {
    const table = tableFor(id);
    const row = this.db.prepare(`SELECT record FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw new WorkError("not_found", `Work object ${id} not found`);
    return this.readRecord(row);
  }
  getCard(id: string): WorkCard {
    const object = this.get(id);
    if (object.kind !== "card") throw new WorkError("wrong_kind", `${id} is not a Card`);
    return object;
  }
  getItem(id: string): WorkItem {
    const object = this.get(id);
    if (object.kind !== "item") throw new WorkError("wrong_kind", `${id} is not an Item`);
    return object;
  }

  createCard(input: WorkCreateCard, caller?: string): CreatedCard {
    return this.transaction(() => {
      this.requireCardReference(input.basedOn);
      this.requireCardReference(input.viewerSource);
      const now = this.now();
      const id = this.allocateId("card");
      const stamp = now
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "Z")
        .replace("T", "-");
      const storageRelpath = `blobs/cards/${stamp}-${slug(input.title, "card")}-${id}`;
      const base = this.createBase(input, id, storageRelpath, now);
      const card = WorkCardSchema.parse({
        ...base,
        kind: "card",
        label: input.preset,
        goal: input.goal ?? null,
        basedOn: input.basedOn ?? null,
        viewerSource: input.viewerSource ?? null,
      });
      this.save(card);
      this.touch(card, input.linkCaller === false ? undefined : caller, now);
      const items = (input.items ?? []).map((item) =>
        this.insertItem({ ...item, parentCardId: id }, caller, now),
      );
      return { card: this.getCard(id), items };
    });
  }

  createItem(input: WorkCreateItem, caller?: string): WorkItem {
    return this.transaction(() => this.insertItem(input, caller, this.now()));
  }

  updateCard(input: WorkUpdateCard, caller?: string): WorkCard {
    return this.transaction(() => {
      this.requireCardReference(input.basedOn);
      this.requireCardReference(input.viewerSource);
      const old = this.getCard(input.cardId);
      const updated = WorkCardSchema.parse({
        ...old,
        ...this.patch(old, input),
        label: input.label ?? old.label,
        goal: supplied(input.goal, old.goal),
        basedOn: supplied(input.basedOn, old.basedOn),
        viewerSource: supplied(input.viewerSource, old.viewerSource),
      });
      this.save(updated);
      this.touch(updated, input.linkCaller === false ? undefined : caller, updated.updatedAt);
      return this.getCard(old.id);
    });
  }
  updateItem(input: WorkUpdateItem, caller?: string): WorkItem {
    return this.transaction(() => {
      const old = this.getItem(input.itemId);
      const updated = WorkItemSchema.parse({
        ...old,
        ...this.patch(old, input),
        label: input.label ?? old.label,
      });
      this.save(updated);
      this.touch(updated, input.linkCaller === false ? undefined : caller, updated.updatedAt);
      return this.getItem(old.id);
    });
  }

  listCards(input: WorkListCards): WorkPage {
    return this.list("cards", input);
  }
  listItems(input: WorkListItems): WorkPage {
    this.getCard(input.parentCardId);
    return this.list("items", input);
  }

  allCards(archive: "active" | "archived" | "all" = "active"): WorkCard[] {
    return this.all("cards", archive).map((value) => WorkCardSchema.parse(value));
  }
  allItems(parentCardId?: string): WorkItem[] {
    const where = parentCardId ? "WHERE parent_id = ?" : "";
    const rows = this.db
      .prepare(`SELECT record FROM items ${where} ORDER BY created_at, id`)
      .all(...(parentCardId ? [parentCardId] : []));
    return rows.map((row) => WorkItemSchema.parse(this.readRecord(row)));
  }

  itemCounts(): Record<string, number> {
    const counts = this.db
      .prepare(
        "SELECT parent_id, count(*) AS count FROM items WHERE archived_at IS NULL GROUP BY parent_id",
      )
      .all();
    return Object.fromEntries(
      counts.map((row) => {
        const value = z.object({ parent_id: z.string(), count: z.number() }).parse(row);
        return [value.parent_id, value.count];
      }),
    );
  }

  goals(): string[] {
    return this.db
      .prepare("SELECT name FROM goals ORDER BY name")
      .all()
      .map((row) => z.object({ name: z.string() }).parse(row).name);
  }
  placements(): WorkPlacement[] {
    return this.db
      .prepare("SELECT record FROM placements")
      .all()
      .map((row) => WorkPlacementSchema.parse(JSON.parse(RecordRowSchema.parse(row).record)));
  }
  updatePlacements(placements: WorkPlacement[]): WorkPlacement[] {
    return this.transaction(() => {
      for (const placement of placements) {
        this.getCard(placement.cardId);
        this.db
          .prepare("INSERT OR REPLACE INTO placements VALUES (?, ?)")
          .run(placement.cardId, JSON.stringify(placement));
      }
      return this.placements();
    });
  }

  async storage(id?: string): Promise<WorkStorage> {
    const root = path.join(this.projectRoot, ".paseo", "v2");
    const sharedPath = path.join(root, "blobs", "shared");
    const directory = id ? path.join(root, this.get(id).storageRelpath) : sharedPath;
    await mkdir(directory, { recursive: true });
    await mkdir(sharedPath, { recursive: true });
    return { path: directory, sharedPath };
  }

  saveProgress(input: ProgressUpdate): WorkObject {
    return this.transaction(() => {
      const object = this.get(input.objectId);
      object.progressState = input.state;
      if (input.executionStartedAt && !object.startedAt)
        object.startedAt = input.executionStartedAt;
      if (input.executionEndedAt && !object.endedAt) object.endedAt = input.executionEndedAt;
      this.save(object);
      if (input.activityAt) this.recordActivity(object.id, input.activityAt);
      return this.get(object.id);
    });
  }
  recordActivity(id: string, at: string): void {
    const object = this.get(id);
    this.db
      .prepare(
        `UPDATE ${tableFor(id)} SET record = json_set(record, '$.updatedAt', max(json_extract(record, '$.updatedAt'), ?)) WHERE id = ?`,
      )
      .run(at, id);
    if (object.kind === "item") this.recordActivity(object.parentCardId, at);
  }

  sourceConsumers(objectId: string, source: string): WorkObject[] {
    const rows = this.db
      .prepare(`SELECT record FROM (SELECT record FROM cards UNION ALL SELECT record FROM items) o
      WHERE (json_extract(record, '$.progress.source.type') = 'viewer-source'
        AND json_extract(record, '$.progress.source.source.objectId') = ?
        AND json_extract(record, '$.progress.source.source.source') = ?)
      OR EXISTS (SELECT 1 FROM json_each(o.record, '$.metrics.panels') p
        WHERE json_extract(p.value, '$.source.objectId') = ? AND json_extract(p.value, '$.source.source') = ?)`)
      .all(objectId, source, objectId, source);
    return rows.map((row) => this.readRecord(row));
  }

  readObservationState(id: string): unknown {
    const row = this.db.prepare("SELECT record FROM observations WHERE object_id = ?").get(id);
    return row ? JSON.parse(RecordRowSchema.parse(row).record) : null;
  }
  saveObservationState(id: string, value: unknown): void {
    this.db
      .prepare("INSERT OR REPLACE INTO observations VALUES (?, ?)")
      .run(id, JSON.stringify(value));
  }

  sessionRelations(object: WorkObject, agentId: string): Array<"linked" | "touched"> {
    const ids = [object.id];
    if (object.kind === "card") {
      const rows = this.db.prepare("SELECT id FROM items WHERE parent_id = ?").all(object.id);
      ids.push(...rows.map((row) => z.object({ id: z.string() }).parse(row).id));
    }
    const matches: Array<"linked" | "touched"> = [];
    for (const relation of ["linked", "touched"] as const) {
      const table = relation === "linked" ? "sessions" : "touches";
      const placeholders = ids.map(() => "?").join(",");
      if (
        this.db
          .prepare(
            `SELECT 1 FROM ${table} WHERE agent_id = ? AND object_id IN (${placeholders}) LIMIT 1`,
          )
          .get(agentId, ...ids)
      )
        matches.push(relation);
    }
    return matches;
  }

  private createBase(
    input: WorkCreateCard | WorkCreateItem,
    id: string,
    storageRelpath: string,
    now: string,
  ) {
    const components = bindReferences(
      {
        sessions: input.sessions ?? null,
        viewers: input.viewers ?? null,
        progress: input.progress ?? null,
        metrics: input.metrics ?? null,
        result: input.result ?? null,
        config: input.config ?? null,
      },
      id,
      "parentCardId" in input ? input.parentCardId : null,
    );
    const times = resultTimes(components.result, null, input, now);
    return {
      ...components,
      id,
      title: input.title,
      body: input.body,
      storageRelpath,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      touches: [],
      progressState: { ...EMPTY_PROGRESS },
      ...times,
    };
  }
  private insertItem(input: WorkCreateItem, caller: string | undefined, now: string): WorkItem {
    const parent = this.getCard(input.parentCardId);
    const id = this.allocateId("item");
    const elapsed = Math.max(0, Date.parse(now) - Date.parse(parent.createdAt));
    const relpath = `${parent.storageRelpath}/items/${formatElapsed(elapsed)}-${slug(input.title, "item")}-${id}`;
    const base = this.createBase(input, id, relpath, now);
    const item = WorkItemSchema.parse({
      ...base,
      kind: "item",
      label: input.preset,
      parentCardId: parent.id,
    });
    this.save(item);
    this.touch(item, input.linkCaller === false ? undefined : caller, now);
    return this.getItem(id);
  }

  private patch(old: WorkObject, input: WorkUpdateCard | WorkUpdateItem) {
    const mutableKeys = Object.keys(input).filter(
      (key) =>
        ![
          "cardId",
          "itemId",
          "linkCaller",
          "returning",
          "type",
          "projectId",
          "requestId",
          "callerAgentId",
        ].includes(key),
    );
    if (!mutableKeys.length) throw new WorkError("invalid_input", "Provide a field to update");
    const now = this.now();
    const sessions = patchSessions(old.sessions, input.sessions);
    const viewers = patchViewers(old.viewers, input.viewers);
    let result = old.result;
    if (input.result === null) result = null;
    else if (input.result) result = { ...old.result, ...input.result };
    const components = bindReferences(
      {
        sessions,
        viewers,
        result,
        progress: supplied(input.progress, old.progress),
        metrics: supplied(input.metrics, old.metrics),
        config: supplied(input.config, old.config),
      },
      old.id,
      old.kind === "item" ? old.parentCardId : null,
    );
    const times = resultTimes(result, old, input, now);
    const sourceChanged =
      JSON.stringify(components.progress?.source) !== JSON.stringify(old.progress?.source);
    if (sourceChanged) this.db.prepare("DELETE FROM observations WHERE object_id = ?").run(old.id);
    let archivedAt = old.archivedAt;
    if (input.archived !== undefined) archivedAt = input.archived ? now : null;
    return {
      ...components,
      ...times,
      title: input.title ?? old.title,
      body: input.body ?? old.body,
      archivedAt,
      updatedAt: now,
      progressState: sourceChanged ? { ...EMPTY_PROGRESS } : old.progressState,
    };
  }

  private save(object: WorkObject): void {
    if (object.config) z.record(z.string(), z.json()).parse(object.config);
    if (object.progress && !object.progress.plan && !object.progress.source)
      throw new WorkError("invalid_input", "Progress requires a plan or source");
    const record = JSON.stringify({ ...object, touches: [] });
    const search = normalize(`${object.title}\n${object.body}`);
    if (object.kind === "card") {
      if (object.goal !== null)
        this.db.prepare("INSERT OR IGNORE INTO goals VALUES (?)").run(object.goal);
      this.db
        .prepare("INSERT OR REPLACE INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          object.id,
          object.createdAt,
          object.archivedAt,
          object.label,
          object.goal,
          object.basedOn,
          search,
          record,
        );
    } else
      this.db
        .prepare("INSERT OR REPLACE INTO items VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(
          object.id,
          object.parentCardId,
          object.createdAt,
          object.archivedAt,
          object.label,
          search,
          record,
        );
    this.db.prepare("DELETE FROM sessions WHERE object_id = ?").run(object.id);
    for (const agentId of new Set(object.sessions?.agentIds ?? []))
      this.db.prepare("INSERT INTO sessions VALUES (?, ?)").run(object.id, agentId);
  }
  private touch(object: WorkObject, caller: string | undefined, now: string): void {
    if (caller)
      this.db
        .prepare("INSERT OR REPLACE INTO touches VALUES (?, ?, ?)")
        .run(object.id, caller, now);
    if (object.kind === "item") {
      this.recordActivity(object.parentCardId, now);
      if (caller)
        this.db
          .prepare("INSERT OR REPLACE INTO touches VALUES (?, ?, ?)")
          .run(object.parentCardId, caller, now);
    }
  }
  private readRecord(row: unknown): WorkObject {
    const object = WorkObjectSchema.parse(JSON.parse(RecordRowSchema.parse(row).record));
    object.touches = this.db
      .prepare(
        "SELECT agent_id AS agentId, touched_at AS lastTouchedAt FROM touches WHERE object_id = ? ORDER BY touched_at DESC, agent_id",
      )
      .all(object.id)
      .map((value) => WorkTouchSchema.parse(value));
    return object;
  }
  private all(table: "cards" | "items", archive: "active" | "archived" | "all"): WorkObject[] {
    const condition = archiveWhere(archive);
    return this.db
      .prepare(`SELECT record FROM ${table} WHERE ${condition} ORDER BY created_at, id`)
      .all()
      .map((row) => this.readRecord(row));
  }
  private list(table: "cards" | "items", input: WorkListCards | WorkListItems): WorkPage {
    const clauses = [archiveWhere(input.archive ?? "active")];
    const params: unknown[] = [];
    if ("parentCardId" in input) {
      clauses.push("parent_id = ?");
      params.push(input.parentCardId);
    }
    if (input.query) {
      clauses.push("instr(search_text, ?) > 0");
      params.push(normalize(input.query));
    }
    if (input.label) {
      clauses.push("label = ?");
      params.push(input.label);
    }
    if ("goal" in input && input.goal !== undefined) {
      clauses.push("goal = ?");
      params.push(input.goal);
    }
    if ("basedOn" in input && input.basedOn !== undefined) {
      clauses.push("based_on = ?");
      params.push(input.basedOn);
    }
    if (input.sessionId) {
      const tables = relationTables(input.sessionRelation);
      const scope =
        table === "cards"
          ? "(r.object_id = o.id OR r.object_id IN (SELECT id FROM items WHERE parent_id = o.id))"
          : "r.object_id = o.id";
      clauses.push(
        `(${tables.map((name) => `EXISTS (SELECT 1 FROM ${name} r WHERE r.agent_id = ? AND ${scope})`).join(" OR ")})`,
      );
      params.push(...tables.map(() => input.sessionId));
    }
    const direction = input.order === "asc" ? "ASC" : "DESC";
    const binding = createHash("sha256")
      .update(JSON.stringify([this.projectRoot, table, clauses, params, direction]))
      .digest("hex");
    if (input.cursor) {
      let cursor: z.infer<typeof CursorSchema>;
      try {
        cursor = CursorSchema.parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString()));
      } catch {
        throw new WorkError("invalid_cursor", "Invalid Works cursor");
      }
      if (cursor.binding !== binding)
        throw new WorkError("invalid_cursor", "Cursor belongs to another query");
      clauses.push(`(created_at, id) ${direction === "ASC" ? ">" : "<"} (?, ?)`);
      params.push(cursor.createdAt, cursor.id);
    }
    const limit = input.limit ?? 20;
    const rows = this.db
      .prepare(
        `SELECT record FROM ${table} o WHERE ${clauses.join(" AND ")} ORDER BY created_at ${direction}, id ${direction} LIMIT ?`,
      )
      .all(...params, limit + 1);
    const objects = rows.slice(0, limit).map((row) => this.readRecord(row));
    const last = objects.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? Buffer.from(JSON.stringify({ binding, createdAt: last.createdAt, id: last.id })).toString(
            "base64url",
          )
        : null;
    return { objects, nextCursor };
  }
  private requireCardReference(id: string | null | undefined): void {
    if (id) this.getCard(id);
  }
  private allocateId(kind: "card" | "item"): string {
    const table = kind === "card" ? "cards" : "items";
    let id: string;
    do {
      id = `${kind}_${randomBytes(4).toString("hex")}`;
    } while (this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id));
    return id;
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function tableFor(id: string): "cards" | "items" {
  if (id.startsWith("card_")) return "cards";
  if (id.startsWith("item_")) return "items";
  throw new WorkError("not_found", `Unknown work object ${id}`);
}
function relationTables(relation: WorkListCards["sessionRelation"]): string[] {
  if (!relation || relation === "any") return ["sessions", "touches"];
  return [relation === "linked" ? "sessions" : "touches"];
}
function patchSessions(
  old: WorkComponents["sessions"],
  patch: WorkUpdateCard["sessions"],
): WorkComponents["sessions"] {
  if (patch === undefined) return old;
  if (patch === null) return null;
  const members = new Set(old?.agentIds ?? []);
  for (const id of patch.remove ?? []) members.delete(id);
  for (const id of patch.add ?? []) members.add(id);
  return { agentIds: [...members] };
}
function patchViewers(
  old: WorkComponents["viewers"],
  patch: WorkUpdateCard["viewers"],
): WorkComponents["viewers"] {
  if (patch === undefined) return old;
  if (patch === null) return null;
  return {
    mounts: patchMap(old?.mounts, patch.mounts),
    sources: patchMap(old?.sources, patch.sources),
    entries: patchMap(old?.entries, patch.entries),
  };
}
function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}
function archiveWhere(archive: "active" | "archived" | "all"): string {
  if (archive === "all") return "1";
  return archive === "active" ? "archived_at IS NULL" : "archived_at IS NOT NULL";
}
function supplied<T>(value: T | undefined, original: T): T {
  return value === undefined ? original : value;
}
function patchMap<T>(
  old: Record<string, T> | undefined,
  patch: Record<string, T | null> | undefined,
): Record<string, T> {
  const merged = { ...old };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}
function bindReferences(
  components: WorkComponents,
  id: string,
  parent: string | null,
): WorkComponents {
  function bind(ref: { objectId: string; source: string }) {
    if (ref.objectId === "self") return { ...ref, objectId: id };
    if (ref.objectId === "parent") {
      if (!parent) throw new WorkError("invalid_input", "A Card has no parent source");
      return { ...ref, objectId: parent };
    }
    return ref;
  }
  const bound = { ...components };
  if (bound.progress?.source?.type === "viewer-source")
    bound.progress = {
      ...bound.progress,
      source: { ...bound.progress.source, source: bind(bound.progress.source.source) },
    };
  if (bound.metrics)
    bound.metrics = {
      panels: bound.metrics.panels.map((panel) => ({ ...panel, source: bind(panel.source) })),
    };
  if (bound.sessions) bound.sessions = { agentIds: [...new Set(bound.sessions.agentIds)] };
  if (bound.result) bound.result = { completed: false, ...bound.result };
  return bound;
}
function resultTimes(
  result: WorkComponents["result"],
  old: WorkObject | null,
  input: { startedAt?: string | null; endedAt?: string | null },
  now: string,
) {
  let startedAt = supplied(input.startedAt, old?.startedAt ?? null);
  let endedAt = supplied(input.endedAt, old?.endedAt ?? null);
  if (result && !startedAt && input.startedAt === undefined) startedAt = now;
  if (result?.completed && !endedAt && input.endedAt === undefined) endedAt = now;
  if (old?.result?.completed && result && !result.completed && input.endedAt === undefined)
    endedAt = null;
  return { startedAt, endedAt };
}
function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 86400)).padStart(4, "0")}d-${String(Math.floor(seconds / 3600) % 24).padStart(2, "0")}h${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}m${String(seconds % 60).padStart(2, "0")}s`;
}
function slug(value: string, fallback: string): string {
  const normalized = normalize(value)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  let bytes = 0;
  let result = "";
  for (const character of normalized) {
    bytes += Buffer.byteLength(character);
    if (bytes > 96) break;
    result += character;
  }
  return result.replace(/-$/, "") || fallback;
}
