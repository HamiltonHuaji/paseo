import { describe, expect, it } from "vitest";
import { buildViewerDeepLink, parseViewerDeepLink } from "./viewer-deep-link.js";

describe("viewer deep links", () => {
  it.each([
    "/view/v2/remote%3Agithub.com%2FOrg%2FRepo/card_ab12/files/report/a%20b.html?run=a%2Fb#L12",
    "/view/prj_123/exp_123/attempt_123/report/index.html",
  ])("preserves the Host and HTTP resource: %s", (path) => {
    const target = { serverId: "Host/REMOTE", path };
    const href = buildViewerDeepLink(target);
    expect(href).toBe(`paseo://h/Host%2FREMOTE${path}`);
    expect(parseViewerDeepLink(href)).toEqual(target);
  });

  it.each([
    "/view/v2/prj_123/card_ab12/files/report.html",
    "file:///view/v2/prj_123/card_ab12/files/report.html",
    "https://example.com/view/report.html",
    "paseo://h/host/agent/agent_123",
    "paseo://h/host/viewing/report.html",
    "paseo://h/host%ZZ/view/report.html",
    "paseo://user@h/host/view/report.html",
  ])("does not interpret a file or unrelated URL as a viewer: %s", (href) => {
    expect(parseViewerDeepLink(href)).toBeNull();
  });
});
