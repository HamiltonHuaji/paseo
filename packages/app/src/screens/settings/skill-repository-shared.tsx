/* oxlint-disable eslint-plugin-react-perf/jsx-no-jsx-as-prop, eslint-plugin-react-perf/jsx-no-new-object-as-prop, eslint-plugin-react-perf/jsx-no-new-function-as-prop -- Settings forms render their model snapshots and dispatch local intents. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField } from "@/components/ui/select-field";
import { Button } from "@/components/ui/button";
import { SettingsInfoTip } from "@/components/settings/headings/settings-info-tip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getDesktopHost } from "@/desktop/host";
import { openRepositoryForm, type RepositoryAccess } from "@/skill-repositories/forms";
import {
  getSkillRepositoryLocalState,
  saveSkillRepository,
  saveSkillRepositoryExecutor,
} from "@/skill-repositories/plan";
import { settingsStyles } from "@/styles/settings";

export const skillRepositoryStyles = StyleSheet.create((theme) => ({
  stack: { gap: theme.spacing[4] },
  metadataStack: { gap: theme.spacing[1] },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.spacing[2] },
  form: { gap: theme.spacing[4] },
  metadata: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  code: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
  },
}));
export const repositoryError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function RepositoryFormSheet({
  initial,
  onClose,
}: {
  initial?: Parameters<typeof openRepositoryForm>[0];
  onClose(): void;
}) {
  const { t } = useTranslation();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  const [model] = useState(() => openRepositoryForm(initial));
  const state = useSyncExternalStore(model.subscribe, model.getState);
  useEffect(() => () => model.close(), [model]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const desktop = Boolean(getDesktopHost()?.skillRepositories);
  const save = async () => {
    setPending(true);
    setError("");
    try {
      const local = await getSkillRepositoryLocalState();
      const duplicate = local.plan.repositories.find(
        (r) =>
          !r.deleted && r.remoteUrl === state.remoteUrl.trim() && r.branch === state.branch.trim(),
      );
      if (!initial && duplicate)
        throw new Error(t("settings.skillRepos.alreadyConfigured", { name: duplicate.label }));
      const repositoryId = initial?.repositoryId ?? state.repositoryId;
      await saveSkillRepository({
        repositoryId,
        label: state.label.trim(),
        remoteUrl: state.remoteUrl.trim(),
        branch: state.branch.trim(),
      });
      if (desktop)
        await saveSkillRepositoryExecutor({
          repositoryId,
          read: state.access !== "none",
          publish: state.access === "publish",
        });
      onClose();
    } catch (cause) {
      setError(repositoryError(cause));
    } finally {
      setPending(false);
    }
  };
  return (
    <AdaptiveModalSheet
      visible
      onClose={onClose}
      header={{
        title: t(
          initial ? "settings.skillRepos.editRepository" : "settings.skillRepos.addRepository",
        ),
      }}
    >
      <View style={skillRepositoryStyles.form}>
        <Field label={t("settings.skillRepos.name")}>
          <FormTextInput
            accessibilityLabel={t("settings.skillRepos.name")}
            initialValue={state.label}
            onChangeText={(label) => model.set({ label })}
            size={size}
            autoFocus
          />
        </Field>
        <Field label={t("settings.skillRepos.remote")}>
          {initial ? (
            <Text selectable style={skillRepositoryStyles.code}>
              {state.remoteUrl}
            </Text>
          ) : (
            <FormTextInput
              accessibilityLabel={t("settings.skillRepos.remote")}
              initialValue={state.remoteUrl}
              onChangeText={(remoteUrl) => model.set({ remoteUrl })}
              size={size}
              autoCapitalize="none"
              placeholder="git@github.com:owner/skills.git"
            />
          )}
        </Field>
        <Field label={t("settings.skillRepos.branch")}>
          {initial ? (
            <Text selectable style={skillRepositoryStyles.code}>
              {state.branch}
            </Text>
          ) : (
            <FormTextInput
              accessibilityLabel={t("settings.skillRepos.branch")}
              initialValue={state.branch}
              onChangeText={(branch) => model.set({ branch })}
              size={size}
              autoCapitalize="none"
            />
          )}
        </Field>
        {desktop ? (
          <Field
            label={t("settings.skillRepos.access")}
            trailing={
              <SettingsInfoTip
                title={t("settings.skillRepos.access")}
                info={t("settings.skillRepos.accessInfo")}
              />
            }
          >
            <SelectField<RepositoryAccess>
              field={false}
              label={t("settings.skillRepos.access")}
              value={state.access}
              selectedDisplay={{ label: t(`settings.skillRepos.access_${state.access}`) }}
              options={(["none", "read", "publish"] as const).map((value) => ({
                id: value,
                value,
                label: t(`settings.skillRepos.access_${value}`),
              }))}
              onChange={(access) => model.set({ access })}
              placeholder=""
              emptyText=""
              size={size}
            />{" "}
          </Field>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" style={settingsStyles.rowError}>
            {error}
          </Text>
        ) : null}
        <Button
          onPress={save}
          disabled={
            pending || !state.label.trim() || !state.remoteUrl.trim() || !state.branch.trim()
          }
        >
          {t(pending ? "settings.skillRepos.saving" : "settings.skillRepos.save")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}
