export type ForkPreparationMode = "native" | "context_attachment";

export type ForkPreparation =
  | { mode: ForkPreparationMode; errorKey?: never }
  | {
      mode?: never;
      errorKey: "message.actions.forkNativeUnavailable" | "message.actions.forkUnavailable";
    };

export function resolveForkPreparation(input: {
  provider: string | undefined;
  sourceSupportsNative: boolean;
  daemonSupportsNative: boolean;
  daemonSupportsContext: boolean;
}): ForkPreparation {
  // Codex summaries from persisted/older projections may omit the optional source flag.
  // The host advertises the native RPC; it validates the live provider again when executing.
  const requiresNative = input.provider === "codex" || input.sourceSupportsNative;
  if (requiresNative && !input.daemonSupportsNative) {
    return { errorKey: "message.actions.forkNativeUnavailable" };
  }
  if (!requiresNative && !input.daemonSupportsContext) {
    return { errorKey: "message.actions.forkUnavailable" };
  }
  return { mode: requiresNative ? "native" : "context_attachment" };
}

export type AssistantForkImplementation =
  | "native"
  | "context_attachment"
  | "native_wait"
  | "native_unavailable"
  | "unavailable";

export function resolveAssistantForkImplementation(input: {
  preparation: ForkPreparation;
  selectedTurnIsActive: boolean;
}): AssistantForkImplementation {
  if (input.preparation.errorKey === "message.actions.forkNativeUnavailable") {
    return "native_unavailable";
  }
  if (input.preparation.errorKey) {
    return "unavailable";
  }
  if (input.preparation.mode === "native" && input.selectedTurnIsActive) {
    return "native_wait";
  }
  return input.preparation.mode;
}
