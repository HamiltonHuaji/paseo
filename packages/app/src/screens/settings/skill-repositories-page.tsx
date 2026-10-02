/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop, eslint-plugin-react-perf/jsx-no-new-function-as-prop, eslint-plugin-react-perf/jsx-no-new-object-as-prop -- Settings actions dispatch local form intents. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect } from "@/components/settings";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { useHosts } from "@/runtime/host-runtime";
import { getDesktopHost } from "@/desktop/host";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { useSkillRepositoryPlan } from "@/skill-repositories/hooks";
import { openPlanImportForm, type RepositoryAccess } from "@/skill-repositories/forms";
import {
  exportSkillRepositoryPlan,
  previewSkillRepositoryPlan,
  importSkillRepositoryPlan,
  removeSkillRepository,
  type PlanConflict,
} from "@/skill-repositories/plan";
import {
  RepositoryFormSheet,
  repositoryError,
  skillRepositoryStyles as styles,
} from "./skill-repository-shared";

type RepositoryDraft = NonNullable<Parameters<typeof RepositoryFormSheet>[0]["initial"]>;

function PlanVersion({ record }: { record: PlanConflict["local"] }) {
  const { t } = useTranslation();
  if (record.deleted)
    return <Text style={styles.metadata}>{t("settings.skillRepos.removed")}</Text>;
  if ("remoteUrl" in record)
    return (
      <Text selectable style={styles.metadata}>
        {record.label}
        {"\n"}
        {record.remoteUrl} · {record.branch}
      </Text>
    );
  return (
    <Text style={styles.metadata}>
      {t(`settings.skillRepos.mode_${record.autoReceive}`)} ·{" "}
      {t(
        record.agentPublishAllowed
          ? "settings.skillRepos.publishAllowed"
          : "settings.skillRepos.publishDisabled",
      )}
    </Text>
  );
}

