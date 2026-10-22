import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { ScheduleCadence } from "@getpaseo/protocol/schedule/types";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import {
  CRON_FIELDS,
  serializeCalendar,
  intervalParts,
  type CronFieldKey,
  type CronTerm,
  type CronTermKind,
  type HeartbeatFormModel,
  type HeartbeatFormState,
  type IntervalUnit,
} from "@/schedules/heartbeat-form-model";

export const HEARTBEAT_PATTERNS = [
  { expression: "* * * * *", label: "everyMinute" },
  { expression: "*/10 * * * *", label: "everyTenMinutes" },
  { expression: "0 * * * *", label: "hourly" },
  { expression: "0 9 * * *", label: "daily" },
  { expression: "0 9 * * 1-5", label: "weekdays" },
] as const;

interface CadenceEditorProps {
  model: HeartbeatFormModel;
  state: HeartbeatFormState;
  size: FieldControlSize;
}

export function HeartbeatCadenceSummary({ cadence }: { cadence: ScheduleCadence }) {
  const { t } = useTranslation();
  let summary: string;
  if (cadence.type === "every") {
    const parts = intervalParts(cadence.everyMs);
    summary = t("heartbeats.intervalSummary", {
      value: parts.value,
      unit: t(`heartbeats.${parts.unit}`),
    });
  } else {
    const pattern = HEARTBEAT_PATTERNS.find(
      (entry) => entry.expression === cadence.expression.trim(),
    );
    summary = pattern
      ? `${t(`heartbeats.${pattern.label}`)} · ${cadence.timezone ?? "UTC"}`
      : t("heartbeats.calendarSummary", { timezone: cadence.timezone ?? "UTC" });
  }
  return <Text style={styles.summary}>{summary}</Text>;
}

export function HeartbeatCadenceEditor({ model, state, size }: CadenceEditorProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const expression = serializeCalendar(state.calendar);
  const pattern = HEARTBEAT_PATTERNS.find((entry) => entry.expression === expression);
  const showFields = expanded || !pattern;
  const options = useMemo(
    () =>
      HEARTBEAT_PATTERNS.map((entry) => ({
        id: entry.expression,
        value: entry.expression,
        label: t(`heartbeats.${entry.label}`),
      })),
    [t],
  );
  const intervalUnits = useMemo(() => {
    const units: IntervalUnit[] = ["milliseconds", "seconds", "minutes", "hours", "days"];
    return units.map((value) => ({ id: value, value, label: t(`heartbeats.${value}`) }));
  }, [t]);
  const intervalDisplay = useMemo(
    () => ({ label: t(`heartbeats.${state.intervalUnit}`) }),
    [state.intervalUnit, t],
  );
  const patternDisplay = useMemo(
    () => ({ label: pattern ? t(`heartbeats.${pattern.label}`) : t("heartbeats.custom") }),
    [pattern, t],
  );
  const typeOptions = useMemo(
    () => [
      { value: "every" as const, label: t("heartbeats.interval") },
      { value: "cron" as const, label: t("heartbeats.calendar") },
    ],
    [t],
  );
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);

  return (
    <View style={styles.stack}>
      <Field label={t("heartbeats.cadence")}>
        <SegmentedControl
          size={size}
          value={state.type}
          onValueChange={model.setType}
          options={typeOptions}
          testID="heartbeat-cadence-type"
        />
      </Field>
      {state.type === "every" ? (
        <View style={styles.row}>
          <View style={styles.grow}>
            <Field label={t("heartbeats.every")}>
              <FormTextInput
                initialValue={state.interval}
                onChangeText={model.setInterval}
                keyboardType="number-pad"
                size={size}
                testID="heartbeat-interval"
              />
            </Field>
          </View>
          <View style={styles.grow}>
            <SelectField
              label={t("heartbeats.interval")}
              value={state.intervalUnit}
              selectedDisplay={intervalDisplay}
              options={intervalUnits}
              onChange={model.setIntervalUnit}
              placeholder=""
              emptyText=""
              searchable={false}
              size={size}
              triggerTestID="heartbeat-interval-unit"
            />
          </View>
        </View>
      ) : (
        <>
          <SelectField
            label={t("heartbeats.preset")}
            value={pattern?.expression ?? null}
            selectedDisplay={patternDisplay}
            options={options}
            onChange={model.setPreset}
            placeholder=""
            emptyText=""
            searchable={false}
            size={size}
            triggerTestID="heartbeat-pattern"
          />
          <Field label={t("heartbeats.timezone")}>
            <FormTextInput
              initialValue={state.calendar.timezone}
              onChangeText={model.setTimezone}
              placeholder="UTC"
              autoCapitalize="none"
              autoCorrect={false}
              size={size}
              testID="heartbeat-timezone"
            />
          </Field>
          <Button
            variant="ghost"
            size="sm"
            onPress={toggleExpanded}
            testID="heartbeat-calendar-fields"
          >
            {t("heartbeats.advanced")}
          </Button>
          {showFields ? (
            <View style={styles.stack}>
              <Text style={styles.summary}>{t("heartbeats.calendarRule")}</Text>
              {CRON_FIELDS.map((field) => (
                <CronFieldEditor
                  key={field.key}
                  field={field.key}
                  state={state}
                  model={model}
                  size={size}
                />
              ))}
            </View>
          ) : null}
        </>
      )}
      {state.cadenceError ? (
        <Text style={styles.error} testID="heartbeat-cadence-error">
          {t(`heartbeats.${state.cadenceError}Error`)}
        </Text>
      ) : null}
    </View>
  );
}

