import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { AppReleaseChannel } from "../features/auto-updater.js";

export interface DesktopSettings {
  releaseChannel: AppReleaseChannel;
  notifications: {
    playSound: boolean;
  };
  daemon: {
    manageBuiltInDaemon: boolean;
    keepRunningAfterQuit: boolean;
  };
}

interface DesktopSettingsPatch {
  releaseChannel?: AppReleaseChannel;
  notifications?: Partial<DesktopSettings["notifications"]>;
  daemon?: Partial<DesktopSettings["daemon"]>;
}

export interface DesktopSettingsStore {
  get(): Promise<DesktopSettings>;
  patch(patch: unknown): Promise<DesktopSettings>;
  migrateLegacyRendererSettings(legacySettings: unknown): Promise<DesktopSettings>;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  releaseChannel: "stable",
  notifications: {
    playSound: true,
  },
  daemon: {
    manageBuiltInDaemon: true,
    keepRunningAfterQuit: false,
  },
};

const DESKTOP_SETTINGS_FILENAME = "desktop-settings.json";

const ReleaseChannelSchema = z.enum(["stable", "beta"]);

const NotificationsSchema = z
  .looseObject({
    playSound: z.boolean().catch(DEFAULT_DESKTOP_SETTINGS.notifications.playSound),
  })
  .catch(() => ({ ...DEFAULT_DESKTOP_SETTINGS.notifications }));

const DaemonSchema = z
  .looseObject({
    manageBuiltInDaemon: z.boolean().catch(DEFAULT_DESKTOP_SETTINGS.daemon.manageBuiltInDaemon),
    keepRunningAfterQuit: z.boolean().catch(DEFAULT_DESKTOP_SETTINGS.daemon.keepRunningAfterQuit),
  })
  .catch(() => ({ ...DEFAULT_DESKTOP_SETTINGS.daemon }));

const DesktopSettingsSchema = z
  .looseObject({
    releaseChannel: ReleaseChannelSchema.catch(DEFAULT_DESKTOP_SETTINGS.releaseChannel),
    notifications: NotificationsSchema,
    daemon: DaemonSchema,
  })
  .catch(() => buildDefaultSettings());

const MigrationsSchema = z
  .looseObject({
    legacyRendererSettingsImported: z.boolean().catch(false),
    daemonStopOnQuitDefaultApplied: z.boolean().catch(false),
  })
  .catch(() => ({
    legacyRendererSettingsImported: false,
    daemonStopOnQuitDefaultApplied: false,
  }));

const PersistedDocumentSchema = z.looseObject({
  version: z.literal(1).default(1),
  settings: DesktopSettingsSchema,
  migrations: MigrationsSchema,
});

type StoredDesktopSettings = z.output<typeof DesktopSettingsSchema>;
type PersistedDesktopSettingsDocument = z.output<typeof PersistedDocumentSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceReleaseChannel(value: unknown): AppReleaseChannel | null {
  const result = ReleaseChannelSchema.safeParse(value);
  return result.success ? result.data : null;
}

function coerceBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function buildDefaultSettings(): StoredDesktopSettings {
  return {
    releaseChannel: DEFAULT_DESKTOP_SETTINGS.releaseChannel,
    notifications: { ...DEFAULT_DESKTOP_SETTINGS.notifications },
    daemon: { ...DEFAULT_DESKTOP_SETTINGS.daemon },
  };
}

function buildDefaultDocument(): PersistedDesktopSettingsDocument {
  return {
    version: 1,
    settings: buildDefaultSettings(),
    migrations: {
      legacyRendererSettingsImported: false,
      daemonStopOnQuitDefaultApplied: true,
    },
  };
}

function toDesktopSettings(stored: StoredDesktopSettings): DesktopSettings {
  return {
    releaseChannel: stored.releaseChannel,
    notifications: { playSound: stored.notifications.playSound },
    daemon: {
      manageBuiltInDaemon: stored.daemon.manageBuiltInDaemon,
      keepRunningAfterQuit: stored.daemon.keepRunningAfterQuit,
    },
  };
}

