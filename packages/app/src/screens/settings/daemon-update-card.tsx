import { useCallback, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { DaemonUpdateJob } from "@getpaseo/protocol/daemon-updates";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { getDesktopHost, type DesktopDaemonPackageBridge } from "@/desktop/host";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { throwIfUpdateCancelled, updateDaemonFromSettings } from "./daemon-lifecycle";

function active(job: DaemonUpdateJob | null | undefined): boolean {
  return job?.status === "running" || job?.status === "cancelling";
}

async function uploadPackage(
  client: DaemonClient,
  bridge: DesktopDaemonPackageBridge,
  serverId: string,
  signal: AbortSignal,
): Promise<string> {
  const metadata = await bridge.prepare(serverId);
  throwIfUpdateCancelled(signal);
  let job = await client.getDaemonUpdateStatus();
  throwIfUpdateCancelled(signal);
  if (active(job)) {
    if (
      job?.phase !== "uploading" ||
      job.status !== "running" ||
      job.package?.sha256 !== metadata.sha256
    ) {
      throw new Error("Another update is running. Cancel it before uploading this package.");
    }
  } else {
    job = await client.transferDaemonUpdate({ action: "begin", package: metadata });
  }
  if (!job) throw new Error("The daemon did not create an update task");
  // Cancellation can race the begin response; release the job that was just accepted.
  if (signal.aborted && signal.reason?.name === "AbortError") {
    await client.cancelDaemonUpdate(job.id);
  }
  while (job.receivedBytes < metadata.size) {
    throwIfUpdateCancelled(signal);
    const data = await bridge.read(serverId, job.receivedBytes);
    throwIfUpdateCancelled(signal);
    job = await client.transferDaemonUpdate({
      action: "chunk",
      jobId: job.id,
      offset: job.receivedBytes,
      data,
    });
  }
  throwIfUpdateCancelled(signal);
  return job.id;
}

function useDaemonUpdate(host: HostProfile) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(host.serverId);
  const connected = useHostRuntimeIsConnected(host.serverId);
  const uploadSupported = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.features?.daemonUpdateUpload === true,
  );
  const bridge = getDesktopHost()?.daemonPackage;
  const uploadAbort = useRef<AbortController | null>(null);
  useEffect(
    () => () =>
      uploadAbort.current?.abort(new Error("Update view closed; the upload can be resumed")),
    [],
  );

  const status = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: ["daemonUpdate", host.serverId],
    enabled: connected && Boolean(client),
    refetchInterval: 2000,
    retry: false,
    queryFn: async () => {
      if (!client) throw new Error("Daemon is disconnected");
      return client.getDaemonUpdateStatus();
    },
  });
  const download = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: ["daemonPackage", host.serverId],
    enabled: Boolean(bridge),
    refetchInterval: 1000,
    retry: false,
    queryFn: async () => (bridge ? bridge.status(host.serverId) : null),
  });
  const update = useMutation({
    mutationFn: async (source: "host" | "client") => {
      if (!client) throw new Error("Daemon is disconnected");
      const confirmed = await confirmDialog({
        title: t("settings.host.daemon.update.confirmTitle", { name: host.label }),
        message:
          source === "client"
            ? `${t("settings.host.daemon.update.clientDownloadHint")}\n\n${t("settings.host.daemon.update.confirmMessage")}`
            : t("settings.host.daemon.update.confirmMessage"),
        confirmLabel: t("settings.host.daemon.update.confirm"),
        cancelLabel: t("common.actions.cancel"),
        destructive: false,
      });
      if (!confirmed) return null;
      const abort = new AbortController();
      uploadAbort.current = abort;
      let uploadId: string | undefined;
      if (source === "client") {
        if (!bridge) throw new Error("Client-assisted downloads require the desktop app");
        uploadId = await uploadPackage(client, bridge, host.serverId, abort.signal);
      }
      throwIfUpdateCancelled(abort.signal);
      return updateDaemonFromSettings(host.serverId, {
        signal: abort.signal,
        updateDaemon: () => {
          throwIfUpdateCancelled(abort.signal);
          return client.updateDaemon(undefined, uploadId);
        },
        getStatus: async () => {
          const worker = await client.getDaemonStatus();
          const info = client.getLastServerInfoMessage();
          return {
            ...worker,
            serverId: info?.serverId ?? "",
            version: info?.distribution?.version ?? info?.version ?? null,
          };
        },
      });
    },
    onSettled: () => {
      void status.refetch();
      void download.refetch();
    },
    onSuccess: (result) => {
      if (result && bridge) void bridge.cancel(host.serverId);
    },
  });
  const cancel = useMutation({
    mutationFn: async () => {
      uploadAbort.current?.abort(
        Object.assign(new Error("Update cancelled by the user"), { name: "AbortError" }),
      );
      const operations: Promise<unknown>[] = [];
      if (bridge) operations.push(bridge.cancel(host.serverId));
      if (client && connected)
        operations.push(
          client.getDaemonUpdateStatus().then((job) => {
            if (job && active(job)) return client.cancelDaemonUpdate(job.id);
            return null;
          }),
        );
      await Promise.all(operations);
      if (!connected && active(status.data)) {
        throw new Error(t("settings.host.daemon.update.offlineMessage"));
      }
    },
    onSettled: () => {
      void status.refetch();
      void download.refetch();
    },
  });
  const { mutate: startUpdate } = update;
  const { mutate: cancelUpdate } = cancel;
  const startOnHost = useCallback(() => startUpdate("host"), [startUpdate]);
  const startOnClient = useCallback(() => startUpdate("client"), [startUpdate]);
  const stop = useCallback(() => cancelUpdate(), [cancelUpdate]);
  return {
    status,
    download,
    update,
    cancel,
    connected,
    bridge,
    uploadSupported,
    startOnHost,
    startOnClient,
    stop,
  };
}

