import * as vscode from "vscode";
import { relativePathFromUriPath, workspaceDirectoryToUriRoot } from "./uri-path";
import { createPaseoWorkspaceQuery, parsePaseoWorkspaceQuery } from "./uri-query";

export const PASEO_FILE_SYSTEM_SCHEME = "paseo-fs";
const PASEO_FILE_SYSTEM_AUTHORITY = "host";

export interface PaseoWorkspaceUriParts {
  serverId: string;
  workspaceId: string;
  relativePath: string;
}

export type PaseoWorkspaceIdentity = Omit<PaseoWorkspaceUriParts, "relativePath">;

export function createPaseoWorkspaceUri(
  serverId: string,
  workspaceId: string,
  workspaceDirectory: string,
): vscode.Uri {
  const root = workspaceDirectoryToUriRoot(workspaceDirectory);
  return vscode.Uri.from({
    scheme: PASEO_FILE_SYSTEM_SCHEME,
    authority: PASEO_FILE_SYSTEM_AUTHORITY,
    path: root.path,
    query: createPaseoWorkspaceQuery({
      serverId,
      workspaceId,
      rootSegments: root.segmentCount,
    }),
  });
}

export function parsePaseoWorkspaceUri(uri: vscode.Uri): PaseoWorkspaceUriParts {
  const identity = parsePaseoWorkspaceIdentity(uri);
  const { rootSegments } = parsePaseoWorkspaceQuery(uri.query);
  if (rootSegments === null) {
    throw new Error(
      "This Paseo workspace URI uses an obsolete synthetic path. Run Paseo: Open Workspace to reopen it.",
    );
  }
  const relativePath = relativePathFromUriPath(uri.path, rootSegments);
  const relativeSegments = relativePath.split("/").filter(Boolean);
  if (relativeSegments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Paseo workspace paths cannot escape their workspace root.");
  }
  return {
    ...identity,
    relativePath,
  };
}

export function parsePaseoWorkspaceIdentity(uri: vscode.Uri): PaseoWorkspaceIdentity {
  if (uri.scheme !== PASEO_FILE_SYSTEM_SCHEME) {
    throw new Error(`Unsupported file system scheme: ${uri.scheme}`);
  }
  if (uri.authority !== PASEO_FILE_SYSTEM_AUTHORITY) {
    throw new Error(`Invalid Paseo workspace URI: ${uri.toString()}`);
  }
  const { serverId, workspaceId } = parsePaseoWorkspaceQuery(uri.query);
  return {
    serverId,
    workspaceId,
  };
}

export function isCurrentPaseoWorkspaceUri(uri: vscode.Uri): boolean {
  try {
    return (
      uri.authority === PASEO_FILE_SYSTEM_AUTHORITY &&
      parsePaseoWorkspaceQuery(uri.query).rootSegments !== null
    );
  } catch {
    return false;
  }
}

export function getOpenPaseoWorkspaceUri(): vscode.Uri | null {
  return (
    vscode.workspace.workspaceFolders?.find(
      (folder) => folder.uri.scheme === PASEO_FILE_SYSTEM_SCHEME,
    )?.uri ?? null
  );
}
