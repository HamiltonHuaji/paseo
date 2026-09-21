import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  buildWorkspacePaneContentModel,
  WorkspacePaneContent,
} from "@/screens/workspace/workspace-pane-content";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { getHostRuntimeStore, useHostRegistryLoaded } from "@/runtime/host-runtime";
import { isWeb } from "@/constants/platform";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { getPaseoVscodeEmbedConfig, postPaseoVscodeMessage } from "@/vscode-embed/bridge";

type BootstrapState = "waiting" | "ready" | { error: string };

export default function EmbeddedAgentRoute() {
  const config = useMemo(() => getPaseoVscodeEmbedConfig(), []);
  const hostRegistryLoaded = useHostRegistryLoaded();
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>("waiting");
  const [tabState, setTabState] = useState<WorkspaceTabDescriptor["state"]>();
  const [isVisible, setIsVisible] = useState(!isWeb || document.visibilityState !== "hidden");

  useEffect(() => {
    if (!isWeb) {
      return;
    }
    const onVisibilityChange = () => setIsVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!hostRegistryLoaded || !config || bootstrapState !== "waiting") {
      return;
    }
    const store = getHostRuntimeStore();
    let operation: Promise<unknown>;
    if (config.connection.kind === "vscode") {
      operation = store.upsertDirectConnection({
        serverId: config.serverId,
        endpoint: "vscode-transport.invalid:1",
        useTls: false,
        label: config.connection.label,
      });
    } else if (config.connection.kind === "relay") {
      operation = store.upsertRelayConnection({
        serverId: config.serverId,
        relayEndpoint: config.connection.relayEndpoint,
        useTls: config.connection.useTls,
        daemonPublicKeyB64: config.connection.daemonPublicKeyB64,
        label: config.connection.label,
      });
    } else {
      operation = store.upsertDirectConnection({
        serverId: config.serverId,
        endpoint: config.connection.endpoint,
        useTls: config.connection.useTls,
        password: config.connection.password,
        label: config.connection.label,
      });
    }
    void operation
      .then(() => setBootstrapState("ready"))
      .catch((error) =>
        setBootstrapState({ error: error instanceof Error ? error.message : String(error) }),
      );
  }, [bootstrapState, config, hostRegistryLoaded]);

  const content = useMemo(() => {
    if (!config) {
      return null;
    }
    const tab = buildEmbeddedTabDescriptor(config.target, tabState);
    return buildWorkspacePaneContentModel({
      tab,
      normalizedServerId: config.serverId,
      normalizedWorkspaceId: config.workspaceId,
      host: "main",
      onOpenTab: (target) => postPaseoVscodeMessage({ type: "openTarget", target }),
      onOpenPreferredTarget: (target) => postPaseoVscodeMessage({ type: "openTarget", target }),
      onCloseCurrentTab: () => postPaseoVscodeMessage({ type: "closeEditor" }),
      onRetargetCurrentTab: (target) => postPaseoVscodeMessage({ type: "retargetEditor", target }),
      onSetCurrentTabState: setTabState,
      onOpenWorkspaceFile: (request) => openWorkspaceFile(request),
      onOpenImportSheet: () => postPaseoVscodeMessage({ type: "openImport" }),
    });
  }, [config, tabState]);

  if (!config) {
    return <EmbeddedError message="This route must be opened by the Paseo VS Code extension." />;
  }
  if (typeof bootstrapState === "object") {
    return <EmbeddedError message={bootstrapState.error} />;
  }
  if (bootstrapState !== "ready" || !content) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Connecting to Paseo host…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WorkspacePaneContent
        content={content}
        isWorkspaceFocused={isVisible}
        isPaneFocused={isVisible}
      />
    </View>
  );
}

function buildEmbeddedTabDescriptor(
  target: WorkspaceTabTarget,
  state: WorkspaceTabDescriptor["state"],
): WorkspaceTabDescriptor {
  let targetId: string;
  if (target.kind === "agent") {
    targetId = target.agentId;
  } else if (target.kind === "provider_subagent") {
    targetId = `${target.parentAgentId}:${target.subagentId}`;
  } else {
    targetId = JSON.stringify(target);
  }
  const tabId = `vscode_${target.kind}_${targetId}`;
  return { key: tabId, tabId, kind: target.kind, target, state };
}

function openWorkspaceFile(request: WorkspaceFileOpenRequest): void {
  postPaseoVscodeMessage({ type: "openFile", request });
}

function EmbeddedError({ message }: { message: string }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.error}>Unable to open Paseo session</Text>
      <Text style={styles.muted}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: theme.colors.surface0,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
    backgroundColor: theme.colors.surface0,
  },
  error: {
    color: theme.colors.statusDanger,
    fontWeight: "600",
  },
  muted: {
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));