function coerceDesktopSettingsPatch(input: unknown): DesktopSettingsPatch {
  if (!isRecord(input)) {
    return {};
  }

  const patch: DesktopSettingsPatch = {};
  const releaseChannel = coerceReleaseChannel(input.releaseChannel);
  if (releaseChannel) {
    patch.releaseChannel = releaseChannel;
  }

  if (isRecord(input.notifications)) {
    const playSound = coerceBoolean(input.notifications.playSound);
    if (playSound !== null) {
      patch.notifications = { playSound };
    }
  }

  if (isRecord(input.daemon)) {
    const daemonPatch: Partial<DesktopSettings["daemon"]> = {};
    const manageBuiltInDaemon = coerceBoolean(input.daemon.manageBuiltInDaemon);
    if (manageBuiltInDaemon !== null) {
      daemonPatch.manageBuiltInDaemon = manageBuiltInDaemon;
    }
    const keepRunningAfterQuit = coerceBoolean(input.daemon.keepRunningAfterQuit);
    if (keepRunningAfterQuit !== null) {
      daemonPatch.keepRunningAfterQuit = keepRunningAfterQuit;
    }
    if (Object.keys(daemonPatch).length > 0) {
      patch.daemon = daemonPatch;
    }
  }

  return patch;
}

function pickDesktopSettingsFromLegacyRendererSettings(
  legacySettings: unknown,
): DesktopSettingsPatch {
  if (!isRecord(legacySettings)) {
    return {};
  }

  const patch: DesktopSettingsPatch = {};
  const releaseChannel = coerceReleaseChannel(legacySettings.releaseChannel);
  if (releaseChannel) {
    patch.releaseChannel = releaseChannel;
  }

  const manageBuiltInDaemon = coerceBoolean(legacySettings.manageBuiltInDaemon);
  if (manageBuiltInDaemon !== null) {
    patch.daemon = { manageBuiltInDaemon };
  }

  return patch;
}

function mergeDesktopSettings(
  current: StoredDesktopSettings,
  patch: DesktopSettingsPatch,
): StoredDesktopSettings {
  return {
    ...current,
    releaseChannel: patch.releaseChannel ?? current.releaseChannel,
    notifications: { ...current.notifications, ...patch.notifications },
    daemon: { ...current.daemon, ...patch.daemon },
  };
}

function hasLegacyRendererOwnedPatch(patch: DesktopSettingsPatch): boolean {
  return patch.releaseChannel !== undefined || patch.daemon?.manageBuiltInDaemon !== undefined;
}

function coerceDocument(
  document: PersistedDesktopSettingsDocument,
): PersistedDesktopSettingsDocument {
  if (document.migrations.daemonStopOnQuitDefaultApplied) {
    return document;
  }

  return {
    ...document,
    settings: {
      ...document.settings,
      daemon: {
        ...document.settings.daemon,
        keepRunningAfterQuit: DEFAULT_DESKTOP_SETTINGS.daemon.keepRunningAfterQuit,
      },
    },
    migrations: { ...document.migrations, daemonStopOnQuitDefaultApplied: true },
  };
}

