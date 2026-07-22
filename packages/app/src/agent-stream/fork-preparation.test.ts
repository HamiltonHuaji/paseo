import { describe, expect, it } from "vitest";
import { getAssistantForkImplementation, resolveForkPreparation } from "./fork-preparation";

describe("fork preparation", () => {
  it("reports a native fork only when both sides advertise it", () => {
    const preparation = resolveForkPreparation({
      provider: "codex",
      sourceSupportsNative: true,
      daemonSupportsNative: true,
      daemonSupportsContext: true,
    });

    expect(preparation).toEqual({ mode: "native" });
    expect(getAssistantForkImplementation(preparation)).toBe("native");
  });

  it.each([
    { sourceSupportsNative: false, daemonSupportsNative: true },
    { sourceSupportsNative: true, daemonSupportsNative: false },
  ])("reports an unavailable native fork when either capability is missing", (capabilities) => {
    const preparation = resolveForkPreparation({
      provider: "codex",
      ...capabilities,
      daemonSupportsContext: true,
    });

    expect(preparation).toEqual({ errorKey: "message.actions.forkNativeUnavailable" });
    expect(getAssistantForkImplementation(preparation)).toBe("native_unavailable");
  });

  it("reports the copied-history path for providers without a native fork", () => {
    const preparation = resolveForkPreparation({
      provider: "claude",
      sourceSupportsNative: false,
      daemonSupportsNative: true,
      daemonSupportsContext: true,
    });

    expect(preparation).toEqual({ mode: "context_attachment" });
    expect(getAssistantForkImplementation(preparation)).toBe("context_attachment");
  });
});
