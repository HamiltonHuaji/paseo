import { z } from "zod";
import type { AgentFeature, AgentFeatureToggle } from "../agent-sdk-types.js";

export const CodexServiceTierSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});

export type CodexServiceTier = z.infer<typeof CodexServiceTierSchema>;

export const CODEX_PLAN_MODE_FEATURE: Omit<AgentFeatureToggle, "value"> = {
  type: "toggle",
  id: "plan_mode",
  label: "Plan",
  description: "Switch Codex into planning-only collaboration mode",
  tooltip: "Toggle plan mode",
  icon: "list-todo",
};

export function buildCodexFeatures(input: {
  fastServiceTier: CodexServiceTier | null;
  fastModeEnabled: boolean;
  planModeEnabled: boolean;
  planModeAvailable?: boolean;
}): AgentFeature[] {
  const features: AgentFeature[] = [];

  if (input.fastServiceTier) {
    features.push({
      type: "toggle",
      id: "fast_mode",
      label: input.fastServiceTier.name,
      description: input.fastServiceTier.description,
      tooltip: input.fastServiceTier.description || "Toggle fast mode",
      icon: "zap",
      value: input.fastModeEnabled,
    });
  }

  if (input.planModeAvailable !== false) {
    features.push({
      ...CODEX_PLAN_MODE_FEATURE,
      value: input.planModeEnabled,
    });
  }

  return features;
}