function PlanImportSheet({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const [model] = useState(openPlanImportForm);
  const state = useSyncExternalStore(model.subscribe, model.getState);
  useEffect(() => () => model.close(), [model]);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewSkillRepositoryPlan>
  > | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const act = async () => {
    setPending(true);
    setError("");
    try {
      if (!preview) setPreview(await previewSkillRepositoryPlan(state.raw));
      else {
        await importSkillRepositoryPlan(state.raw, state.choices);
        onClose();
      }
    } catch (cause) {
      setError(repositoryError(cause));
    } finally {
      setPending(false);
    }
  };
  const unknownHosts = [
    ...new Set(
      preview?.plan.members
        .filter((m) => !m.deleted && !hosts.some((h) => h.serverId === m.serverId))
        .map((m) => m.serverId),
    ),
  ];
  const submitLabel = preview ? "settings.skillRepos.importPlan" : "settings.skillRepos.preview";
  return (
    <AdaptiveModalSheet
      visible
      onClose={onClose}
      header={{ title: t("settings.skillRepos.importPlan") }}
    >
      <View style={styles.form}>
        {!preview ? (
          <Field label={t("settings.skillRepos.planJson")}>
            <FormTextInput
              accessibilityLabel={t("settings.skillRepos.planJson")}
              initialValue={state.raw}
              multiline
              numberOfLines={8}
              size={size}
              onChangeText={(raw) => model.set({ raw, choices: {} })}
              autoCapitalize="none"
            />
          </Field>
        ) : (
          <>
            <Text style={styles.metadata}>
              {t("settings.skillRepos.importSummary", {
                repositories: preview.plan.repositories.filter((r) => !r.deleted).length,
                subscriptions: preview.plan.members.filter((m) => !m.deleted).length,
              })}
            </Text>
            {unknownHosts.length ? (
              <Text style={styles.metadata}>
                {t("settings.skillRepos.unknownHosts", { count: unknownHosts.length })}
              </Text>
            ) : null}
            {preview.conflicts.map((conflict) => (
              <SettingsCard key={conflict.key}>
                <SettingsRow
                  label={conflict.label}
                  hint={t("settings.skillRepos.configConflict")}
                />
                <SettingsRow
                  label={t("settings.skillRepos.keepLocal")}
                  hint={<PlanVersion record={conflict.local} />}
                />
                <SettingsRow
                  label={t("settings.skillRepos.useIncoming")}
                  hint={<PlanVersion record={conflict.incoming} />}
                />
                <SettingsSelect
                  label={t("settings.skillRepos.chooseVersion")}
                  value={state.choices[conflict.key] ?? ""}
                  options={[
                    { value: "", label: t("settings.skillRepos.chooseVersion") },
                    { value: "local", label: t("settings.skillRepos.keepLocal") },
                    { value: "incoming", label: t("settings.skillRepos.useIncoming") },
                  ]}
                  onValueChange={(choice) => {
                    if (choice)
                      model.set({ choices: { ...state.choices, [conflict.key]: choice } });
                  }}
                />
              </SettingsCard>
            ))}
            <Text style={styles.metadata}>{t("settings.skillRepos.importInfo")}</Text>
          </>
        )}
        {error ? (
          <Text accessibilityRole="alert" style={settingsStyles.rowError}>
            {error}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {preview ? (
            <Button variant="outline" onPress={() => setPreview(null)} disabled={pending}>
              {t("settings.skillRepos.back")}
            </Button>
          ) : null}
          <Button
            onPress={act}
            disabled={
              pending ||
              !state.raw.trim() ||
              Boolean(preview?.conflicts.some((c) => !state.choices[c.key]))
            }
          >
            {t(pending ? "settings.skillRepos.saving" : submitLabel)}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

export function SkillRepositoriesPage() {
  const { t } = useTranslation();
  const plan = useSkillRepositoryPlan();
  const hosts = useHosts();
  const desktop = Boolean(getDesktopHost()?.skillRepositories);
  const [editing, setEditing] = useState<RepositoryDraft | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const repositories = plan.data?.plan.repositories.filter((r) => !r.deleted) ?? [];
  const unknownCount = new Set(
    plan.data?.plan.members
      .filter((m) => !m.deleted && !hosts.some((h) => h.serverId === m.serverId))
      .map((m) => m.serverId),
  ).size;
  const act = async (run: () => Promise<void>) => {
    setError("");
    setNotice("");
    try {
      await run();
    } catch (cause) {
      setError(repositoryError(cause));
    }
  };
  return (
    <View>
      <SettingsSection
        title={t("settings.skillRepos.clientRepositories")}
        info={t("settings.skillRepos.clientInfo")}
        trailing={
          <Button size="sm" variant="outline" onPress={() => setEditing("new")}>
            {t("settings.skillRepos.addRepository")}
          </Button>
        }
      >
        {plan.isPending ? (
          <Text style={styles.metadata}>{t("settings.skillRepos.loading")}</Text>
        ) : null}
        {plan.isError ? (
          <SettingsCard>
            <SettingsRow
              label={t("settings.skillRepos.loadFailed")}
              error={repositoryError(plan.error)}
            >
              <Button size="sm" variant="outline" onPress={() => void plan.refetch()}>
                {t("settings.skillRepos.retry")}
              </Button>
            </SettingsRow>
          </SettingsCard>
        ) : null}
        {plan.isSuccess && repositories.length > 0 ? (
          <SettingsCard>
            {repositories.map((repository) => {
              const executor = plan.data?.executors.find(
                (e) => e.repositoryId === repository.repositoryId,
              );
              let access: RepositoryAccess = "none";
              if (executor?.read) access = "read";
              if (executor?.publish) access = "publish";
              const members =
                plan.data?.plan.members.filter(
                  (m) => !m.deleted && m.repositoryId === repository.repositoryId,
                ) ?? [];
              return (
                <SettingsRow
                  key={repository.repositoryId}
                  label={repository.label}
                  hint={`${repository.remoteUrl} · ${repository.branch}`}
                >
                  <View style={styles.actions}>
                    {desktop ? (
                      <StatusBadge label={t(`settings.skillRepos.access_${access}`)} />
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      onPress={() => setEditing({ ...repository, access })}
                    >
                      {t("settings.skillRepos.configure")}
                    </Button>
                    {members.length === 0 ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() =>
                          void act(() => removeSkillRepository(repository.repositoryId))
                        }
                      >
                        {t("settings.skillRepos.remove")}
                      </Button>
                    ) : null}
                  </View>
                </SettingsRow>
              );
            })}
          </SettingsCard>
        ) : null}
        {plan.isSuccess && repositories.length === 0 ? (
          <SettingsCard>
            <SettingsRow
              label={t("settings.skillRepos.noRepositories")}
              hint={t("settings.skillRepos.noRepositoriesInfo")}
            />
          </SettingsCard>
        ) : null}
        {!desktop ? (
          <Text style={styles.metadata}>{t("settings.skillRepos.desktopRequired")}</Text>
        ) : null}
      </SettingsSection>
      <SettingsSection
        title={t("settings.skillRepos.syncPlan")}
        info={t("settings.skillRepos.planInfo")}
      >
        <SettingsCard>
          <SettingsRow
            label={t("settings.skillRepos.transferPlan")}
            hint={
              unknownCount
                ? t("settings.skillRepos.unknownHosts", { count: unknownCount })
                : undefined
            }
          >
            <View style={styles.actions}>
              <Button size="sm" variant="outline" onPress={() => setImporting(true)}>
                {t("settings.skillRepos.importPlan")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onPress={() =>
                  void act(async () => {
                    await Clipboard.setStringAsync(await exportSkillRepositoryPlan());
                    setNotice(t("settings.skillRepos.copied"));
                  })
                }
              >
                {t("settings.skillRepos.exportPlan")}
              </Button>
            </View>
          </SettingsRow>
        </SettingsCard>
        {notice ? (
          <Text accessibilityLiveRegion="polite" style={styles.metadata}>
            {notice}
          </Text>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={settingsStyles.rowError}>
            {error}
          </Text>
        ) : null}
      </SettingsSection>
      {editing !== null ? (
        <RepositoryFormSheet
          key={editing === "new" ? "new" : editing.repositoryId}
          initial={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {importing ? <PlanImportSheet onClose={() => setImporting(false)} /> : null}
    </View>
  );
}
