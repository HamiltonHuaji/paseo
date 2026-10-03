/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop, eslint-plugin-react-perf/jsx-no-new-function-as-prop, eslint-plugin-react-perf/jsx-no-new-object-as-prop -- Per-repository settings actions dispatch local intents. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import type {
  SkillRepositoryState,
  SkillRepositorySubscription,
} from "@getpaseo/protocol/skill-repositories";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@/components/settings";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Field } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSkillRepositoryPlan, useSkillRepositoryPlanError } from "@/skill-repositories/hooks";
import { openSubscriptionForm } from "@/skill-repositories/forms";
import {
  discardSkillRepositoryChange,
  rememberSkillRepositorySubscriptions,
  removeSkillRepositoryMember,
  retrySkillRepositoryChange,
  saveSkillRepositoryMember,
  subscriptionFromPlan,
  type SkillRepositoryLocalState,
} from "@/skill-repositories/plan";
import { settingsStyles } from "@/styles/settings";
import { buildSettingsSectionRoute } from "@/utils/host-routes";
import { repositoryError, skillRepositoryStyles as styles } from "./skill-repository-shared";

import {
  repositoryStatusLabel,
  repositoryRowError,
  visibleSubscriptions,
} from "@/skill-repositories/presentation";

type Mode = SkillRepositorySubscription["autoReceive"];

