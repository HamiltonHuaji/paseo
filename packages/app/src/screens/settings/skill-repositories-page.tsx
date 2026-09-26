/* oxlint-disable eslint-plugin-react-perf/jsx-no-new-function-as-prop -- Settings actions close over each repository and daemon ID; this screen does not render during agent streaming. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useHosts } from "@/runtime/host-runtime";
import { getDesktopHost } from "@/desktop/host";
import { settingsStyles } from "@/styles/settings";
import {
  exportSkillRepositoryPlan,
  getSkillRepositoryLocalState,
  importSkillRepositoryPlan,
  removeSkillRepository,
  removeSkillRepositoryMember,
  saveSkillRepository,
  saveSkillRepositoryExecutor,
  saveSkillRepositoryMember,
  subscribeSkillRepositoryPlan,
} from "@/skill-repositories/plan";
import {
  getSkillRepositoryPlanErrors,
  subscribeSkillRepositoryPlanErrors,
} from "@/skill-repositories/status";

type LocalState = Awaited<ReturnType<typeof getSkillRepositoryLocalState>>;
type Member = LocalState["plan"]["members"][number];

const modes = ["overwrite", "fastforward", "none"] as const;
const modeLabel = {
  overwrite: "Overwrite",
  fastforward: "Fast forward",
  none: "Manual",
} as const;

export function SkillRepositoriesPage() {
  const hosts = useHosts();
  const desktop = Boolean(getDesktopHost()?.skillRepositories);
  const [state, setState] = useState<LocalState | null>(null);
  const [label, setLabel] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [planText, setPlanText] = useState("");
  const [notice, setNotice] = useState("");
  const [planErrors, setPlanErrors] = useState(getSkillRepositoryPlanErrors);
  const labelRef = useRef<EditingTextInputHandle>(null);
  const remoteUrlRef = useRef<EditingTextInputHandle>(null);
  const branchRef = useRef<EditingTextInputHandle>(null);
  const planRef = useRef<EditingTextInputHandle>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void (async () => {
        const next = await getSkillRepositoryLocalState();
        if (active) setState(next);
      })();
    };
    refresh();
    const unsubscribe = subscribeSkillRepositoryPlan(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(
    () => subscribeSkillRepositoryPlanErrors(() => setPlanErrors(getSkillRepositoryPlanErrors())),
    [],
  );

  const act = useCallback(async (action: () => Promise<void>) => {
    try {
      setNotice("");
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const create = () =>
    act(async () => {
      const repositoryId = `skr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      await saveSkillRepository({
        repositoryId,
        label: label.trim(),
        remoteUrl: remoteUrl.trim(),
        branch: branch.trim(),
      });
      setLabel("");
      setRemoteUrl("");
      setBranch("main");
      labelRef.current?.reset();
      remoteUrlRef.current?.reset();
      branchRef.current?.replaceText("main");
    });

  const updateMember = (member: Member, changes: Partial<Member>) =>
    act(() =>
      saveSkillRepositoryMember({
        serverId: member.serverId,
        repositoryId: member.repositoryId,
        autoReceive: changes.autoReceive ?? member.autoReceive,
        agentPublishAllowed: changes.agentPublishAllowed ?? member.agentPublishAllowed,
      }),
    );

  const importPlan = () =>
    act(async () => {
      const result = await importSkillRepositoryPlan(planText);
      setNotice(
        result.conflicts.length > 0
          ? `Configuration conflicts: ${result.conflicts.join(", ")}`
          : "Plan imported. Members without a connection on this device remain inactive here.",
      );
    });

  const repositories = state?.plan.repositories.filter((item) => !item.deleted) ?? [];
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Skill repositories</Text>
      <Text style={styles.hint}>
        Each repository contains one skill per first-level directory. Sync updates its checkout;
        agents maintain links in ~/.agents/skills themselves.
      </Text>

      <View style={settingsStyles.card}>
        <View style={styles.cardContent}>
          <Text style={settingsStyles.rowTitle}>Add repository</Text>
          <EditingTextInput
            ref={labelRef}
            onChangeText={setLabel}
            placeholder="Name"
            style={styles.input}
          />
          <EditingTextInput
            ref={remoteUrlRef}
            onChangeText={setRemoteUrl}
            placeholder="GitHub HTTPS or SSH URL"
            autoCapitalize="none"
            style={styles.input}
          />
          <EditingTextInput
            ref={branchRef}
            initialValue="main"
            onChangeText={setBranch}
            placeholder="Branch"
            autoCapitalize="none"
            style={styles.input}
          />
          <Button onPress={create} disabled={!label.trim() || !remoteUrl.trim() || !branch.trim()}>
            Add repository
          </Button>
        </View>
      </View>

      {repositories.map((repository) => {
        const executor = state?.executors.find(
          (item) => item.repositoryId === repository.repositoryId,
        );
        const members =
          state?.plan.members.filter(
            (item) => item.repositoryId === repository.repositoryId && !item.deleted,
          ) ?? [];
        return (
          <View key={repository.repositoryId} style={settingsStyles.card}>
            <View style={styles.cardContent}>
              <Text style={settingsStyles.rowTitle}>{repository.label}</Text>
              <Text style={styles.hint}>
                {repository.remoteUrl} · {repository.branch}
              </Text>
              {desktop ? (
                <View style={styles.row}>
                  <Text style={styles.hint}>This device reads the repository</Text>
                  <Switch
                    value={executor?.read ?? false}
                    onValueChange={(read) =>
                      void act(() =>
                        saveSkillRepositoryExecutor({
                          repositoryId: repository.repositoryId,
                          read,
                          publish: executor?.publish ?? false,
                        }),
                      )
                    }
                  />
                </View>
              ) : null}
              {desktop ? (
                <View style={styles.row}>
                  <Text style={styles.hint}>This device can publish</Text>
                  <Switch
                    value={executor?.publish ?? false}
                    onValueChange={(publish) =>
                      void act(() =>
                        saveSkillRepositoryExecutor({
                          repositoryId: repository.repositoryId,
                          read: (executor?.read ?? false) || publish,
                          publish,
                        }),
                      )
                    }
                  />
                </View>
              ) : null}
              {members.map((member) => {
                const host = hosts.find((item) => item.serverId === member.serverId);
                return (
                  <View key={member.serverId} style={styles.member}>
                    <Text style={settingsStyles.rowTitle}>
                      {host?.label ?? `${member.serverId} (no connection on this device)`}
                    </Text>
                    <View style={styles.rowWrap}>
                      {modes.map((mode) => (
                        <Button
                          key={mode}
                          size="sm"
                          variant={member.autoReceive === mode ? "default" : "outline"}
                          onPress={() => void updateMember(member, { autoReceive: mode })}
                        >
                          {modeLabel[mode]}
                        </Button>
                      ))}
                    </View>
                    <View style={styles.row}>
                      <Text style={styles.hint}>Agent may request publication</Text>
                      <Switch
                        value={member.agentPublishAllowed}
                        onValueChange={(agentPublishAllowed) =>
                          void updateMember(member, { agentPublishAllowed })
                        }
                      />
                    </View>
                    <Button
                      size="sm"
                      variant="outline"
                      onPress={() =>
                        void act(() =>
                          removeSkillRepositoryMember(member.serverId, repository.repositoryId),
                        )
                      }
                    >
                      Unsubscribe daemon
                    </Button>
                  </View>
                );
              })}
              {hosts
                .filter((host) => !members.some((member) => member.serverId === host.serverId))
                .map((host) => (
                  <Button
                    key={host.serverId}
                    size="sm"
                    variant="outline"
                    onPress={() =>
                      void act(() =>
                        saveSkillRepositoryMember({
                          serverId: host.serverId,
                          repositoryId: repository.repositoryId,
                          autoReceive: "fastforward",
                          agentPublishAllowed: false,
                        }),
                      )
                    }
                  >
                    Subscribe {host.label}
                  </Button>
                ))}
              <Button
                size="sm"
                variant="outline"
                onPress={() => void act(() => removeSkillRepository(repository.repositoryId))}
              >
                Remove repository from plan
              </Button>
            </View>
          </View>
        );
      })}

      <View style={settingsStyles.card}>
        <View style={styles.cardContent}>
          <Text style={settingsStyles.rowTitle}>Import or export plan</Text>
          <Text style={styles.hint}>
            The plan excludes Git and daemon credentials and local paths.
          </Text>
          <EditingTextInput
            ref={planRef}
            onChangeText={setPlanText}
            multiline
            placeholder="Paste a plan here"
            style={styles.planInput}
          />
          <View style={styles.rowWrap}>
            <Button
              size="sm"
              variant="outline"
              onPress={() =>
                void act(async () => {
                  const plan = await exportSkillRepositoryPlan();
                  setPlanText(plan);
                  planRef.current?.replaceText(plan);
                  await Clipboard.setStringAsync(plan);
                })
              }
            >
              Export and copy
            </Button>
            <Button size="sm" variant="outline" onPress={() => void importPlan()}>
              Import pasted plan
            </Button>
          </View>
        </View>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {planErrors.map((error) => {
        const host = hosts.find((item) => item.serverId === error.serverId);
        return (
          <Text key={error.serverId} style={styles.notice}>
            {host?.label ?? error.serverId}: {error.message}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.spacing[4] },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.lg, fontWeight: "600" },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  cardContent: { padding: theme.spacing[4], gap: theme.spacing[3] },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
    padding: theme.spacing[3],
  },
  planInput: {
    minHeight: 150,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    color: theme.colors.foreground,
    padding: theme.spacing[3],
  },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
  member: { gap: theme.spacing[3], paddingVertical: theme.spacing[3] },
  notice: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
