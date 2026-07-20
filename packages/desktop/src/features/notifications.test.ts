import { ipcMain } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerNotificationHandlers } from "./notifications";

interface MockNotificationInstance {
  show: ReturnType<typeof vi.fn>;
}

const mocks = vi.hoisted(() => ({
  notifications: [] as MockNotificationInstance[],
}));

vi.mock("electron", () => {
  class MockNotification implements MockNotificationInstance {
    static isSupported = vi.fn(() => true);
    show = vi.fn();

    constructor() {
      mocks.notifications.push(this);
    }

    on(): void {}
    close(): void {}
  }

  return {
    app: { name: "Paseo" },
    BrowserWindow: {
      fromWebContents: vi.fn(() => null),
      getAllWindows: vi.fn(() => []),
    },
    Notification: MockNotification,
    ipcMain: { handle: vi.fn() },
    nativeImage: {
      createFromPath: vi.fn(() => ({ isEmpty: () => true })),
    },
  };
});

type SendNotificationHandler = (
  event: { sender: unknown },
  input: { title?: unknown; body?: unknown; data?: unknown },
  options?: { delayMs?: unknown },
) => Promise<boolean>;

function getRegisteredSendHandler(): SendNotificationHandler {
  registerNotificationHandlers();
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => {
    return channel === "paseo:notification:send";
  })?.[1];
  if (typeof handler !== "function") {
    throw new Error("notification send handler was not registered");
  }
  return handler as SendNotificationHandler;
}

describe("desktop notification scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(ipcMain.handle).mockReset();
    mocks.notifications.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows immediate notifications synchronously", async () => {
    const handler = getRegisteredSendHandler();

    const sent = await handler({ sender: {} }, { title: "Paseo notification test" });

    expect(sent).toBe(true);
    expect(mocks.notifications).toHaveLength(1);
    expect(mocks.notifications[0]?.show).toHaveBeenCalledOnce();
  });

  it("keeps delayed notification timing in the Electron main process", async () => {
    const handler = getRegisteredSendHandler();

    const scheduled = await handler(
      { sender: {} },
      { title: "Paseo notification test" },
      { delayMs: 10_000 },
    );

    expect(scheduled).toBe(true);
    expect(mocks.notifications).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(mocks.notifications).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.notifications).toHaveLength(1);
    expect(mocks.notifications[0]?.show).toHaveBeenCalledOnce();
  });
});
