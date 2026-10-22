import { useHeartbeatEditor, closeAgentHeartbeats } from "@/schedules/heartbeat-editor";
import { useCallback, useMemo, useReducer, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { ScheduleSummary } from "@getpaseo/protocol/schedule/types";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { useFetchQuery } from "@/data/query";
import { useScheduleMutations } from "@/hooks/use-schedule-mutations";
import { getHostRuntimeStore, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { fetchAggregatedSchedules, schedulesQueryBaseKey } from "@/schedules/aggregated-schedules";
import {
  openHeartbeatForm,
  type HeartbeatFormModel,
  type HeartbeatFormState,
} from "@/schedules/heartbeat-form-model";
import { resolveScheduleTitle } from "@/utils/schedule-format";
import { toErrorMessage } from "@/utils/error-messages";
import { HeartbeatCadenceEditor, HeartbeatCadenceSummary } from "./heartbeat-cadence-editor";

interface AgentHeartbeatsSheetProps {
  serverId: string;
  agentId: string;
  onClose(): void;
}
type SheetPage =
  | { kind: "list" }
  | { kind: "edit"; schedule: ScheduleSummary; model: HeartbeatFormModel };
type SheetIntent = { type: "list" } | { type: "edit"; schedule: ScheduleSummary };
function sheetPageReducer(_page: SheetPage, intent: SheetIntent): SheetPage {
  if (intent.type === "list") return { kind: "list" };
  return { kind: "edit", schedule: intent.schedule, model: openHeartbeatForm(intent.schedule) };
}
const emptySubscribe = () => () => {};
const emptySnapshot = () => null;

function useHeartbeatDraftState(model: HeartbeatFormModel | null) {
  const subscribe = model ? model.subscribe : emptySubscribe;
  const snapshot = model ? model.getState : emptySnapshot;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

interface AgentHeartbeatsSlotProps {
  serverId: string;
  agentId: string | null;
  active: boolean;
  onClose(): void;
}

export function AgentHeartbeatsSheet({
  serverId,
  agentId,
  active,
  onClose,
}: AgentHeartbeatsSlotProps) {
  if (!active || !agentId) return null;
  return (
    <OpenAgentHeartbeatsSheet
      key={`${serverId}:${agentId}`}
      serverId={serverId}
      agentId={agentId}
      onClose={onClose}
    />
  );
}

function OpenAgentHeartbeatsSheet({ serverId, agentId, onClose }: AgentHeartbeatsSheetProps) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const runtime = getHostRuntimeStore();
  const online = useHostRuntimeIsConnected(serverId);
  const [page, dispatch] = useReducer(sheetPageReducer, { kind: "list" });
  const model = page.kind === "edit" ? page.model : null;
  const state = useHeartbeatDraftState(model);
  const query = useFetchQuery({
    queryKey: [...schedulesQueryBaseKey, "host", serverId, online],
    queryFn: () =>
      fetchAggregatedSchedules({ hosts: [{ serverId, serverName: serverId }], runtime }),
    dataShape: "list",
    staleTimeMs: 0,
    enabled: online,
  });
  const mutations = useScheduleMutations({ serverId });
  const [error, setError] = useState<string | null>(null);
  const schedules = query.data?.status === "loaded" ? query.data.data : [];
  const heartbeats = schedules.filter(
    (schedule) => schedule.target.type === "agent" && schedule.target.agentId === agentId,
  );
  const goBack = useCallback(() => {
    if (mutations.isUpdating) return;
    setError(null);
    dispatch({ type: "list" });
  }, [mutations.isUpdating]);
  const openEditor = useCallback((schedule: ScheduleSummary) => {
    setError(null);
    dispatch({ type: "edit", schedule });
  }, []);
  const close = useCallback(() => {
    if (!mutations.isUpdating) onClose();
  }, [mutations.isUpdating, onClose]);
  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  const toggleStatus = useCallback(
    async (schedule: ScheduleSummary) => {
      setError(null);
      try {
        if (schedule.status === "paused") await mutations.resumeSchedule(schedule.id);
        else await mutations.pauseSchedule(schedule.id);
      } catch (failure) {
        setError(toErrorMessage(failure));
      }
    },
    [mutations],
  );
  const save = useCallback(async () => {
    if (!model || !state?.canSubmit || mutations.isUpdating) return;
    setError(null);
    try {
      await mutations.updateSchedule(model.buildUpdate());
      dispatch({ type: "list" });
    } catch (failure) {
      setError(toErrorMessage(failure));
    }
  }, [model, state?.canSubmit, mutations]);
  const savePress = useCallback(() => {
    void save();
  }, [save]);
  const header = useMemo(() => {
    if (page.kind === "edit") return { title: t("heartbeats.edit"), back: { onPress: goBack } };
    return { title: t("heartbeats.title") };
  }, [page.kind, goBack, t]);
  const footer = useMemo(() => {
    if (!model || !state) return null;
    return (
      <View style={styles.actions}>
        <Button variant="secondary" onPress={goBack} disabled={mutations.isUpdating}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          onPress={savePress}
          disabled={!online || !state.canSubmit || mutations.isUpdating}
          loading={mutations.isUpdating}
          testID="heartbeat-save"
        >
          {t("heartbeats.save")}
        </Button>
      </View>
    );
  }, [model, state, online, goBack, savePress, mutations.isUpdating, t]);
  let content;
  if (!online) content = <Text style={styles.summary}>{t("heartbeats.unavailable")}</Text>;
  else if (model && state && page.kind === "edit") {
    content = (
      <HeartbeatEditorFields key={page.schedule.id} model={model} state={state} size={size} />
    );
  } else if (query.isError) {
    content = (
      <Text style={styles.error}>
        {t("heartbeats.loadError")} {toErrorMessage(query.error)}
      </Text>
    );
  } else if (query.isPending || query.data?.status !== "loaded") {
    content = <LoadingSpinner color={styles.summary.color} />;
  } else if (heartbeats.length === 0) {
    content = (
      <Text style={styles.summary} testID="heartbeats-empty">
        {t("heartbeats.empty")}
      </Text>
    );
  } else {
    content = heartbeats.map((schedule) => (
      <HeartbeatRow
        key={schedule.id}
        schedule={schedule}
        onEdit={openEditor}
        onToggleStatus={toggleStatus}
        pending={mutations.isPausing || mutations.isResuming}
      />
    ));
  }
  return (
    <AdaptiveModalSheet
      visible
      onClose={close}
      header={header}
      footer={footer}
      testID="agent-heartbeats-sheet"
    >
      <View style={styles.stack}>
        {page.kind === "list" ? (
          <View style={styles.actions}>
            <Button
              variant="ghost"
              size="sm"
              onPress={refresh}
              loading={query.isFetching}
              disabled={!online}
              testID="heartbeats-refresh"
            >
              {t("heartbeats.refresh")}
            </Button>
          </View>
        ) : null}
        {content}
        {error ? (
          <Text style={styles.error} testID="heartbeat-save-error">
            {error}
          </Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

interface HeartbeatRowProps {
  schedule: ScheduleSummary;
  onEdit(schedule: ScheduleSummary): void;
  onToggleStatus(schedule: ScheduleSummary): Promise<void>;
  pending: boolean;
}
function HeartbeatRow({ schedule, onEdit, onToggleStatus, pending }: HeartbeatRowProps) {
  const { t } = useTranslation();
  const edit = useCallback(() => onEdit(schedule), [onEdit, schedule]);
  const toggle = useCallback(() => {
    void onToggleStatus(schedule);
  }, [onToggleStatus, schedule]);
  return (
    <View style={styles.entry}>
      <Button variant="ghost" size="sm" onPress={edit} testID={`heartbeat-edit-${schedule.id}`}>
        {resolveScheduleTitle(schedule)}
      </Button>
      <HeartbeatCadenceSummary cadence={schedule.cadence} />
      <Text style={styles.summary}>{t(`heartbeats.${schedule.status}`)}</Text>
      {schedule.nextRunAt ? (
        <Text style={styles.summary}>
          {t("heartbeats.nextRun", { time: new Date(schedule.nextRunAt).toLocaleString() })}
        </Text>
      ) : null}
      {schedule.lastRunAt ? (
        <Text style={styles.summary}>
          {t("heartbeats.lastRun", { time: new Date(schedule.lastRunAt).toLocaleString() })}
        </Text>
      ) : null}
      {schedule.status !== "completed" ? (
        <Button variant="outline" size="sm" disabled={pending} onPress={toggle}>
          {t(schedule.status === "paused" ? "heartbeats.resume" : "heartbeats.pause")}
        </Button>
      ) : null}
    </View>
  );
}

interface HeartbeatEditorFieldsProps {
  model: HeartbeatFormModel;
  state: HeartbeatFormState;
  size: FieldControlSize;
}
function HeartbeatEditorFields({ model, state, size }: HeartbeatEditorFieldsProps) {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const toggleDetails = useCallback(() => setShowDetails((current) => !current), []);
  return (
    <View style={styles.stack}>
      <Field label={t("heartbeats.prompt")}>
        <FormTextInput
          initialValue={state.prompt}
          onChangeText={model.setPrompt}
          multiline
          numberOfLines={8}
          size={size}
          style={styles.prompt}
          testID="heartbeat-prompt"
        />
      </Field>
      <HeartbeatCadenceEditor model={model} state={state} size={size} />
      <Button variant="ghost" size="sm" onPress={toggleDetails}>
        {t("heartbeats.details")}
      </Button>
      {showDetails ? (
        <>
          <Field label={t("heartbeats.name")}>
            <FormTextInput initialValue={state.name} onChangeText={model.setName} size={size} />
          </Field>
          <Field
            label={t("heartbeats.maxRuns")}
            error={state.maxRunsError ? t("heartbeats.maxRunsError") : null}
          >
            <FormTextInput
              initialValue={state.maxRuns}
              onChangeText={model.setMaxRuns}
              placeholder={t("heartbeats.unlimited")}
              keyboardType="number-pad"
              size={size}
            />
          </Field>
          <Field
            label={t("heartbeats.expiresAt")}
            error={state.expiresAtError ? t("heartbeats.expiresAtError") : null}
          >
            <FormTextInput
              initialValue={state.expiresAt}
              onChangeText={model.setExpiresAt}
              placeholder={t("heartbeats.datePlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              size={size}
            />
          </Field>
        </>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  stack: { gap: theme.spacing[4] },
  entry: {
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
  summary: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  prompt: { minHeight: 160, textAlignVertical: "top" },
}));

export function AgentHeartbeatsHost({ serverId, active }: { serverId: string; active: boolean }) {
  const target = useHeartbeatEditor((state) => state.target);
  return (
    <AgentHeartbeatsSheet
      serverId={serverId}
      agentId={target?.serverId === serverId ? target.agentId : null}
      active={active}
      onClose={closeAgentHeartbeats}
    />
  );
}
