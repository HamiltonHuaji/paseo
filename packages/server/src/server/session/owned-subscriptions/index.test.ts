import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { SessionDelivery } from "./index.js";

function retainedPromiseBytes(cycles: number): number {
  const fixture = fileURLToPath(new URL("./test-utils/memory-repro.ts", import.meta.url));
  const output = execFileSync(
    process.execPath,
    ["--expose-gc", "--import", "tsx", fixture, String(cycles)],
    {
      encoding: "utf8",
    },
  );
  return Number(output);
}

test("closed deliveries do not increase memory used by unrelated promises", () => {
  const control = retainedPromiseBytes(0);
  const afterChurn = retainedPromiseBytes(40);
  expect(control).toBeGreaterThan(0);
  expect(afterChurn).toBeLessThan(control * 4);
});

test("concurrent requests keep their source through asynchronous work", async () => {
  const delivery = new SessionDelivery(() => {});
  const sources = [{}, {}];
  for (const source of sources) delivery.attach(source, true);

  const requests: Promise<void>[] = [];
  for (const [index, source] of sources.entries()) {
    requests.push(
      delivery.request(source, { type: "ping", requestId: String(index) }, async () => {
        await Promise.resolve();
        expect(delivery.currentSource).toBe(source);
        expect(delivery.forSource(sources[1 - index], () => delivery.currentSource)).toBe(
          sources[1 - index],
        );
        expect(delivery.currentSource).toBe(source);
      }),
    );
  }
  await Promise.all(requests);
  await delivery.close();
});

test("an asynchronous projection keeps its source after close without delaying cleanup", async () => {
  const delivery = new SessionDelivery(() => {});
  const other = new SessionDelivery(() => {});
  const source = {};
  const otherSource = {};
  delivery.attach(source, true);
  other.attach(otherSource, true);
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const projection = delivery.forSource(source, async () => {
    await paused;
    expect(delivery.currentSource).toBe(source);
    expect(other.currentSource).toBeUndefined();
  });

  await delivery.close();
  await other.request(otherSource, { type: "ping", requestId: "other" }, async () => {
    await Promise.resolve();
    expect(other.currentSource).toBe(otherSource);
    expect(delivery.currentSource).toBeUndefined();
  });
  resume();
  await projection;
  await other.close();
});

test("close finishes with a paused request and late work sees cancellation without leaking a reply", async () => {
  const sent: string[] = [];
  const delivery = new SessionDelivery((_source, message) => sent.push(message.type));
  const other = new SessionDelivery((_source, message) => sent.push(`other:${message.type}`));
  const source = {};
  const otherSource = {};
  delivery.attach(source, true);
  other.attach(otherSource, true);
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let stopped = false;
  const request = delivery.request(source, { type: "ping", requestId: "pending" }, async () => {
    delivery.begin("test", undefined, () => {
      stopped = true;
    });
    await paused;
    expect(delivery.currentSource).toBe(source);
    expect(delivery.requestSignal.aborted).toBe(true);
    expect(other.currentSource).toBeUndefined();
    expect(
      delivery.reply({
        type: "pong",
        payload: { requestId: "pending", clientSentAt: 1, serverReceivedAt: 1, serverSentAt: 1 },
      }),
    ).toBe(true);
  });
  const closing = delivery.close();
  let closed = false;
  void closing.then(() => {
    closed = true;
    return undefined;
  });
  const outcome = await Promise.race([
    closing.then(() => "closed"),
    new Promise<string>((resolve) => setImmediate(() => resolve("blocked"))),
  ]);
  resume();
  await request;
  await closing;
  expect(outcome).toBe("closed");
  expect(closed).toBe(true);
  expect(stopped).toBe(true);
  expect(delivery.registrationCount).toBe(0);
  await other.request(otherSource, { type: "ping", requestId: "other" }, async () => {
    await Promise.resolve();
    expect(other.currentSource).toBe(otherSource);
    expect(delivery.currentSource).toBeUndefined();
    expect(
      other.reply({
        type: "pong",
        payload: { requestId: "other", clientSentAt: 1, serverReceivedAt: 1, serverSentAt: 1 },
      }),
    ).toBe(true);
  });
  expect(sent).toEqual(["other:pong"]);
  await other.close();
});

test("a failed in-flight request does not fail delivery teardown", async () => {
  const delivery = new SessionDelivery(() => {});
  const source = {};
  delivery.attach(source, true);
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const request = delivery.request(source, { type: "ping", requestId: "failed" }, async () => {
    await paused;
    throw new Error("request canceled");
  });

  const closing = delivery.close();
  resume();
  await expect(request).rejects.toThrow("request canceled");
  await expect(closing).resolves.toBeUndefined();
});

