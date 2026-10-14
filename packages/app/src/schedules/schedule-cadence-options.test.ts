import { describe, expect, it } from "vitest";
import {
  CADENCE_PRESET_OPTIONS,
  normalizeScheduleFormCadence,
  resolveCronPresetId,
} from "./schedule-cadence-options";

describe("schedule cadence form options", () => {
  it("offers the approved cron preset vocabulary", () => {
    expect(CADENCE_PRESET_OPTIONS.map((option) => option.label)).toEqual([
      "Every minute",
      "Every hour",
      "Daily 9:00",
      "Weekdays 9:00",
      "Mondays 9:00",
    ]);
  });

  it("maps interval cadences to cron cadences for the form", () => {
    expect(
      normalizeScheduleFormCadence({ type: "every", everyMs: 60_000 }, "Europe/Madrid"),
    ).toEqual({
      type: "cron",
      expression: "* * * * *",
      timezone: "Europe/Madrid",
    });
    expect(
      normalizeScheduleFormCadence({ type: "every", everyMs: 60 * 60_000 }, "Europe/Madrid"),
    ).toEqual({
      type: "cron",
      expression: "0 * * * *",
      timezone: "Europe/Madrid",
    });
    expect(
      normalizeScheduleFormCadence({ type: "every", everyMs: 24 * 60 * 60_000 }, "Europe/Madrid"),
    ).toEqual({
      type: "cron",
      expression: "0 9 * * *",
      timezone: "Europe/Madrid",
    });
  });

  it("maps unsupported intervals to the closest custom cron expression", () => {
    const cadence = normalizeScheduleFormCadence(
      { type: "every", everyMs: 5 * 60_000 },
      "Europe/Madrid",
    );

    expect(cadence).toEqual({
      type: "cron",
      expression: "*/5 * * * *",
      timezone: "Europe/Madrid",
    });
    expect(resolveCronPresetId(cadence)).toBe("custom");
  });
});

import type { ScheduleSummary } from "@getpaseo/protocol/schedule/types";
import { parseCronExpression } from "@getpaseo/protocol/schedule/cron-expression";
import {
  openHeartbeatForm,
  parseCalendar,
  serializeCalendar,
  CRON_FIELDS,
} from "./heartbeat-form-model";

function heartbeat(cadence: ScheduleSummary["cadence"]): ScheduleSummary {
  return {
    id: "heartbeat-test",
    name: "Continue",
    prompt: "Old prompt",
    cadence,
    target: { type: "agent", agentId: "c142568e-df00-4a2a-a537-3548d83937f2" },
    status: "paused",
    createdAt: "2026-10-14T00:00:00Z",
    updatedAt: "2026-10-14T00:00:00Z",
    nextRunAt: null,
    lastRunAt: null,
    pausedAt: "2026-10-14T00:00:00Z",
    maxRuns: 7,
    expiresAt: "2026-12-31T00:00:00Z",
  };
}