function CheckoutDetails({ actual }: { actual: SkillRepositoryState }) {
  const { t } = useTranslation();
  const status = actual.status;
  if (!status) return null;
  return (
    <SettingsSection title={t("settings.skillRepos.details")}>
      <SettingsCard>
        <SettingsRow
          label={t("settings.skillRepos.checkout")}
          hint={
            <Text selectable style={styles.code}>
              {status.checkoutPath}
            </Text>
          }
        />
        <SettingsRow
          label={t("settings.skillRepos.commits")}
          hint={
            <Text selectable style={styles.code}>
              {t("settings.skillRepos.heads", {
                local: status.localHead?.slice(0, 12) ?? "—",
                remote: status.remoteHead?.slice(0, 12) ?? "—",
              })}
            </Text>
          }
        />
        <SettingsRow
          label={t("settings.skillRepos.lastChecked")}
          hint={
            status.remoteCheckedAt
              ? new Date(status.remoteCheckedAt).toLocaleString()
              : t("settings.skillRepos.neverChecked")
          }
        />
        <SettingsRow
          label={t("settings.skillRepos.executor")}
          hint={t(
            actual.canRead
              ? "settings.skillRepos.executorAvailable"
              : "settings.skillRepos.executorUnavailable",
          )}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

function SubscriptionSheet({
  serverId,
  initial,
  actual,
  connected,
  local,
  onClose,
}: {
  serverId: string;
  initial?: SkillRepositorySubscription;
  actual: SkillRepositoryState | null;
  connected: boolean;
  local: SkillRepositoryLocalState;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const [showDetails, setShowDetails] = useState(false);
  const [snapshot] = useState(actual);
  const [expected] = useState(() => {
    const queued = local.pending.find(
      (p) => p.serverId === serverId && p.repositoryId === initial?.repositoryId,
    );
    if (queued && !queued.error) return queued.expected;
    return connected ? (actual?.subscription ?? null) : (initial ?? null);
  });
  const [model] = useState(() => openSubscriptionForm(initial));
  const form = useSyncExternalStore(model.subscribe, model.getState);
  useEffect(() => () => model.close(), [model]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const act = async (remove = false) => {
    setPending(true);
    setError("");
    try {
      if (remove && initial)
        await removeSkillRepositoryMember(serverId, initial.repositoryId, expected);
      else
        await saveSkillRepositoryMember(
          {
            serverId,
            repositoryId: form.repositoryId,
            autoReceive: form.autoReceive,
            agentPublishAllowed: form.agentPublishAllowed,
          },
          expected,
        );
      onClose();
    } catch (cause) {
      setError(repositoryError(cause));
    } finally {
      setPending(false);
    }
  };
  const options = local.plan.repositories.filter(
    (r) =>
      !r.deleted &&
      !local.plan.members.some(
        (m) => m.serverId === serverId && m.repositoryId === r.repositoryId && !m.deleted,
      ),
  );
  return (
    <AdaptiveModalSheet
      visible
      onClose={onClose}
      header={{ title: initial?.label ?? t("settings.skillRepos.subscribe") }}
      footer={
        <View style={styles.actions}>
          <Button disabled={pending || !form.repositoryId} onPress={() => void act()}>
            {t(pending ? "settings.skillRepos.saving" : "settings.skillRepos.save")}
          </Button>
          {initial ? (
            <Button variant="outline" disabled={pending} onPress={() => void act(true)}>
              {t("settings.skillRepos.unsubscribe")}
            </Button>
          ) : null}
        </View>
      }
    >
      <View style={styles.form}>
        {!initial ? (
          <SelectField
            label={t("settings.skillRepos.repository")}
            value={form.repositoryId || null}
            selectedDisplay={form.repositoryId ? { label: form.display } : null}
            options={options.map((r) => ({
              id: r.repositoryId,
              value: r.repositoryId,
              label: r.label,
              description: `${r.remoteUrl} · ${r.branch}`,
            }))}
            onChange={(repositoryId, display) =>
              model.set({ repositoryId, display: display.label })
            }
            placeholder={t("settings.skillRepos.chooseRepository")}
            emptyText={t("settings.skillRepos.noAvailableRepositories")}
            size={size}
          />
        ) : (
          <Text selectable style={styles.metadata}>
            {initial.remoteUrl} · {initial.branch}
          </Text>
        )}
        {!initial && options.length === 0 ? (
          <Button
            variant="outline"
            onPress={() => {
              onClose();
              router.push(buildSettingsSectionRoute("skill-repositories"));
            }}
          >
            {t("settings.skillRepos.addRepository")}
          </Button>
        ) : null}
        <Field
          label={t("settings.skillRepos.autoReceive")}
          trailing={
            <SettingsInfoTip
              title={t("settings.skillRepos.autoReceive")}
              info={t(`settings.skillRepos.modeInfo_${form.autoReceive}`)}
            />
          }
        >
          <SelectField<Mode>
            field={false}
            label={t("settings.skillRepos.autoReceive")}
            value={form.autoReceive}
            selectedDisplay={{ label: t(`settings.skillRepos.mode_${form.autoReceive}`) }}
            options={(["overwrite", "fastforward", "none"] as const).map((value) => ({
              id: value,
              value,
              label: t(`settings.skillRepos.mode_${value}`),
              description: t(`settings.skillRepos.modeInfo_${value}`),
            }))}
            onChange={(autoReceive) => model.set({ autoReceive })}
            placeholder=""
            emptyText=""
            size={size}
          />
        </Field>
        <SettingsCard>
          <SettingsSwitch
            label={t("settings.skillRepos.agentPublish")}
            value={form.agentPublishAllowed}
            onValueChange={(agentPublishAllowed) => model.set({ agentPublishAllowed })}
          />
        </SettingsCard>
        {error ? (
          <Text accessibilityRole="alert" style={settingsStyles.rowError}>
            {error}
          </Text>
        ) : null}
        {snapshot ? (
          <View style={styles.metadataStack}>
            <Text style={styles.metadata}>{t("settings.skillRepos.unsubscribeInfo")}</Text>
            <Button variant="ghost" size="sm" onPress={() => setShowDetails(!showDetails)}>
              {t(showDetails ? "settings.skillRepos.hideDetails" : "settings.skillRepos.details")}
            </Button>
            {showDetails ? <CheckoutDetails actual={snapshot} /> : null}
          </View>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function RepositoryHint({
  subscription,
  actual,
  connected,
  notice,
}: {
  subscription: SkillRepositorySubscription;
  actual: SkillRepositoryState | null;
  connected: boolean;
  notice: string;
}) {
  const { t } = useTranslation();
  const status = actual?.status;
  return (
    <View style={styles.metadataStack}>
      <Text style={styles.metadata}>
        {subscription.remoteUrl} · {subscription.branch}
      </Text>
      <View style={styles.actions}>
        <Text style={styles.metadata}>
          {t(`settings.skillRepos.mode_${subscription.autoReceive}`)}
        </Text>
        <SettingsInfoTip
          title={t("settings.skillRepos.autoReceive")}
          info={t(`settings.skillRepos.modeInfo_${subscription.autoReceive}`)}
        />
        {status?.ahead !== null && status?.ahead !== undefined ? (
          <Text style={styles.metadata}>
            {t("settings.skillRepos.distance", {
              ahead: status.ahead,
              behind: status.behind,
            })}
          </Text>
        ) : null}
      </View>
      {connected && actual && !actual.canRead && !notice ? (
        <Text style={styles.metadata}>{t("settings.skillRepos.executorUnavailable")}</Text>
      ) : null}
      {status?.remoteCheckedAt ? (
        <Text style={styles.metadata}>
          {t("settings.skillRepos.lastChecked")}:{" "}
          {new Date(status.remoteCheckedAt).toLocaleString()}
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={styles.metadata}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}

function RepositoryRow({
  serverId,
  actual,
  subscription,
  local,
  connected,
  ready,
  onConfigure,
  onRefresh,
}: {
  serverId: string;
  actual: SkillRepositoryState | null;
  subscription: SkillRepositorySubscription;
  local: SkillRepositoryLocalState;
  connected: boolean;
  ready: boolean;
  onConfigure(): void;
  onRefresh(): Promise<unknown>;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const pending = local.pending.find(
    (p) => p.serverId === serverId && p.repositoryId === subscription.repositoryId,
  );
  const removing = Boolean(
    pending && !subscriptionFromPlan(local.plan, serverId, subscription.repositoryId),
  );
  const label = repositoryStatusLabel(actual, connected, running, pending);
  const sync = async () => {
    if (!client) return;
    setRunning(true);
    setError("");
    setNotice("");
    try {
      const result = await client.syncSkillRepository(subscription.repositoryId, subscription);
      if (result.error) setError(result.error);
      setNotice(t(`settings.skillRepos.result_${result.state}`));
    } catch (cause) {
      setError(repositoryError(cause));
    } finally {
      setRunning(false);
      await onRefresh();
    }
  };
  const syncLabel =
    subscription.autoReceive === "none" ? "settings.skillRepos.fetch" : "settings.skillRepos.sync";
  return (
    <SettingsCard>
      <SettingsRow
        label={subscription.label}
        labelAccessory={
          <StatusBadge
            label={t(
              removing && !pending?.error
                ? "settings.skillRepos.pendingRemoval"
                : `settings.skillRepos.status_${label}`,
            )}
            variant={["needsResolution", "configConflict"].includes(label) ? "warning" : "muted"}
          />
        }
        hint={
          <RepositoryHint
            subscription={subscription}
            actual={actual}
            connected={connected}
            notice={notice}
          />
        }
        error={repositoryRowError(error, actual, pending)}
      >
        <View style={styles.actions}>
          {!removing ? (
            <Button
              size="sm"
              variant="outline"
              onPress={sync}
              disabled={!ready || !actual || running || actual.busy || Boolean(pending)}
            >
              {t(running ? "settings.skillRepos.syncing" : syncLabel)}
            </Button>
          ) : null}
          {!local.plan.repositories.find((r) => r.repositoryId === subscription.repositoryId)
            ?.deleted ? (
            <Button
              size="sm"
              variant="outline"
              onPress={onConfigure}
              disabled={connected && !ready}
            >
              {t("settings.skillRepos.configure")}
            </Button>
          ) : null}
          {pending?.error ? (
            <>
              {removing && actual ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!ready}
                  onPress={() =>
                    void removeSkillRepositoryMember(
                      serverId,
                      subscription.repositoryId,
                      actual.subscription,
                    ).catch((cause) => setError(repositoryError(cause)))
                  }
                >
                  {t("settings.skillRepos.unsubscribe")}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                onPress={() =>
                  void retrySkillRepositoryChange(serverId, subscription.repositoryId).catch(
                    (cause) => setError(repositoryError(cause)),
                  )
                }
              >
                {t("settings.skillRepos.retry")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() =>
                  void discardSkillRepositoryChange(
                    serverId,
                    subscription.repositoryId,
                    actual?.subscription ?? null,
                  )
                    .then(onRefresh)
                    .catch((cause) => setError(repositoryError(cause)))
                }
                disabled={!ready}
              >
                {t("settings.skillRepos.useHostSettings")}
              </Button>
            </>
          ) : null}
        </View>
      </SettingsRow>
    </SettingsCard>
  );
}

function RepositoryLoadState({
  connected,
  supported,
  loading,
  error,
  onRetry,
}: {
  connected: boolean;
  supported: boolean;
  loading: boolean;
  error: unknown;
  onRetry(): void;
}) {
  const { t } = useTranslation();
  if (!connected)
    return <Text style={styles.metadata}>{t("settings.skillRepos.hostOffline")}</Text>;
  if (!supported) return <Text style={styles.metadata}>{t("settings.skillRepos.updateHost")}</Text>;
  if (error)
    return (
      <SettingsCard>
        <SettingsRow label={t("settings.skillRepos.loadFailed")} error={repositoryError(error)}>
          <Button size="sm" variant="outline" onPress={onRetry}>
            {t("settings.skillRepos.retry")}
          </Button>
        </SettingsRow>
      </SettingsCard>
    );
  if (loading) return <Text style={styles.metadata}>{t("settings.skillRepos.loading")}</Text>;
  return null;
}

export function HostSkillRepositoriesPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "skillRepositoryManagement");
  const plan = useSkillRepositoryPlan();
  const reconciliationError = useSkillRepositoryPlanError(serverId);
  const [editing, setEditing] = useState<string | null>(null);
  const state = useFetchQuery({
    queryKey: ["skill-repository-state", serverId, connected],
    enabled: connected && supported && Boolean(client),
    queryFn: async () => {
      if (!client) throw new Error("Host disconnected");
      const result = await client.getSkillRepositoryState();
      await rememberSkillRepositorySubscriptions(
        serverId,
        result.repositories.map((r) => r.subscription),
      );
      return result.repositories;
    },
    dataShape: "list",
    staleTimeMs: 0,
    refetchInterval: 5_000,
  });
  const actual = state.data ?? [];
  const subscriptions = visibleSubscriptions(serverId, actual, plan.data);
  const current = actual.find((r) => r.subscription.repositoryId === editing) ?? null;
  const canConfigure = Boolean(plan.data) && (!connected || (supported && Boolean(state.data)));
  return (
    <SettingsSection
      title={t("settings.skillRepos.subscriptions")}
      info={t("settings.skillRepos.hostInfo")}
      trailing={
        <Button
          variant="outline"
          size="sm"
          onPress={() => setEditing("new")}
          disabled={!canConfigure}
        >
          {t("settings.skillRepos.subscribe")}
        </Button>
      }
    >
      <RepositoryLoadState
        connected={connected}
        supported={supported}
        loading={plan.isPending || state.isPending}
        error={plan.error ?? state.error ?? reconciliationError}
        onRetry={() => {
          void state.refetch();
          void plan.refetch();
        }}
      />
      {plan.data &&
        [...subscriptions.values()].map((subscription) => (
          <RepositoryRow
            key={subscription.repositoryId}
            serverId={serverId}
            actual={
              actual.find((r) => r.subscription.repositoryId === subscription.repositoryId) ?? null
            }
            subscription={subscription}
            local={plan.data!}
            connected={connected}
            ready={connected && canConfigure}
            onConfigure={() => setEditing(subscription.repositoryId)}
            onRefresh={state.refetch}
          />
        ))}
      {canConfigure && subscriptions.size === 0 ? (
        <SettingsCard>
          <SettingsRow
            label={t("settings.skillRepos.noSubscriptions")}
            hint={t("settings.skillRepos.noSubscriptionsInfo")}
          />
        </SettingsCard>
      ) : null}
      {editing && plan.data ? (
        <SubscriptionSheet
          key={editing}
          serverId={serverId}
          initial={subscriptions.get(editing)}
          actual={current}
          connected={connected}
          local={plan.data}
          onClose={() => {
            setEditing(null);
            void state.refetch();
          }}
        />
      ) : null}
    </SettingsSection>
  );
}
