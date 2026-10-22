export interface ViewerDeepLinkTarget {
  serverId: string;
  path: string;
}

/** The HTTP path alone is also a valid daemon filesystem path. Chat uses an explicit URI. */
export function buildViewerDeepLink({ serverId, path }: ViewerDeepLinkTarget): string {
  return `paseo://h/${encodeURIComponent(serverId)}${path}`;
}

export function parseViewerDeepLink(input: string): ViewerDeepLinkTarget | null {
  if (!/^paseo:/i.test(input)) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (
    url.protocol !== "paseo:" ||
    url.hostname !== "h" ||
    url.username ||
    url.password ||
    url.port
  ) {
    return null;
  }
  const match = /^\/([^/]+)(\/view\/.*)$/.exec(url.pathname);
  if (!match) return null;
  try {
    const serverId = decodeURIComponent(match[1]!);
    return { serverId, path: `${match[2]}${url.search}${url.hash}` };
  } catch {
    return null;
  }
}
