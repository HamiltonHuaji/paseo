import { describe, expect, it } from "vitest";

import { renderError, toCommandError } from "./render.js";

class RpcError extends Error {
  readonly code = "agent_refresh_failed";
  readonly requestId = "request-1";
  readonly requestType = "refresh_agent_request";
}

describe("CLI error rendering", () => {
  it("preserves Error messages and metadata in JSON output", () => {
    const commandError = toCommandError(new RpcError("Provider history refresh failed"));

    expect(commandError).toEqual({
      code: "agent_refresh_failed",
      message: "Provider history refresh failed",
      details: {
        requestId: "request-1",
        requestType: "refresh_agent_request",
      },
    });
    expect(JSON.parse(renderError(commandError, { format: "json" }))).toEqual({
      error: commandError,
    });
  });
});
