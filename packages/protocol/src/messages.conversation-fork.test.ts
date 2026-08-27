import { describe, expect, test } from "vitest";
import { CreateAgentRequestMessageSchema } from "./messages.js";

const request = {
  type: "create_agent_request" as const,
  config: { provider: "codex", cwd: "/workspace" },
  attachments: [],
  labels: {},
  requestId: "request-1",
};

describe("native conversation fork create request", () => {
  test("preserves a cursor and provider message boundary", () => {
    expect(
      CreateAgentRequestMessageSchema.parse({
        ...request,
        forkFrom: {
          agentId: "source-agent",
          boundaryCursor: { epoch: "timeline-1", seq: 42 },
          boundaryMessageId: "assistant-1",
        },
      }).forkFrom,
    ).toEqual({
      agentId: "source-agent",
      boundaryCursor: { epoch: "timeline-1", seq: 42 },
      boundaryMessageId: "assistant-1",
    });
  });

  test("keeps the field optional for older clients", () => {
    expect(CreateAgentRequestMessageSchema.parse(request).forkFrom).toBeUndefined();
  });
});
