import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  ProgressPlanSchema,
  ProgressSourceSchema,
  ViewerConfigSchema,
  type CreateAttemptInput,
  type CreateExperimentInput,
  type ExperimentAttempt,
  type ExperimentBoardPlacement,
  type ExperimentDetail,
  type ExperimentRecord,
  type ProgressObservation,
  type UpdateAttemptInput,
  type UpdateExperimentInput,
  type ViewerConfig,
} from "@getpaseo/protocol/experiments";

interface StatementSync {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
}

interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
  close(): void;
}

interface DatabaseSyncConstructor {
  new (path: string): DatabaseSync;
}

type Row = Record<string, unknown>;

export class ExperimentStoreError extends Error {
  constructor(
    readonly code: "not_found" | "invalid_reference" | "invalid_input",
    message: string,
  ) {
    super(message);
  }
}

export class ProjectExperimentStore {
  private constructor(
    readonly projectRoot: string,
    private readonly db: DatabaseSync,
  ) {}

  static async open(projectRoot: string): Promise<ProjectExperimentStore> {
    const paseoDir = path.join(projectRoot, ".paseo", "v1");
    await mkdir(path.join(paseoDir, "blobs", "shared"), { recursive: true });
    const sqliteSpecifier: string = "node:sqlite";
    const sqlite = (await import(sqliteSpecifier)) as { DatabaseSync: DatabaseSyncConstructor };
    const db = new sqlite.DatabaseSync(path.join(paseoDir, "state.db"));
    const store = new ProjectExperimentStore(projectRoot, db);
    store.initialize();
    return store;
  }

  close(): void {
    this.db.close();
  }

  listExperiments(options: {
    goal?: string;
    includeClosed?: boolean;
    includeArchived?: boolean;
  }): ExperimentRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (!options.includeClosed) clauses.push("e.closed_at IS NULL");
    if (!options.includeArchived) clauses.push("e.archived_at IS NULL");
    if (options.goal !== undefined) {
      clauses.push("g.name = ?");
      params.push(options.goal);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.db
      .prepare(
        `SELECT e.*, g.name AS goal_name FROM experiments e
         LEFT JOIN goals g ON g.id = e.goal_id
         ${where}
         ORDER BY e.created_at DESC`,
      )
      .all(...params)
      .map((row) => this.mapExperiment(row as Row));
  }

  getExperiment(experiment: string): ExperimentDetail {
    const record = this.findExperiment(experiment);
    if (!record) throw new ExperimentStoreError("not_found", `Experiment ${experiment} not found`);
    const attempts = this.db
      .prepare("SELECT * FROM attempts WHERE experiment_id = ? ORDER BY created_at ASC")
      .all(experiment)
      .map((row) => this.mapAttempt(row as Row));
    return { experiment: record, attempts };
  }

  async createExperiment(input: CreateExperimentInput): Promise<ExperimentRecord> {
    this.requireExperimentReference(input.basedOn ?? null, "basedOn");
    this.requireExperimentReference(input.viewerSource ?? null, "viewerSource");
    const now = new Date().toISOString();
    const id = this.generateHandle("exp", "experiments");
    const goalId = input.goal ? this.ensureGoal(input.goal, now) : null;
    const blobRelpath = path.posix.join(
      "blobs",
      "experiments",
      `${formatExperimentTimestamp(now)}-${slugify(input.shortDescription, "experiment")}-${id}`,
    );
    this.db
      .prepare(
        `INSERT INTO experiments (
          id, goal_id, short_description, description, based_on_experiment_id,
          viewer_source_experiment_id, viewer_config_json, conclusion, blob_relpath,
          closed_at, archived_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        goalId,
        input.shortDescription,
        input.description,
        input.basedOn ?? null,
        input.viewerSource ?? null,
        input.conclusion ?? null,
        blobRelpath,
        input.conclusion ? now : null,
        now,
        now,
      );
    await this.ensureRelativeDirectory(blobRelpath);
    return this.getExperiment(id).experiment;
  }

  updateExperiment(input: UpdateExperimentInput): ExperimentRecord {
    const existing = this.getExperiment(input.experiment).experiment;
    this.requireExperimentReference(input.basedOn ?? null, "basedOn", input.experiment);
    this.requireExperimentReference(input.viewerSource ?? null, "viewerSource", input.experiment);
    const now = new Date().toISOString();
    const goal = hasOwn(input, "goal") ? input.goal : existing.goal;
    const goalId = goal ? this.ensureGoal(goal, now) : null;
    const conclusion = hasOwn(input, "conclusion") ? input.conclusion : existing.conclusion;
    this.db
      .prepare(
        `UPDATE experiments SET goal_id = ?, short_description = ?, description = ?,
          based_on_experiment_id = ?, viewer_source_experiment_id = ?, conclusion = ?,
          closed_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        goalId,
        input.shortDescription ?? existing.shortDescription,
        input.description ?? existing.description,
        hasOwn(input, "basedOn") ? input.basedOn : existing.basedOn,
        hasOwn(input, "viewerSource") ? input.viewerSource : existing.viewerSource,
        conclusion,
        conclusion ? (existing.closedAt ?? now) : null,
        now,
        input.experiment,
      );
    return this.getExperiment(input.experiment).experiment;
  }

