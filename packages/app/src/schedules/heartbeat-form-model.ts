import type {
  ScheduleCadence,
  ScheduleSummary,
  UpdateScheduleInput,
} from "@getpaseo/protocol/schedule/types";
import { validateCronExpression } from "@getpaseo/protocol/schedule/cron-expression";

export const CRON_FIELDS = [
  { key: "minute", min: 0, max: 59 },
  { key: "hour", min: 0, max: 23 },
  { key: "dayOfMonth", min: 1, max: 31 },
  { key: "month", min: 1, max: 12 },
  { key: "dayOfWeek", min: 0, max: 6 },
] as const;

export type CronFieldKey = (typeof CRON_FIELDS)[number]["key"];
export type CronTermKind = "any" | "value" | "range";
export type IntervalUnit = "milliseconds" | "seconds" | "minutes" | "hours" | "days";

export const INTERVAL_UNITS: Record<IntervalUnit, number> = {
  milliseconds: 1,
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

export interface CronTerm {
  id: number;
  kind: CronTermKind;
  start: string;
  end: string;
  step: string;
  explicitStep: boolean;
}

export interface CalendarDraft {
  fields: Record<CronFieldKey, CronTerm[]>;
  timezone: string;
}

export interface HeartbeatFormState {
  name: string;
  prompt: string;
  maxRuns: string;
  expiresAt: string;
  type: ScheduleCadence["type"];
  interval: string;
  intervalUnit: IntervalUnit;
  calendar: CalendarDraft;
  cadence: ScheduleCadence | null;
  cadenceError: "interval" | "calendar" | "timezone" | null;
  maxRunsError: boolean;
  expiresAtError: boolean;
  canSubmit: boolean;
  dirty: boolean;
}

export interface HeartbeatFormModel {
  getState(): HeartbeatFormState;
  subscribe(listener: () => void): () => void;
  setName(value: string): void;
  setPrompt(value: string): void;
  setMaxRuns(value: string): void;
  setExpiresAt(value: string): void;
  setType(value: ScheduleCadence["type"]): void;
  setInterval(value: string): void;
  setIntervalUnit(value: IntervalUnit): void;
  setTimezone(value: string): void;
  setTerm(field: CronFieldKey, id: number, patch: Partial<Omit<CronTerm, "id">>): void;
  addTerm(field: CronFieldKey): void;
  removeTerm(field: CronFieldKey, id: number): void;
  setPreset(expression: string): void;
  buildUpdate(): UpdateScheduleInput;
}

function parseTerm(source: string, id: number): CronTerm {
  const [base, step] = source.split("/");
  const range = base.split("-");
  let kind: CronTermKind = "value";
  if (base === "*") kind = "any";
  else if (range.length === 2) kind = "range";
  return {
    id,
    kind,
    start: kind === "any" ? "" : range[0],
    end: range[1] ?? "",
    step: step ?? "1",
    explicitStep: step !== undefined,
  };
}

export function serializeCronTerm(term: CronTerm): string {
  let base = "*";
  if (term.kind === "value") base = term.start;
  else if (term.kind === "range") base = `${term.start}-${term.end}`;
  return term.explicitStep ? `${base}/${term.step}` : base;
}

export function parseCalendar(expression: string, timezone: string): CalendarDraft {
  const error = validateCronExpression(expression);
  if (error) throw new Error(error);
  const sources = expression.trim().split(/\s+/);
  let id = 0;
  const fields: CalendarDraft["fields"] = {
    minute: [],
    hour: [],
    dayOfMonth: [],
    month: [],
    dayOfWeek: [],
  };
  for (const [index, field] of CRON_FIELDS.entries()) {
    fields[field.key] = sources[index].split(",").map((term) => parseTerm(term, id++));
  }
  return { fields, timezone };
}

export function serializeCalendar(calendar: CalendarDraft): string {
  return CRON_FIELDS.map((field) =>
    calendar.fields[field.key].map(serializeCronTerm).join(","),
  ).join(" ");
}

export function intervalParts(everyMs: number): { value: string; unit: IntervalUnit } {
  const units: IntervalUnit[] = ["days", "hours", "minutes", "seconds", "milliseconds"];
  const unit =
    units.find((candidate) => everyMs % INTERVAL_UNITS[candidate] === 0) ?? "milliseconds";
  return { value: String(everyMs / INTERVAL_UNITS[unit]), unit };
}

function positiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function deriveState(state: HeartbeatFormState): HeartbeatFormState {
  let cadence: ScheduleCadence | null = null;
  let cadenceError: HeartbeatFormState["cadenceError"] = null;
  if (state.type === "every") {
    const value = positiveInteger(state.interval);
    const everyMs = value === null ? 0 : value * INTERVAL_UNITS[state.intervalUnit];
    if (Number.isSafeInteger(everyMs) && everyMs > 0) cadence = { type: "every", everyMs };
    else cadenceError = "interval";
  } else {
    const expression = serializeCalendar(state.calendar);
    if (validateCronExpression(expression)) cadenceError = "calendar";
    else {
      try {
        if (state.calendar.timezone.trim()) {
          new Intl.DateTimeFormat("en", { timeZone: state.calendar.timezone.trim() }).format(
            new Date(0),
          );
        }
        const timezone = state.calendar.timezone.trim();
        cadence = { type: "cron", expression, timezone: timezone || "UTC" };
      } catch {
        cadenceError = "timezone";
      }
    }
  }
  const maxRunsError = state.maxRuns !== "" && positiveInteger(state.maxRuns) === null;
  const expiresAtError = state.expiresAt !== "" && !Number.isFinite(Date.parse(state.expiresAt));
  const valid =
    cadence !== null && state.prompt.trim().length > 0 && !maxRunsError && !expiresAtError;
  return {
    ...state,
    cadence,
    cadenceError,
    maxRunsError,
    expiresAtError,
    canSubmit: valid && state.dirty,
  };
}

function hasCadenceChanged(
  state: HeartbeatFormState,
  original: ScheduleCadence,
  originalExpression: string,
): boolean {
  if (state.type !== original.type) return true;
  if (state.type === "every" && original.type === "every") {
    return Number(state.interval) * INTERVAL_UNITS[state.intervalUnit] !== original.everyMs;
  }
  if (state.type === "cron" && original.type === "cron") {
    return (
      serializeCalendar(state.calendar) !== originalExpression ||
      state.calendar.timezone.trim() !== (original.timezone ?? "")
    );
  }
  return true;
}

export function openHeartbeatForm(schedule: ScheduleSummary): HeartbeatFormModel {
  const original = schedule.cadence;
  const initialInterval = intervalParts(original.type === "every" ? original.everyMs : 600_000);
  const calendar =
    original.type === "cron"
      ? parseCalendar(original.expression, original.timezone ?? "")
      : parseCalendar("*/10 * * * *", "UTC");
  let nextId =
    1 +
    Math.max(
      ...Object.values(calendar.fields)
        .flat()
        .map((term) => term.id),
    );
  let state = deriveState({
    name: schedule.name ?? "",
    prompt: schedule.prompt,
    maxRuns: schedule.maxRuns === null ? "" : String(schedule.maxRuns),
    expiresAt: schedule.expiresAt ?? "",
    type: original.type,
    interval: initialInterval.value,
    intervalUnit: initialInterval.unit,
    calendar,
    cadence: original,
    cadenceError: null,
    maxRunsError: false,
    expiresAtError: false,
    canSubmit: false,
    dirty: false,
  });
  const originalExpression = serializeCalendar(calendar);
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<HeartbeatFormState>) => {
    const next = { ...state, ...patch };
    const cadenceChanged = hasCadenceChanged(next, original, originalExpression);
    const dirty =
      cadenceChanged ||
      next.name !== (schedule.name ?? "") ||
      next.prompt !== schedule.prompt ||
      next.maxRuns !== (schedule.maxRuns === null ? "" : String(schedule.maxRuns)) ||
      next.expiresAt !== (schedule.expiresAt ?? "");
    state = deriveState({ ...next, dirty });
    for (const listener of listeners) listener();
  };
  const setTerms = (field: CronFieldKey, terms: CronTerm[]) => {
    publish({
      calendar: { ...state.calendar, fields: { ...state.calendar.fields, [field]: terms } },
    });
  };
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setName: (name) => publish({ name }),
    setPrompt: (prompt) => publish({ prompt }),
    setMaxRuns: (maxRuns) => publish({ maxRuns }),
    setExpiresAt: (expiresAt) => publish({ expiresAt }),
    setType: (type) => publish({ type }),
    setInterval: (interval) => publish({ interval }),
    setIntervalUnit: (intervalUnit) => publish({ intervalUnit }),
    setTimezone: (timezone) => publish({ calendar: { ...state.calendar, timezone } }),
    setTerm: (field, id, patch) => {
      const bounds = CRON_FIELDS.find((candidate) => candidate.key === field)!;
      setTerms(
        field,
        state.calendar.fields[field].map((term) => {
          if (term.id !== id) return term;
          const next = { ...term, ...patch };
          if (patch.kind) {
            next.start = next.start || String(bounds.min);
            next.end = next.end || String(bounds.max);
          }
          if (patch.step !== undefined) next.explicitStep = patch.step !== "1";
          return next;
        }),
      );
    },
    addTerm: (field) => {
      const bounds = CRON_FIELDS.find((candidate) => candidate.key === field)!;
      setTerms(field, [
        ...state.calendar.fields[field],
        {
          id: nextId++,
          kind: "value",
          start: String(bounds.min),
          end: String(bounds.max),
          step: "1",
          explicitStep: false,
        },
      ]);
    },
    removeTerm: (field, id) => {
      const terms = state.calendar.fields[field];
      if (terms.length > 1)
        setTerms(
          field,
          terms.filter((term) => term.id !== id),
        );
    },
    setPreset: (expression) => {
      const parsed = parseCalendar(expression, state.calendar.timezone);
      for (const terms of Object.values(parsed.fields)) {
        for (const term of terms) term.id = nextId++;
      }
      publish({ type: "cron", calendar: parsed });
    },
    buildUpdate: () => {
      if (!state.canSubmit || !state.cadence) throw new Error("Heartbeat form is not valid");
      const update: UpdateScheduleInput = { id: schedule.id };
      if (state.name !== (schedule.name ?? "")) update.name = state.name.trim() || null;
      if (state.prompt !== schedule.prompt) update.prompt = state.prompt.trim();
      if (hasCadenceChanged(state, original, originalExpression)) update.cadence = state.cadence;
      if (state.maxRuns !== (schedule.maxRuns === null ? "" : String(schedule.maxRuns))) {
        update.maxRuns = state.maxRuns === "" ? null : Number(state.maxRuns);
      }
      if (state.expiresAt !== (schedule.expiresAt ?? "")) {
        update.expiresAt = state.expiresAt === "" ? null : new Date(state.expiresAt).toISOString();
      }
      return update;
    },
  };
}
