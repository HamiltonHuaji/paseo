import type { AssistantForkImplementation } from "@/components/assistant-fork-menu";

export type ForkPreparationMode = "native" | "context_attachment";
export type ForkUnavailableKey =
  | "message.actions.forkNativeUnavailable"
  | "message.actions.forkUnavailable";

export type ForkPreparation =
  | { mode: ForkPreparationMode; errorKey?: never }
  | { errorKey: ForkUnavailableKey };

export function resolveForkPreparation(input: {
  provider: string | undefined;
  sourceSupportsNative: boolean;
  daemonSupportsNative: boolean;
  daemonSupportsContext: boolean;
}): ForkPreparation {
  const requiresNative = input.provider === "codex" || input.sourceSupportsNative;
  if (requiresNative && (!input.daemonSupportsNative || !input.sourceSupportsNative)) {
    return { errorKey: "message.actions.forkNativeUnavailable" };
  }
  if (!requiresNative && !input.daemonSupportsContext) {
    return { errorKey: "message.actions.forkUnavailable" };
  }
  return { mode: requiresNative ? "native" : "context_attachment" };
}

export function getAssistantForkImplementation(
  preparation: ForkPreparation,
): AssistantForkImplementation {
  if (!preparation.errorKey) {
    return preparation.mode;
  }
  return preparation.errorKey === "message.actions.forkNativeUnavailable"
    ? "native_unavailable"
    : "unavailable";
}