  async createAttempt(input: CreateAttemptInput): Promise<ExperimentAttempt> {
    const experiment = this.getExperiment(input.experiment).experiment;
    this.validateProgressPlan(input.progressPlan ?? null);
    const now = new Date().toISOString();
    const id = this.generateHandle("att", "attempts");
    const elapsed = Math.max(0, Date.parse(now) - Date.parse(experiment.createdAt));
    const blobRelpath = path.posix.join(
      experiment.blobRelpath,
      "attempts",
      `${formatElapsed(elapsed)}-${slugify(input.shortDescription, "attempt")}-${id}`,
    );
    this.db
      .prepare(
        `INSERT INTO attempts (
          id, experiment_id, short_description, purpose, result_summary, wandb_id, job_id,
          output_dir, progress_plan_json, progress_source_json, viewer_config_json, blob_relpath,
          started_at, ended_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        input.experiment,
        input.shortDescription,
        input.purpose,
        input.resultSummary ?? null,
        input.wandbId ?? null,
        input.jobId ?? null,
        input.outputDir ?? null,
        serializeNullable(input.progressPlan ?? null),
        serializeNullable(input.progressSource ?? null),
        blobRelpath,
        input.resultSummary ? now : null,
        now,
        now,
      );
    await this.ensureRelativeDirectory(blobRelpath);
    return this.getAttempt(id);
  }

  updateAttempt(input: UpdateAttemptInput): ExperimentAttempt {
    const existing = this.getAttempt(input.attempt);
    if (hasOwn(input, "progressPlan")) this.validateProgressPlan(input.progressPlan ?? null);
    const resultSummary = hasOwn(input, "resultSummary")
      ? input.resultSummary
      : existing.resultSummary;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE attempts SET short_description = ?, purpose = ?, result_summary = ?, wandb_id = ?,
          job_id = ?, output_dir = ?, progress_plan_json = ?, progress_source_json = ?,
          ended_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        input.shortDescription ?? existing.shortDescription,
        input.purpose ?? existing.purpose,
        resultSummary,
        hasOwn(input, "wandbId") ? input.wandbId : existing.wandbId,
        hasOwn(input, "jobId") ? input.jobId : existing.jobId,
        hasOwn(input, "outputDir") ? input.outputDir : existing.outputDir,
        hasOwn(input, "progressPlan")
          ? serializeNullable(input.progressPlan ?? null)
          : serializeNullable(existing.progressPlan),
        hasOwn(input, "progressSource")
          ? serializeNullable(input.progressSource ?? null)
          : serializeNullable(existing.progressSource),
        resultSummary ? (existing.endedAt ?? now) : existing.endedAt,
        now,
        input.attempt,
      );
    if (
      hasOwn(input, "progressSource") &&
      serializeNullable(input.progressSource ?? null) !== serializeNullable(existing.progressSource)
    ) {
      this.db.prepare("DELETE FROM attempt_progress WHERE attempt_id = ?").run(input.attempt);
    }
    return this.getAttempt(input.attempt);
  }

  getAttempt(attempt: string): ExperimentAttempt {
    const row = this.db.prepare("SELECT * FROM attempts WHERE id = ?").get(attempt) as
      | Row
      | undefined;
    if (!row) throw new ExperimentStoreError("not_found", `Attempt ${attempt} not found`);
    return this.mapAttempt(row);
  }

  getBoardLayout(): ExperimentBoardPlacement[] {
    return this.db
      .prepare(
        `SELECT experiment_id, column_value, row_value, width_value, height_value
         FROM experiment_board_layout ORDER BY experiment_id`,
      )
      .all()
      .map((row) => mapBoardPlacement(row as Row));
  }

  updateBoardLayout(placements: ExperimentBoardPlacement[]): ExperimentBoardPlacement[] {
    const statement = this.db.prepare(
      `INSERT INTO experiment_board_layout (
        experiment_id, column_value, row_value, width_value, height_value
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(experiment_id) DO UPDATE SET
        column_value=excluded.column_value, row_value=excluded.row_value,
        width_value=excluded.width_value, height_value=excluded.height_value`,
    );
    for (const placement of placements) {
      this.getExperiment(placement.experiment);
      statement.run(
        placement.experiment,
        placement.column,
        placement.row,
        placement.width,
        placement.height,
      );
    }
    return placements;
  }

  async resolveStorage(
    input:
      | { scope: "shared" }
      | { scope: "experiment"; experiment: string }
      | { scope: "attempt"; attempt: string },
  ): Promise<string> {
    let relative = path.posix.join("blobs", "shared");
    if (input.scope === "experiment") {
      relative = this.getExperiment(input.experiment).experiment.blobRelpath;
    } else if (input.scope === "attempt") {
      relative = this.getAttempt(input.attempt).blobRelpath;
    }
    return this.ensureRelativeDirectory(relative);
  }

  configureViewer(
    target: { experiment: string } | { attempt: string },
    viewer: ViewerConfig | null,
  ): ViewerConfig | null {
    const serialized = serializeNullable(viewer);
    const now = new Date().toISOString();
    if ("experiment" in target) {
      this.getExperiment(target.experiment);
      this.db
        .prepare("UPDATE experiments SET viewer_config_json = ?, updated_at = ? WHERE id = ?")
        .run(serialized, now, target.experiment);
    } else {
      this.getAttempt(target.attempt);
      this.db
        .prepare("UPDATE attempts SET viewer_config_json = ?, updated_at = ? WHERE id = ?")
        .run(serialized, now, target.attempt);
    }
    return viewer;
  }

  getProgressCursor(attempt: string): {
    observation: ProgressObservation | null;
    error: string | null;
    logOffset: number;
    logPartial: string;
    logIdentity: string | null;
  } {
    const row = this.db
      .prepare("SELECT * FROM attempt_progress WHERE attempt_id = ?")
      .get(attempt) as Row | undefined;
    if (!row) {
      return { observation: null, error: null, logOffset: 0, logPartial: "", logIdentity: null };
    }
    return {
      observation:
        row.current_value === null
          ? null
          : {
              current: Number(row.current_value),
              total: row.total_value === null ? null : Number(row.total_value),
              ended: Boolean(row.ended),
              phase: stringOrNull(row.phase),
              message: stringOrNull(row.message),
              refreshedAt: String(row.refreshed_at),
            },
      error: stringOrNull(row.error),
      logOffset: Number(row.log_offset ?? 0),
      logPartial: String(row.log_partial ?? ""),
      logIdentity: stringOrNull(row.log_identity),
    };
  }

  saveProgress(input: {
    attempt: string;
    observation: ProgressObservation | null;
    error: string | null;
    logOffset?: number;
    logPartial?: string;
    logIdentity?: string | null;
  }): void {
    const previous = this.getProgressCursor(input.attempt);
    const observation = input.observation ?? previous.observation;
    const observationColumns = progressObservationColumns(observation);
    const cursorColumns = progressCursorColumns(input, previous);
    this.db
      .prepare(
        `INSERT INTO attempt_progress (
          attempt_id, current_value, total_value, ended, phase, message, refreshed_at, error,
          log_offset, log_partial, log_identity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(attempt_id) DO UPDATE SET
          current_value=excluded.current_value, total_value=excluded.total_value,
          ended=excluded.ended, phase=excluded.phase, message=excluded.message,
          refreshed_at=excluded.refreshed_at, error=excluded.error,
          log_offset=excluded.log_offset, log_partial=excluded.log_partial,
          log_identity=excluded.log_identity`,
      )
      .run(
        input.attempt,
        observationColumns.current,
        observationColumns.total,
        observationColumns.ended,
        observationColumns.phase,
        observationColumns.message,
        observationColumns.refreshedAt,
        input.error,
        cursorColumns.logOffset,
        cursorColumns.logPartial,
        cursorColumns.logIdentity,
      );
    if (observation) {
      const attempt = this.getAttempt(input.attempt);
      const now = new Date().toISOString();
      this.db
        .prepare("UPDATE attempts SET started_at = ?, ended_at = ?, updated_at = ? WHERE id = ?")
        .run(
          attempt.startedAt ?? now,
          observation.ended ? (attempt.endedAt ?? now) : attempt.endedAt,
          now,
          input.attempt,
        );
    }
  }

  private initialize(): void {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS experiments (
        id TEXT PRIMARY KEY,
        goal_id TEXT REFERENCES goals(id),
        short_description TEXT NOT NULL,
        description TEXT NOT NULL,
        based_on_experiment_id TEXT REFERENCES experiments(id),
        viewer_source_experiment_id TEXT REFERENCES experiments(id),
        viewer_config_json TEXT,
        conclusion TEXT,
        blob_relpath TEXT NOT NULL,
        closed_at TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        experiment_id TEXT NOT NULL REFERENCES experiments(id),
        short_description TEXT NOT NULL,
        purpose TEXT NOT NULL,
        result_summary TEXT,
        wandb_id TEXT,
        job_id TEXT,
        output_dir TEXT,
        progress_plan_json TEXT,
        progress_source_json TEXT,
        viewer_config_json TEXT,
        blob_relpath TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempt_progress (
        attempt_id TEXT PRIMARY KEY REFERENCES attempts(id) ON DELETE CASCADE,
        current_value REAL,
        total_value REAL,
        ended INTEGER NOT NULL DEFAULT 0,
        phase TEXT,
        message TEXT,
        refreshed_at TEXT NOT NULL,
        error TEXT,
        log_offset INTEGER NOT NULL DEFAULT 0,
        log_partial TEXT NOT NULL DEFAULT '',
        log_identity TEXT
      );
      CREATE TABLE IF NOT EXISTS experiment_board_layout (
        experiment_id TEXT PRIMARY KEY REFERENCES experiments(id) ON DELETE CASCADE,
        column_value INTEGER,
        row_value INTEGER,
        width_value INTEGER,
        height_value INTEGER
      );
    `);
  }

  private findExperiment(experiment: string): ExperimentRecord | null {
    const row = this.db
      .prepare(
        `SELECT e.*, g.name AS goal_name FROM experiments e
         LEFT JOIN goals g ON g.id = e.goal_id WHERE e.id = ?`,
      )
      .get(experiment) as Row | undefined;
    return row ? this.mapExperiment(row) : null;
  }

  private mapExperiment(row: Row): ExperimentRecord {
    return {
      id: String(row.id),
      goal: stringOrNull(row.goal_name),
      shortDescription: String(row.short_description),
      description: String(row.description),
      basedOn: stringOrNull(row.based_on_experiment_id),
      viewerSource: stringOrNull(row.viewer_source_experiment_id),
      viewer: parseNullable(row.viewer_config_json, ViewerConfigSchema),
      conclusion: stringOrNull(row.conclusion),
      blobRelpath: String(row.blob_relpath),
      closedAt: stringOrNull(row.closed_at),
      archivedAt: stringOrNull(row.archived_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private mapAttempt(row: Row): ExperimentAttempt {
    const progress = this.getProgressCursor(String(row.id));
    return {
      id: String(row.id),
      experiment: String(row.experiment_id),
      shortDescription: String(row.short_description),
      purpose: String(row.purpose),
      resultSummary: stringOrNull(row.result_summary),
      wandbId: stringOrNull(row.wandb_id),
      jobId: stringOrNull(row.job_id),
      outputDir: stringOrNull(row.output_dir),
      progressPlan: parseNullable(row.progress_plan_json, ProgressPlanSchema),
      progressSource: parseNullable(row.progress_source_json, ProgressSourceSchema),
      viewer: parseNullable(row.viewer_config_json, ViewerConfigSchema),
      blobRelpath: String(row.blob_relpath),
      startedAt: stringOrNull(row.started_at),
      endedAt: stringOrNull(row.ended_at),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      progress: progress.observation,
      progressError: progress.error,
    };
  }

  private ensureGoal(name: string, now: string): string {
    const existing = this.db.prepare("SELECT id FROM goals WHERE name = ?").get(name) as
      | Row
      | undefined;
    if (existing) return String(existing.id);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO goals (id, name, description, archived_at, created_at, updated_at) VALUES (?, ?, NULL, NULL, ?, ?)",
      )
      .run(id, name, now, now);
    return id;
  }

  private requireExperimentReference(value: string | null, field: string, self?: string): void {
    if (!value) return;
    if (value === self) {
      throw new ExperimentStoreError("invalid_reference", `${field} cannot reference itself`);
    }
    if (!this.findExperiment(value)) {
      throw new ExperimentStoreError("invalid_reference", `${field} Experiment ${value} not found`);
    }
  }

  private validateProgressPlan(plan: CreateAttemptInput["progressPlan"]): void {
    if (!plan) return;
    if (plan.segments && plan.tracks) {
      throw new ExperimentStoreError(
        "invalid_input",
        "Progress plan cannot use both segments and tracks",
      );
    }
    if (plan.segments) this.validateProgressSegments(plan.segments, plan.total);
    for (const track of plan.tracks ?? []) {
      this.validateProgressSegments(track.segments, plan.total);
    }
  }

  private validateProgressSegments(
    segments: Array<{ start: number; end: number }>,
    total: number,
  ): void {
    let previousEnd = 0;
    for (const segment of segments) {
      if (segment.start < previousEnd || segment.end <= segment.start || segment.end > total) {
        throw new ExperimentStoreError(
          "invalid_input",
          "Progress segments in each track must be ordered, non-overlapping, and within the total",
        );
      }
      previousEnd = segment.end;
    }
  }

  private generateHandle(prefix: "exp" | "att", table: "experiments" | "attempts"): string {
    for (;;) {
      const id = `${prefix}_${randomBytes(4).toString("hex")}`;
      const existing = this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
      if (!existing) return id;
    }
  }

  private async ensureRelativeDirectory(relative: string): Promise<string> {
    const absolute = path.resolve(this.projectRoot, ".paseo", "v1", relative);
    await mkdir(absolute, { recursive: true });
    return absolute;
  }
}

function mapBoardPlacement(row: Row): ExperimentBoardPlacement {
  return {
    experiment: String(row.experiment_id),
    column: numberOrNull(row.column_value),
    row: numberOrNull(row.row_value),
    width: numberOrNull(row.width_value),
    height: numberOrNull(row.height_value),
  };
}

function progressObservationColumns(observation: ProgressObservation | null) {
  return {
    current: observation?.current ?? null,
    total: observation?.total ?? null,
    ended: observation?.ended ? 1 : 0,
    phase: observation?.phase ?? null,
    message: observation?.message ?? null,
    refreshedAt: observation?.refreshedAt ?? new Date().toISOString(),
  };
}

function progressCursorColumns(
  input: { logOffset?: number; logPartial?: string; logIdentity?: string | null },
  previous: { logOffset: number; logPartial: string; logIdentity: string | null },
) {
  return {
    logOffset: input.logOffset ?? previous.logOffset,
    logPartial: input.logPartial ?? previous.logPartial,
    logIdentity: input.logIdentity === undefined ? previous.logIdentity : input.logIdentity,
  };
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function serializeNullable(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

function parseNullable<T>(value: unknown, schema: { parse(input: unknown): T }): T | null {
  if (typeof value !== "string") return null;
  return schema.parse(JSON.parse(value));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function formatExperimentTimestamp(value: string): string {
  return value
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-");
}

function formatElapsed(milliseconds: number): string {
  let seconds = Math.floor(milliseconds / 1000);
  const days = Math.floor(seconds / 86_400);
  seconds -= days * 86_400;
  const hours = Math.floor(seconds / 3_600);
  seconds -= hours * 3_600;
  const minutes = Math.floor(seconds / 60);
  seconds -= minutes * 60;
  return `${String(days).padStart(4, "0")}d-${String(hours).padStart(2, "0")}h${String(minutes).padStart(2, "0")}m${String(seconds).padStart(2, "0")}s`;
}

function slugify(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const source = normalized || fallback;
  let bytes = 0;
  let result = "";
  for (const character of source) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 96) break;
    result += character;
    bytes += size;
  }
  return result || fallback;
}