describe("heartbeat cadence editing", () => {
  it.each([
    "* * * * *",
    "*/10 * * * *",
    "0,10-20/2,*/15 1-20/3 1,5-25/4 1-12/2 0,2-6/2",
    "00,01-09/2 00/3 01/2 01/5 00/4",
  ])("round-trips every supported field construct in %s", (expression) => {
    const calendar = parseCalendar(expression, "Asia/Shanghai");
    expect(serializeCalendar(calendar)).toBe(expression);
    const before = parseCronExpression(expression);
    const after = parseCronExpression(serializeCalendar(calendar));
    for (const field of CRON_FIELDS) {
      for (let value = field.min; value <= field.max; value += 1) {
        expect(after[field.key].matches(value)).toBe(before[field.key].matches(value));
      }
    }
  });

  it("updates prompt alone without rewriting cron, timezone, status or limits", () => {
    const form = openHeartbeatForm(heartbeat({ type: "cron", expression: "  */10   * * * *  " }));
    form.setPrompt("A much better prompt");
    expect(form.getState().canSubmit).toBe(true);
    expect(form.buildUpdate()).toEqual({ id: "heartbeat-test", prompt: "A much better prompt" });
  });

  it.each([1, 1500, 90 * 60_000, 26 * 3_600_000])(
    "preserves the exact %s ms interval on prompt edits",
    (everyMs) => {
      const form = openHeartbeatForm(heartbeat({ type: "every", everyMs }));
      form.setPrompt("Improved");
      expect(form.getState().cadence).toEqual({ type: "every", everyMs });
      expect(form.buildUpdate()).toEqual({ id: "heartbeat-test", prompt: "Improved" });
    },
  );

  it("edits arbitrary interval units and restores calendar choices when toggling", () => {
    const form = openHeartbeatForm(
      heartbeat({ type: "cron", expression: "0 9 * * 1-5", timezone: "America/New_York" }),
    );
    form.setType("every");
    form.setIntervalUnit("seconds");
    form.setInterval("17");
    expect(form.buildUpdate()).toEqual({
      id: "heartbeat-test",
      cadence: { type: "every", everyMs: 17_000 },
    });
    form.setType("cron");
    expect(form.getState().dirty).toBe(false);
    expect(form.getState().calendar.timezone).toBe("America/New_York");
  });

  it("edits ranges, steps, alternatives and named-date values without raw cron input", () => {
    const form = openHeartbeatForm(heartbeat({ type: "cron", expression: "* * * * *" }));
    const minute = form.getState().calendar.fields.minute[0];
    form.setTerm("minute", minute.id, { step: "10" });
    const hour = form.getState().calendar.fields.hour[0];
    form.setTerm("hour", hour.id, { kind: "range", start: "8", end: "18", step: "2" });
    form.addTerm("hour");
    const alternative = form.getState().calendar.fields.hour[1];
    form.setTerm("hour", alternative.id, { start: "22" });
    const weekday = form.getState().calendar.fields.dayOfWeek[0];
    form.setTerm("dayOfWeek", weekday.id, { kind: "range", start: "1", end: "5" });
    form.setTimezone("Asia/Shanghai");
    expect(form.buildUpdate().cadence).toEqual({
      type: "cron",
      expression: "*/10 8-18/2,22 * * 1-5",
      timezone: "Asia/Shanghai",
    });
    form.removeTerm("hour", alternative.id);
    expect(form.getState().calendar.fields.hour).toHaveLength(1);
  });

  it("keeps invalid input editable and blocks save until corrected", () => {
    const form = openHeartbeatForm(heartbeat({ type: "cron", expression: "* * * * *" }));
    const minute = form.getState().calendar.fields.minute[0];
    form.setTerm("minute", minute.id, { step: "0" });
    expect(form.getState()).toMatchObject({ canSubmit: false, cadenceError: "calendar" });
    form.setTerm("minute", minute.id, { step: "15" });
    form.setTimezone("not/a-zone");
    expect(form.getState()).toMatchObject({ canSubmit: false, cadenceError: "timezone" });
    form.setTimezone("UTC");
    expect(form.getState().canSubmit).toBe(true);
  });

  it("clears stop limits explicitly while leaving an untouched cadence unchanged", () => {
    const form = openHeartbeatForm(heartbeat({ type: "every", everyMs: 5400_000 }));
    form.setMaxRuns("");
    form.setExpiresAt("");
    expect(form.buildUpdate()).toEqual({ id: "heartbeat-test", maxRuns: null, expiresAt: null });
  });
});

describe("heartbeat timezone clearing", () => {
  it("sends UTC explicitly when clearing an existing timezone rather than asking the host to preserve it", () => {
    const form = openHeartbeatForm(
      heartbeat({
        type: "cron",
        expression: "0 9 * * *",
        timezone: "Asia/Shanghai",
      }),
    );
    form.setTimezone("");
    expect(form.buildUpdate()).toEqual({
      id: "heartbeat-test",
      cadence: { type: "cron", expression: "0 9 * * *", timezone: "UTC" },
    });
  });
});