type UpdateModel = ReturnType<typeof useDaemonUpdate>;

function updateControls(model: UpdateModel) {
  const job = model.status.data;
  const local = model.download.data;
  const busy = active(job) || local?.status === "downloading" || model.update.isPending;
  const resumable =
    !model.update.isPending &&
    job?.status === "running" &&
    job.phase === "uploading" &&
    local?.status === "ready";
  return {
    busy,
    resumable,
    hostDisabled: !model.connected || busy || model.cancel.isPending,
    clientDisabled: !model.connected || (busy && !resumable) || model.cancel.isPending,
    cancelDisabled: model.cancel.isPending || job?.status === "cancelling",
    showCancel: busy || local?.status === "ready",
  };
}

function UpdateProgress({ model }: { model: UpdateModel }) {
  const { t } = useTranslation();
  const job = model.status.data;
  const local = model.download.data;
  const phase = job?.phase ?? "starting";
  const phaseKeys = {
    starting: "settings.host.daemon.update.phaseStarting",
    downloading: "settings.host.daemon.update.phaseDownloading",
    uploading: "settings.host.daemon.update.phaseUploading",
    verifying: "settings.host.daemon.update.phaseVerifying",
    installing: "settings.host.daemon.update.phaseInstalling",
    complete: "settings.host.daemon.update.phaseComplete",
  } as const;
  const bytes = local?.status === "downloading" ? local.receivedBytes : job?.receivedBytes;
  const total = local?.status === "downloading" ? local.package?.size : job?.package?.size;
  const progress = total && bytes !== undefined ? ` ${Math.floor((bytes / total) * 100)}%` : "";
  let label:
    | (typeof phaseKeys)[keyof typeof phaseKeys]
    | "settings.host.daemon.update.clientDownloading"
    | "settings.host.daemon.update.cancelling" = phaseKeys[phase];
  if (local?.status === "downloading") label = "settings.host.daemon.update.clientDownloading";
  if (job?.status === "cancelling") label = "settings.host.daemon.update.cancelling";

  return (
    <Text>
      {t(label)}
      {progress}
    </Text>
  );
}

function updateErrorMessage(model: UpdateModel, cancelled: boolean): string | null {
  const job = model.status.data;
  const local = model.download.data;
  const updateError =
    cancelled || model.update.error?.name === "AbortError" ? null : model.update.error;
  const error = model.cancel.error ?? updateError ?? model.status.error ?? model.download.error;
  const jobError = job?.status === "failed" ? job.error : null;
  const localError = local?.status === "failed" ? local.error : null;
  return error?.message ?? jobError ?? localError;
}

function UpdateFeedback({ model }: { model: UpdateModel }) {
  const { t } = useTranslation();
  const job = model.status.data;
  const local = model.download.data;
  const cancelled = job?.status === "cancelled" || local?.status === "cancelled";
  const error = updateErrorMessage(model, cancelled);
  const output = job?.output;
  const result = model.update.data;
  return (
    <>
      {output ? <Text selectable>{output.split("\n").slice(-8).join("\n")}</Text> : null}
      {cancelled && !result ? <Text>{t("settings.host.daemon.update.cancelled")}</Text> : null}
      {result ? (
        <Alert
          variant="success"
          title={t("desktop.daemon.lifecycle.workerUpdated", { version: result.workerVersion })}
          description={t("desktop.daemon.lifecycle.supervisorRefresh")}
        />
      ) : null}
      {error ? (
        <Alert
          variant="error"
          title={t("settings.host.daemon.update.requestFailedTitle")}
          description={error}
        />
      ) : null}
    </>
  );
}

export function ManagedDaemonUpdateCard({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const model = useDaemonUpdate(host);
  const controls = updateControls(model);
  return (
    <View style={settingsStyles.card} testID="host-page-update-card">
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.host.daemon.update.title")}</Text>
        <Text style={settingsStyles.rowHint}>{t("settings.host.daemon.update.managedHint")}</Text>
      </View>
      {controls.busy ? <UpdateProgress model={model} /> : null}
      <View style={settingsStyles.row}>
        <Button
          variant="outline"
          size="sm"
          disabled={controls.hostDisabled}
          onPress={model.startOnHost}
          testID="host-page-update-button"
        >
          {t("settings.host.daemon.update.downloadOnHost")}
        </Button>
        {model.bridge && model.uploadSupported ? (
          <Button
            variant="outline"
            size="sm"
            disabled={controls.clientDisabled}
            onPress={model.startOnClient}
          >
            {t(
              controls.resumable
                ? "settings.host.daemon.update.resumeUpload"
                : "settings.host.daemon.update.downloadOnClient",
            )}
          </Button>
        ) : null}
        {controls.showCancel ? (
          <Button
            variant="outline"
            size="sm"
            disabled={controls.cancelDisabled}
            onPress={model.stop}
          >
            {t("common.actions.cancel")}
          </Button>
        ) : null}
      </View>
      <UpdateFeedback model={model} />
    </View>
  );
}
