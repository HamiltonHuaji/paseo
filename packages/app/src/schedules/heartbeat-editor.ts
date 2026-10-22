import { create } from "zustand";

export const useHeartbeatEditor = create<{ target: { serverId: string; agentId: string } | null }>(
  () => ({ target: null }),
);
export function openAgentHeartbeats(serverId: string, agentId: string) {
  useHeartbeatEditor.setState({ target: { serverId, agentId } });
}
export function closeAgentHeartbeats() {
  useHeartbeatEditor.setState({ target: null });
}
