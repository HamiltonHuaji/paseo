import { type AgentHookConfigFormat, buildAgentHookShellCommand } from "../agent-hook-installer.js";

interface ClaudeCommandHook {
  type?: unknown;
  command?: unknown;
  timeout?: unknown;
}

interface ClaudeHookMatcher {
  matcher?: unknown;
  hooks?: unknown;
}

export interface ClaudeSettings {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

export const claudeSettingsFormat: AgentHookConfigFormat<ClaudeSettings> = {
  empty() {
    return {};
  },
  parse(raw) {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("Claude settings must be a JSON object");
    }
    return parsed;
  },
  stringify(config) {
    return `${JSON.stringify(config, null, 2)}\n`;
  },
  install(config, provider) {
    const install = provider.install;
    const hooks = editableHooks(config.hooks);
    for (const event of provider.events) {
      const userEntries = removePaseoHooks(hooks[event.event], install.hookMarker);
      hooks[event.event] = [
        ...userEntries,
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: buildAgentHookShellCommand(provider, event),
              timeout: 10,
            },
          ],
        },
      ];
    }
    return { ...config, hooks };
  },
  uninstall(config, provider) {
    const install = provider.install;
    const hooks = editableHooks(config.hooks);
    for (const event of provider.events) {
      const entries = removePaseoHooks(hooks[event.event], install.hookMarker);
      if (entries.length > 0) {
        hooks[event.event] = entries;
      } else {
        delete hooks[event.event];
      }
    }
    return { ...config, hooks };
  },
  isInstalled(config, provider) {
    const install = provider.install;
    const hooks = normalizeHooks(config.hooks);
    return provider.events.every((event) =>
      normalizeMatchers(hooks[event.event]).some((entry) =>
        normalizeCommandHooks(entry.hooks).some((hook) =>
          commandContainsMarker(hook, install.hookMarker),
        ),
      ),
    );
  },
};

function normalizeHooks(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function editableHooks(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error("Cannot update unsupported Claude hooks format");
  return { ...value };
}

function normalizeMatchers(value: unknown): ClaudeHookMatcher[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

function normalizeCommandHooks(value: unknown): ClaudeCommandHook[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

function removePaseoHooks(value: unknown, marker: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Cannot update unsupported Claude hook event format");
  const entries: unknown[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
      entries.push(entry);
      continue;
    }
    const hooks = entry.hooks.filter(
      (hook) => !isRecord(hook) || !commandContainsMarker(hook, marker),
    );
    if (hooks.length === entry.hooks.length) entries.push(entry);
    else if (hooks.length > 0) entries.push({ ...entry, hooks });
  }
  return entries;
}

function commandContainsMarker(hook: ClaudeCommandHook, marker: string): boolean {
  return typeof hook.command === "string" && hook.command.includes(marker);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
