export interface WorkspaceUriRoot {
  path: string;
  segmentCount: number;
}

export function workspaceDirectoryToUriRoot(workspaceDirectory: string): WorkspaceUriRoot {
  const normalized = workspaceDirectory.trim().replaceAll("\\", "/");
  if (!normalized) {
    throw new Error("Paseo workspace has no directory path.");
  }
  const pathWithRoot = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const path = pathWithRoot.replace(/\/+$/, "") || "/";
  return {
    path,
    segmentCount: splitUriPath(path).length,
  };
}

export function relativePathFromUriPath(uriPath: string, rootSegments: string): string {
  const segments = splitUriPath(uriPath);
  if (!/^\d+$/.test(rootSegments)) {
    throw new Error(`Invalid Paseo workspace URI root segment count: ${rootSegments}`);
  }
  const rootSegmentCount = Number(rootSegments);
  if (!Number.isSafeInteger(rootSegmentCount) || rootSegmentCount > segments.length) {
    throw new Error(`Invalid Paseo workspace URI root segment count: ${rootSegments}`);
  }
  return segments.slice(rootSegmentCount).join("/");
}

function splitUriPath(uriPath: string): string[] {
  return uriPath.split("/").filter(Boolean);
}
