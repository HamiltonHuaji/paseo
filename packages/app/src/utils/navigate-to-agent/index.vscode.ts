import type { NavigateToAgentInput } from "./resolve";
import { postPaseoVscodeMessage } from "@/vscode-embed/bridge";

export type { NavigateToAgentInput } from "./resolve";

export function navigateToAgent(input: NavigateToAgentInput): string {
  postPaseoVscodeMessage({
    type: "openTarget",
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    target: { kind: "agent", agentId: input.agentId },
  });
  return input.agentId;
}
