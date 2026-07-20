import path from "node:path";
import { existsSync } from "node:fs";
import { app, BrowserWindow, Notification, ipcMain, nativeImage } from "electron";

interface NotificationInput {
  title?: unknown;
  body?: unknown;
  data?: unknown;
}

interface NotificationDeliveryOptions {
  delayMs?: unknown;
}

interface NotificationClickPayload {
  data?: Record<string, unknown>;
}

const activeNotifications = new Set<Notification>();
const MAX_NOTIFICATION_DELAY_MS = 60_000;

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function toNotificationDelayMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Math.floor(value), MAX_NOTIFICATION_DELAY_MS);
}

function getNotificationIcon(): Electron.NativeImage | null {
  const candidates = [
    path.resolve(__dirname, "../assets/icon.png"),
    path.resolve(__dirname, "../assets/64x64.png"),
    path.resolve(__dirname, "../assets/128x128.png"),
  ];

  for (const iconPath of candidates) {
    if (!existsSync(iconPath)) {
      continue;
    }
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon;
    }
  }

  return null;
}

function focusSenderWindow(sender: Electron.WebContents): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(sender) ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (!win || win.isDestroyed()) {
    return null;
  }
  win.show();
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
  return win;
}

/**
 * macOS requires a notification to have been shown at least once before
 * the app appears in System Preferences > Notifications. We fire a
 * silent no-op notification during startup to ensure registration.
 */
export function ensureNotificationCenterRegistration(): void {
  if (process.platform !== "darwin" || !Notification.isSupported()) {
    return;
  }

  const probe = new Notification({ title: app.name, silent: true });
  probe.on("show", () => probe.close());
  setTimeout(() => probe.close(), 2_000);
  probe.show();
}

export function registerNotificationHandlers(): void {
  ipcMain.handle("paseo:notification:isSupported", () => {
    return Notification.isSupported();
  });

  ipcMain.handle(
    "paseo:notification:send",
    async (event, rawInput?: NotificationInput, rawOptions?: NotificationDeliveryOptions) => {
      if (!Notification.isSupported()) {
        return false;
      }

      const title = toTrimmedString(rawInput?.title);
      if (!title) {
        return false;
      }

      const body = toTrimmedString(rawInput?.body) ?? undefined;
      const data = toRecord(rawInput?.data);
      const delayMs = toNotificationDelayMs(rawOptions?.delayMs);

      const showNotification = () => {
        const icon = getNotificationIcon();
        const notification = new Notification({
          title,
          ...(body ? { body } : {}),
          ...(icon ? { icon } : {}),
          silent: true,
        });

        activeNotifications.add(notification);

        notification.on("click", () => {
          const win = focusSenderWindow(event.sender);
          if (win && data && Object.keys(data).length > 0) {
            const payload: NotificationClickPayload = { data };
            win.webContents.send("paseo:event:notification-click", payload);
          }
          activeNotifications.delete(notification);
        });

        notification.on("close", () => {
          activeNotifications.delete(notification);
        });

        notification.show();
      };

      if (delayMs > 0) {
        // Keep scheduling in the main process so leaving Settings or backgrounding the renderer
        // cannot cancel the diagnostic notification.
        setTimeout(showNotification, delayMs);
      } else {
        showNotification();
      }
      return true;
    },
  );
}
