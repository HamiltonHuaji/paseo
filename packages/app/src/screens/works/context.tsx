import { createContext, useContext } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
export interface WorksContextValue {
  serverId: string;
  projectId: string;
  active: boolean;
  connected: boolean;
  client: DaemonClient | null;
  readData: (path: string, signal: AbortSignal) => Promise<unknown>;
  openViewer: (path: string) => Promise<void>;
}
export const WorksContext = createContext<WorksContextValue | null>(null);
export const WorkActivityContext = createContext(new Map<string, { cardId: string; at: string }>());
export function useWorks() {
  const value = useContext(WorksContext);
  if (!value) throw new Error("Works context missing");
  return value;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function dataPath(projectId: string, objectId: string, source: string): string {
  return `/view/v2/${encodeURIComponent(projectId)}/${encodeURIComponent(objectId)}/data/${encodeURIComponent(source)}`;
}
