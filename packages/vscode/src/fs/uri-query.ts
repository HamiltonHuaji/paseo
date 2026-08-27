export interface PaseoWorkspaceQuery {
  serverId: string;
  workspaceId: string;
  rootSegments: string | null;
}

export function createPaseoWorkspaceQuery(input: {
  serverId: string;
  workspaceId: string;
  rootSegments: number;
}): string {
  return new URLSearchParams({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    rootSegments: String(input.rootSegments),
  }).toString();
}

export function parsePaseoWorkspaceQuery(query: string): PaseoWorkspaceQuery {
  const parameters = new URLSearchParams(query);
  const serverId = parameters.get("serverId");
  const workspaceId = parameters.get("workspaceId");
  if (!serverId || !workspaceId) {
    throw new Error("Paseo workspace URI is missing its exact host or workspace identity.");
  }
  return {
    serverId,
    workspaceId,
    rootSegments: parameters.get("rootSegments"),
  };
}
