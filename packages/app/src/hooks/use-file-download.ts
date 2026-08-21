import { useCallback, useMemo } from "react";
import { useHostRuntimeSnapshot, useHosts } from "@/runtime/host-runtime";
import { useDownloadStore } from "@/stores/download-store";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { resolveActiveDirectDownloadConnection } from "@/downloads/route";

interface UseFileDownloadParams {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
}

/**
 * Returns a stable callback that downloads a single workspace file by its
 * workspace-relative path. Shared by the file explorer tree and the git diff
 * pane so both surfaces download through the same host token + download-store
 * pipeline instead of duplicating the plumbing.
 */
export function useFileDownload({
  serverId,
  workspaceId,
  workspaceRoot,
}: UseFileDownloadParams): (input: { fileName: string; path: string }) => void {
  const daemons = useHosts();
  const runtime = useHostRuntimeSnapshot(serverId);
  const daemonProfile = useMemo(
    () => daemons.find((daemon) => daemon.serverId === serverId),
    [daemons, serverId],
  );
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  const workspaceScopeId = useMemo(
    () => workspaceId?.trim() || normalizedWorkspaceRoot,
    [normalizedWorkspaceRoot, workspaceId],
  );
  const { requestFileDownloadToken } = useFileExplorerActions({
    serverId,
    workspaceId,
    workspaceRoot: normalizedWorkspaceRoot,
  });
  const startDownload = useDownloadStore((state) => state.startDownload);
  const directConnection = useMemo(
    () =>
      resolveActiveDirectDownloadConnection({
        host: daemonProfile,
        activeConnectionId: runtime?.activeConnectionId ?? null,
      }),
    [daemonProfile, runtime?.activeConnectionId],
  );

  return useCallback(
    ({ fileName, path }) => {
      if (!workspaceScopeId) {
        return;
      }
      void startDownload({
        serverId,
        scopeId: workspaceScopeId,
        fileName,
        path,
        directConnection,
        readFile: async (targetPath) => {
          if (!runtime?.client) {
            throw new Error("Host is disconnected.");
          }
          return runtime.client.readFile(normalizedWorkspaceRoot, targetPath);
        },
        requestFileDownloadToken: (targetPath) => requestFileDownloadToken(targetPath),
      });
    },
    [
      directConnection,
      normalizedWorkspaceRoot,
      requestFileDownloadToken,
      runtime?.client,
      serverId,
      startDownload,
      workspaceScopeId,
    ],
  );
}
