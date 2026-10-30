import { providerNetworkKey } from "@getpaseo/plugin/server/provider-network";
import { launchKey } from "./catalog.js";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { UsageSourceRegistration } from "@getpaseo/plugin/server";
import type { ProviderLaunch } from "@getpaseo/plugin/server/provider";
import {
  hashAccountKey,
  unavailable,
  windowFromUsedPct,
  windowFromReportedDuration,
  toneFromUsedPct,
} from "@getpaseo/plugin/server/usage";

import { MspConnection } from "./connection.js";
import { usageSchema } from "./wire.js";

const inputSchema = z.object({ account: z.string(), route: z.string() }).strict();
type Observation = z.infer<typeof usageSchema>;

function accountKey(env: ProviderLaunch["env"]): string {
  // MSP 1.4.1 has no stable account ID; swapping accounts in one config directory shares a report ID.
  const configHome = env.XDG_CONFIG_HOME ?? path.join(env.HOME ?? homedir(), ".config");
  return hashAccountKey(path.resolve(configHome, "muse"));
}

export class Usage {
  private readonly launches = new Map<string, { account: string; launch: ProviderLaunch }>();
  private readonly sessions = new Map<
    string,
    { account: string; route: string; read: () => Promise<Observation> }
  >();
  remember(launch: ProviderLaunch): { account: string; route: string } {
    const account = accountKey(launch.env);
    const route = launchKey(launch);
    this.launches.set(route, { account, launch });
    return { account, route };
  }
  attach(id: string, launch: ProviderLaunch, read: () => Promise<Observation>): void {
    this.sessions.set(id, { ...this.remember(launch), read });
  }
  detach(id: string): void {
    this.sessions.delete(id);
  }
  private async read(route: string, launch: ProviderLaunch): Promise<Observation> {
    const readers = [...this.sessions.values()].filter((session) => session.route === route);
    if (readers.length > 0) {
      const observations = await Promise.all(readers.map((session) => session.read()));
      const usages = observations.flatMap((observation) =>
        observation.usage ? [observation.usage] : [],
      );
      usages.sort((a, b) => b.observedAtMs - a.observedAtMs);
      return usages.length > 0 ? { usage: usages[0] } : {};
    }
    const host = new MspConnection({ launch });
    try {
      await host.initialize();
      return await host.request("usage/read", {}, usageSchema);
    } finally {
      await host.close();
    }
  }
  registration(): UsageSourceRegistration {
    return {
      id: "muse",
      label: "Muse Code",
      icon: "icon.svg",
      input: inputSchema,
      discover: async (scope) => {
        if (scope.kind === "session" && scope.provider !== "muse") return [];
        return [...this.launches].flatMap(([route, { account, launch }]) => {
          if (
            scope.kind === "session" &&
            (account !== accountKey(scope.env) ||
              providerNetworkKey(launch.env) !== providerNetworkKey(scope.env))
          )
            return [];
          return [{ key: account, label: "Muse Code", input: { account, route } }];
        });
      },
      fetch: async (input) => {
        const { account, route } = inputSchema.parse(input);
        const saved = this.launches.get(route);
        if (!saved || saved.account !== account) throw new Error("Muse login no longer exists");
        try {
          const { usage } = await this.read(route, saved.launch);
          if (!usage) return unavailable({ kind: "no_quota", detail: "No usage quota reported" });
          return {
            status: "available",
            planLabel: usage.tier,
            windows: [
              windowFromReportedDuration({
                durationSeconds: usage.window.windowDurationMins * 60,
                unknown: { id: "window", label: "Current window", shortLabel: "" },
                summary: true,
                utilizationPct: usage.window.usedPercent,
                resetsAt: new Date(usage.window.resetsAtMs).toISOString(),
                tone: toneFromUsedPct(usage.window.usedPercent),
              }),
              windowFromUsedPct({
                id: "weekly",
                label: "Weekly",
                shortLabel: "wk",
                summary: true,
                utilizationPct: usage.weekly.usedPercent,
                resetsAt: new Date(usage.weekly.resetsAtMs).toISOString(),
                tone: toneFromUsedPct(usage.weekly.usedPercent),
              }),
            ],
            details: [
              {
                id: "observed",
                label: "Observed",
                value: new Date(usage.observedAtMs).toISOString(),
              },
            ],
          };
        } catch (error) {
          return {
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };
  }
}