test("failed teardown still closes the delivery and rejects late work", async () => {
  const delivery = new SessionDelivery(() => {});
  const source = {};
  delivery.attach(source, true);
  await delivery.request(source, { type: "ping", requestId: "subscribe" }, async () => {
    delivery.begin("test", undefined, () => {
      throw new Error("teardown failed");
    });
  });

  await expect(delivery.close()).rejects.toThrow("teardown failed");
  await expect(delivery.close()).rejects.toThrow("teardown failed");
  expect(() => delivery.attach({}, true)).toThrow("Session delivery is closed");
  expect(() => delivery.forSource(source, () => {})).toThrow("Session delivery is closed");
  await expect(
    delivery.request(source, { type: "ping", requestId: "late" }, async () => {}),
  ).rejects.toThrow("Session delivery is closed");
});

test("owned send completion retains source proofs and reports physical failures to awaiting producers", async () => {
  const source = {};
  const failure = new Error("Physical send failed");
  const delivery = new SessionDelivery(
    async (socket, message) => {
      expect(socket).toBe(source);
      expect(delivery.permits(socket, message)).toBe(true);
      throw failure;
    },
    async (socket, frame) => {
      expect(socket).toBe(source);
      expect(delivery.permitsBinary(socket, frame)).toBe(true);
      throw failure;
    },
  );
  delivery.attach(source, true);
  await delivery.request(
    source,
    { type: "hosts.link.open.request", requestId: "open", channelId: "scope" },
    async () => {
      const owner = delivery.begin("host-link", undefined, () => {});
      await expect(
        owner.emitAndWait({
          type: "hosts.route.frame",
          payload: { subscriptionId: owner.id, data: "text", binary: false },
        }),
      ).rejects.toBe(failure);
      await expect(owner.emitBinaryAndWait(new Uint8Array([0, 255]))).rejects.toBe(failure);
      await owner.release();
      await expect(owner.emitBinaryAndWait(new Uint8Array([0]))).rejects.toThrow(
        "Subscription source is closed",
      );
    },
  );
  await delivery.close();
});

test("retained TCP streams reject foreign sources and settle on detach, revocation and delivery failure", async () => {
  const { TunnelController } = await import("../../tunnels/controller.js");
  const { decodeTunnelStreamFrame, TunnelStreamOpcode } =
    await import("@getpaseo/protocol/binary-frames/index");
  const net = await import("node:net");
  const { once } = await import("node:events");
  const sockets = new Set<import("node:net").Socket>();
  let received = "";
  const target = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.on("data", (bytes) => {
      received += bytes.toString();
      socket.write(bytes);
    });
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const address = target.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  try {
    for (const failure of ["detach", "revocation", "delivery"] as const) {
      let permitted = true;
      let denyDelivery = false;
      const controller = new TunnelController(null, undefined, () => permitted);
      const frames: NonNullable<ReturnType<typeof decodeTunnelStreamFrame>>[] = [];
      const source = {};
      const delivery = new SessionDelivery(
        () => {},
        async (actualSource, bytes) => {
          expect(actualSource).toBe(source);
          expect(delivery.permitsBinary(source, bytes)).toBe(true);
          const frame = decodeTunnelStreamFrame(bytes)!;
          if (denyDelivery && frame.opcode === TunnelStreamOpcode.Data)
            throw new Error("Injected delivery denial");
          frames.push(frame);
        },
      );
      delivery.attach(source, true);
      let id = "";
      try {
        await delivery.request(
          source,
          {
            type: "tunnel.open.request",
            requestId: failure,
            target: { type: "tcp", host: "127.0.0.1", port: address.port },
          },
          async () => {
            const owner = delivery.operation(
              () => false,
              () => controller.abort(id),
            );
            id = await controller.open(
              { type: "tcp", host: "127.0.0.1", port: address.port },
              owner,
            );
          },
        );
        controller.handleFrame(
          { tunnelId: id, opcode: TunnelStreamOpcode.Resume, payload: new Uint8Array() },
          source,
        );
        controller.handleFrame(
          {
            tunnelId: id,
            opcode: TunnelStreamOpcode.Data,
            payload: new TextEncoder().encode("foreign"),
          },
          {},
        );
        controller.handleFrame(
          {
            tunnelId: id,
            opcode: TunnelStreamOpcode.Data,
            payload: new TextEncoder().encode(failure),
          },
          source,
        );
        await expect
          .poll(() => frames.some((frame) => frame.opcode === TunnelStreamOpcode.Data))
          .toBe(true);
        expect(received).not.toContain("foreign");
        expect(delivery.registrationCount).toBe(1);
        if (failure === "detach") await delivery.detach(source);
        if (failure === "revocation") {
          permitted = false;
          controller.revoke();
        }
        if (failure === "delivery") {
          denyDelivery = true;
          controller.handleFrame(
            {
              tunnelId: id,
              opcode: TunnelStreamOpcode.Data,
              payload: new TextEncoder().encode("denied"),
            },
            source,
          );
        }
        await expect.poll(() => controller.getState().length).toBe(0);
        await expect.poll(() => sockets.size).toBe(0);
        await expect.poll(() => delivery.registrationCount).toBe(0);
        if (failure === "revocation") expect(frames.at(-1)!.opcode).toBe(TunnelStreamOpcode.Reset);
      } finally {
        controller.dispose();
        await delivery.close();
      }
    }
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => target.close(() => resolve()));
  }
});