function mergeDocumentEdits(raw: unknown, before: unknown, after: unknown): unknown {
  if (Object.is(before, after)) return raw;
  if (!isRecord(raw) || !isRecord(before) || !isRecord(after)) return after;
  const next = { ...raw };
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Object.hasOwn(after, key)) delete next[key];
    else
      Object.defineProperty(next, key, {
        value: mergeDocumentEdits(raw[key], before[key], after[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
  }
  return next;
}

export function createDesktopSettingsStore({
  userDataPath,
}: {
  userDataPath: string;
}): DesktopSettingsStore {
  const filePath = path.join(userDataPath, DESKTOP_SETTINGS_FILENAME);
  let cachedDocument: PersistedDesktopSettingsDocument | null = null;
  let snapshot: { raw: unknown; view: PersistedDesktopSettingsDocument } | null = null;
  let persistQueue: Promise<void> = Promise.resolve();

  async function persistDocument(
    document: PersistedDesktopSettingsDocument,
    explicitPatch?: DesktopSettingsPatch,
  ): Promise<void> {
    const write = async () => {
      let raw = snapshot ? mergeDocumentEdits(snapshot.raw, snapshot.view, document) : document;
      if (explicitPatch && isRecord(raw)) {
        const settings = isRecord(raw.settings) ? raw.settings : {};
        raw = {
          ...raw,
          settings: {
            ...settings,
            ...explicitPatch,
            ...(explicitPatch.notifications && {
              notifications: {
                ...(isRecord(settings.notifications) ? settings.notifications : {}),
                ...explicitPatch.notifications,
              },
            }),
            ...(explicitPatch.daemon && {
              daemon: {
                ...(isRecord(settings.daemon) ? settings.daemon : {}),
                ...explicitPatch.daemon,
              },
            }),
          },
        };
      }
      await mkdir(userDataPath, { recursive: true });
      const tempFilePath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
      await writeFile(tempFilePath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
      await rename(tempFilePath, filePath);
      cachedDocument = document;
      snapshot = { raw, view: document };
    };
    const queued = persistQueue.then(write, write);
    persistQueue = queued.catch(() => undefined);
    await queued;
  }

  async function loadDocument(): Promise<PersistedDesktopSettingsDocument> {
    if (cachedDocument) {
      return cachedDocument;
    }

    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
      const document = buildDefaultDocument();
      await persistDocument(document);
      return document;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new Error(
        "Cannot read desktop-settings.json: invalid JSON; original data was retained",
      );
    }
    if (!isRecord(decoded)) throw new Error("Invalid desktop-settings.json document");
    for (const container of [decoded.settings, decoded.migrations]) {
      if (container !== undefined && !isRecord(container)) {
        throw new Error("Unsupported desktop-settings.json document; original data was retained");
      }
    }
    if (isRecord(decoded.settings)) {
      for (const container of [decoded.settings.notifications, decoded.settings.daemon]) {
        if (container !== undefined && !isRecord(container)) {
          throw new Error("Unsupported desktop-settings.json settings; original data was retained");
        }
      }
    }
    const parsed = PersistedDocumentSchema.safeParse(decoded);
    if (!parsed.success) {
      throw new Error("Unsupported desktop-settings.json version; original data was retained");
    }
    const document = coerceDocument(parsed.data);
    snapshot = { raw: decoded, view: parsed.data };
    cachedDocument = document;
    return document;
  }

  return {
    async get(): Promise<DesktopSettings> {
      const document = await loadDocument();
      return toDesktopSettings(document.settings);
    },

    async patch(patch: unknown): Promise<DesktopSettings> {
      const current = await loadDocument();
      const coercedPatch = coerceDesktopSettingsPatch(patch);
      const next = mergeDesktopSettings(current.settings, coercedPatch);
      await persistDocument(
        {
          ...current,
          settings: next,
          migrations: {
            ...current.migrations,
            legacyRendererSettingsImported:
              current.migrations.legacyRendererSettingsImported ||
              hasLegacyRendererOwnedPatch(coercedPatch),
          },
        },
        coercedPatch,
      );
      return toDesktopSettings(next);
    },

    async migrateLegacyRendererSettings(legacySettings: unknown): Promise<DesktopSettings> {
      const current = await loadDocument();
      if (current.migrations.legacyRendererSettingsImported) {
        return toDesktopSettings(current.settings);
      }

      const patch = pickDesktopSettingsFromLegacyRendererSettings(legacySettings);
      const next = mergeDesktopSettings(current.settings, patch);
      await persistDocument(
        {
          ...current,
          settings: next,
          migrations: {
            ...current.migrations,
            legacyRendererSettingsImported: true,
          },
        },
        patch,
      );
      return toDesktopSettings(next);
    },
  };
}
