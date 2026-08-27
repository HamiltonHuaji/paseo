import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export type PaseoVscodeEmbedConnection =
  | {
      kind: "vscode";
      label?: string;
    }
  | {
      kind: "relay";
      relayEndpoint: string;
      useTls: boolean;
      daemonPublicKeyB64: string;
      label?: string;
    }
  | {
      kind: "direct";
      endpoint: string;
      useTls: boolean;
      password?: string;
      label?: string;
    };

export interface PaseoVscodeEmbedConfig {
  serverId: string;
  workspaceId: string;
  target: WorkspaceTabTarget;
  connection: PaseoVscodeEmbedConnection;
}

interface PaseoVscodeApi {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    __PASEO_VSCODE_EMBED__?: PaseoVscodeEmbedConfig;
    __PASEO_VSCODE_API__?: PaseoVscodeApi;
    __PASEO_VSCODE_RESOURCE_ROOT__?: string;
  }
}

export function getPaseoVscodeEmbedConfig(): PaseoVscodeEmbedConfig | null {
  if (typeof window === "undefined") {
    return null;
  }
  const config = window.__PASEO_VSCODE_EMBED__;
  if (!config?.serverId || !config.workspaceId || !config.target || !config.connection) {
    return null;
  }
  return config;
}

export function postPaseoVscodeMessage(message: unknown): void {
  if (typeof window === "undefined") {
    return;
  }
  window.__PASEO_VSCODE_API__?.postMessage(message);
}
