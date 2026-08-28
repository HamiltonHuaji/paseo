import http from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { createLocalTunnelForwarder } from "@getpaseo/client/node/local-tunnel-forwarder";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";

describe("client-local TCP tunnels", () => {
  let ctx: DaemonTestContext | null = null;
  let target: http.Server | null = null;

  afterEach(async () => {
    await ctx?.cleanup();
    await new Promise<void>((resolve) => target?.close(() => resolve()) ?? resolve());
  });

  test("forwards arbitrary daemon-side TCP targets through a random local port", async () => {
    target = http.createServer((request, response) => {
      response.end(`target:${request.url}`);
    });
    await new Promise<void>((resolve) => target!.listen(0, "127.0.0.1", resolve));
    const address = target.address();
    if (!address || typeof address === "string") throw new Error("Target did not bind TCP");

    ctx = await createDaemonTestContext();
    const forwarder = await createLocalTunnelForwarder({
      client: ctx.client,
      target: { type: "tcp", host: "127.0.0.1", port: address.port },
    });
    try {
      expect(forwarder.host).toBe("127.0.0.1");
      expect(forwarder.port).toBeGreaterThan(0);
      expect(
        await fetch(`${forwarder.origin}/through-relay`).then((response) => response.text()),
      ).toBe("target:/through-relay");
    } finally {
      await forwarder.close();
    }
  });
});
