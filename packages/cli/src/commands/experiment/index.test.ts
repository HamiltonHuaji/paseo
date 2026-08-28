import { describe, expect, it } from "vitest";
import { resolveExperimentCallerAgentId } from "./index";

describe("experiment caller context", () => {
  it("propagates a trimmed PASEO_AGENT_ID", () => {
    expect(resolveExperimentCallerAgentId({ PASEO_AGENT_ID: "  agent-1  " })).toBe("agent-1");
  });

  it("allows human CLI use without an agent id", () => {
    expect(resolveExperimentCallerAgentId({})).toBeUndefined();
    expect(resolveExperimentCallerAgentId({ PASEO_AGENT_ID: "   " })).toBeUndefined();
  });
});