interface CronFieldEditorProps extends CadenceEditorProps {
  field: CronFieldKey;
}

function CronFieldEditor({ field, state, model, size }: CronFieldEditorProps) {
  const { t } = useTranslation();
  const terms = state.calendar.fields[field];
  const addTerm = useCallback(() => model.addTerm(field), [model, field]);
  return (
    <Field label={t(`heartbeats.${field}`)}>
      <View style={styles.stack}>
        {terms.map((term) => (
          <CronTermEditor
            key={term.id}
            field={field}
            term={term}
            model={model}
            size={size}
            removable={terms.length > 1}
          />
        ))}
        <Button variant="ghost" size="sm" onPress={addTerm} testID={`heartbeat-${field}-add`}>
          {t("heartbeats.addRule")}
        </Button>
      </View>
    </Field>
  );
}

interface CronTermEditorProps {
  field: CronFieldKey;
  term: CronTerm;
  model: HeartbeatFormModel;
  size: FieldControlSize;
  removable: boolean;
}

function cronValueLabel(field: CronFieldKey, value: number, language: string): string {
  if (field === "month") {
    return new Intl.DateTimeFormat(language, { month: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, value - 1, 1)),
    );
  }
  if (field === "dayOfWeek") {
    return new Intl.DateTimeFormat(language, { weekday: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 0, 7 + value)),
    );
  }
  return String(value).padStart(2, "0");
}

interface CronValueSelectProps extends Omit<CronTermEditorProps, "removable"> {
  part: "start" | "end";
}

function CronValueSelect({ field, term, model, size, part }: CronValueSelectProps) {
  const { t, i18n } = useTranslation();
  const options = useMemo(() => {
    const bounds = CRON_FIELDS.find((entry) => entry.key === field)!;
    return Array.from({ length: bounds.max - bounds.min + 1 }, (_, index) => {
      const value = bounds.min + index;
      return {
        id: String(value),
        value: String(value),
        label: cronValueLabel(field, value, i18n.language),
      };
    });
  }, [field, i18n.language]);
  const display = useMemo(
    () => ({ label: cronValueLabel(field, Number(term[part]), i18n.language) }),
    [field, term, part, i18n.language],
  );
  let label = t("heartbeats.value");
  if (term.kind === "range") label = t(part === "start" ? "heartbeats.from" : "heartbeats.to");
  const changeValue = useCallback(
    (value: string) => model.setTerm(field, term.id, { [part]: value }),
    [field, term.id, part, model],
  );
  return (
    <View style={styles.grow}>
      <SelectField
        label={label}
        value={String(Number(term[part]))}
        selectedDisplay={display}
        options={options}
        onChange={changeValue}
        placeholder=""
        emptyText=""
        size={size}
        searchable={options.length > 12}
        triggerTestID={`heartbeat-${field}-${term.id}-${part}`}
      />
    </View>
  );
}

function CronTermEditor({ field, term, model, size, removable }: CronTermEditorProps) {
  const { t } = useTranslation();
  const kindOptions = useMemo(() => {
    const kinds: CronTermKind[] = ["any", "value", "range"];
    return kinds.map((kind) => ({ id: kind, value: kind, label: t(`heartbeats.${kind}`) }));
  }, [t]);
  const kindDisplay = useMemo(() => ({ label: t(`heartbeats.${term.kind}`) }), [term.kind, t]);
  const changeKind = useCallback(
    (kind: CronTermKind) => model.setTerm(field, term.id, { kind }),
    [field, term.id, model],
  );
  const changeStep = useCallback(
    (step: string) => model.setTerm(field, term.id, { step }),
    [field, term.id, model],
  );
  const remove = useCallback(() => model.removeTerm(field, term.id), [field, term.id, model]);
  return (
    <View style={styles.stack}>
      <SelectField
        label={t(`heartbeats.${field}`)}
        field={false}
        value={term.kind}
        selectedDisplay={kindDisplay}
        options={kindOptions}
        onChange={changeKind}
        placeholder=""
        emptyText=""
        searchable={false}
        size={size}
        triggerTestID={`heartbeat-${field}-${term.id}-kind`}
      />
      <View style={styles.row}>
        {term.kind !== "any" ? (
          <CronValueSelect field={field} term={term} model={model} size={size} part="start" />
        ) : null}
        {term.kind === "range" ? (
          <CronValueSelect field={field} term={term} model={model} size={size} part="end" />
        ) : null}
        {term.kind !== "value" ? (
          <View style={styles.grow}>
            <Field label={t("heartbeats.step")}>
              <FormTextInput
                initialValue={term.step}
                onChangeText={changeStep}
                keyboardType="number-pad"
                size={size}
                testID={`heartbeat-${field}-${term.id}-step`}
              />
            </Field>
          </View>
        ) : null}
      </View>
      {removable ? (
        <Button variant="ghost" size="sm" onPress={remove}>
          {t("heartbeats.removeRule")}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  stack: { gap: theme.spacing[3] },
  row: { flexDirection: "row", gap: theme.spacing[3], flexWrap: "wrap" },
  grow: { flex: 1, minWidth: 90 },
  summary: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));
