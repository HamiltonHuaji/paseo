import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const listeners = new Map<string, (event: { disabled: boolean; serviceId: string }) => void>();
  let serviceId: string | null = "current";
  const close = vi.fn<() => Promise<void>>(async () => undefined);
  const upstream = { close, updateRoute: vi.fn(async () => undefined), getState: () => ({}) };
  return {
    listeners,
    upstream,
    setServiceId: (value: string | null) => {
      serviceId = value;
    },
    native: {
      addListener: (
        name: string,
        listener: (event: { disabled: boolean; serviceId: string }) => void,
      ) => listeners.set(name, listener),
      getServiceId: vi.fn(async () => serviceId),
      ensureListener: vi.fn(async () => 17779),
      removeListener: vi.fn(async () => undefined),
      getState: async () => [],
    },
  };
});
vi.mock("expo-modules-core", () => ({ requireNativeModule: () => fixture.native }));
vi.mock("@getpaseo/client/internal/viewer-http-upstream", () => ({
  createViewerHttpUpstream: () => fixture.upstream,
}));
vi.mock("./client", () => ({ createViewerClient: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fixture.listeners.clear();
  fixture.setServiceId("current");
});

const input = {
  serverId: "host",
  connection: { type: "directTcp" as const, endpoint: "127.0.0.1:6768" },
};

it("ignores a delayed old-service Stop without disabling or closing the replacement", async () => {
  const proxy = await import("./proxy.android");
  await proxy.ensureViewerProxy(input);
  fixture.listeners.get("onStopped")!({ disabled: true, serviceId: "old" });
  // Route mutations are the public barrier for processing the queued stop.
  await proxy.updateViewerProxyRoute({ ...input, routeGeneration: 2 });
  expect(fixture.upstream.close).not.toHaveBeenCalled();
  expect(fixture.upstream.updateRoute).toHaveBeenCalledTimes(2);
});

it("waits for current-service cleanup before creating a replacement listener", async () => {
  const proxy = await import("./proxy.android");
  await proxy.ensureViewerProxy(input);
  const oldTask = proxy.runViewerProxyTask("current");
  await Promise.resolve();
  fixture.setServiceId(null);
  let release!: () => void;
  fixture.upstream.close.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  fixture.listeners.get("onStopped")!({ disabled: true, serviceId: "current" });
  const replacement = proxy.ensureViewerProxy({ ...input, routeGeneration: 2 });
  await vi.waitFor(() => expect(fixture.upstream.close).toHaveBeenCalledOnce());
  expect(fixture.native.ensureListener).toHaveBeenCalledTimes(1);
  fixture.setServiceId("replacement");
  release();
  await oldTask;
  await replacement;
  expect(fixture.native.ensureListener).toHaveBeenCalledTimes(2);
  await proxy.updateViewerProxyRoute({ ...input, routeGeneration: 3 });
  expect(fixture.upstream.updateRoute).toHaveBeenCalledTimes(3);
});
