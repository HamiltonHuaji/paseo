import { describe, expect, it } from "vitest";
import { resolveAssistantForkImplementation, resolveForkPreparation } from "./fork-preparation";

describe("conversation fork preparation", () => {
  it("uses a native fork only when the client, daemon, and source provider all support it", () => {
    const supported = resolveForkPreparation({
      provider: "codex",
      clientSupportsNative: true,
      daemonSupportsNative: true,
      sourceSupportsNative: true,
      daemonSupportsContext: true,
    });
    expect(supported).toEqual({ mode: "native" });

    for (const missing of ["client", "daemon", "source"] as const) {
      expect(
        resolveForkPreparation({
          provider: "codex",
          clientSupportsNative: missing !== "client",
          daemonSupportsNative: missing !== "daemon",
          sourceSupportsNative: missing !== "source",
          daemonSupportsContext: true,
        }),
      ).toEqual({ errorKey: "message.actions.forkNativeUnavailable" });
    }
  });

  it("keeps copied-context forks for providers without a native fork", () => {
    const preparation = resolveForkPreparation({
      provider: "claude",
      clientSupportsNative: true,
      daemonSupportsNative: true,
      sourceSupportsNative: false,
      daemonSupportsContext: true,
    });
    expect(preparation).toEqual({ mode: "context_attachment" });
    expect(
      resolveAssistantForkImplementation({
        preparation,
        selectedTurnIsActive: true,
      }),
    ).toBe("context_attachment");
  });

  it("asks for the active turn to finish only on the native path", () => {
    const preparation = resolveForkPreparation({
      provider: "codex",
      clientSupportsNative: true,
      daemonSupportsNative: true,
      sourceSupportsNative: true,
      daemonSupportsContext: true,
    });
    expect(resolveAssistantForkImplementation({ preparation, selectedTurnIsActive: true })).toBe(
      "native_wait",
    );
    expect(resolveAssistantForkImplementation({ preparation, selectedTurnIsActive: false })).toBe(
      "native",
    );
  });
});
