import { describe, expect, test } from "vitest";
import {
  discoverDaemonEndpoint,
  parseDaemonEndpointCandidate,
  validateDaemonPassword,
} from "./discovery";

describe("daemon discovery", () => {
  test("normalizes wildcard listen addresses to localhost", () => {
    expect(parseDaemonEndpointCandidate({ source: "config", value: "0.0.0.0:6767" })).toEqual({
      source: "config",
      endpoint: "127.0.0.1:6767",
    });
  });

  test("reports socket endpoints as unsupported instead of silently using the default", () => {
    expect(parseDaemonEndpointCandidate({ source: "config", value: "/tmp/paseo.sock" })).toEqual({
      source: "config",
      message: "Socket/pipe daemon listen targets are not supported in the VS Code client yet.",
    });
  });

  test("uses the first reachable candidate and recognizes password-protected daemons", async () => {
    const visited: string[] = [];
    const endpoint = await discoverDaemonEndpoint({
      settingEndpoint: "127.0.0.1:7000",
      configListen: "127.0.0.1:6767",
      fetch: async (url) => {
        visited.push(url);
        return {
          status: url.includes(":7000") ? 500 : 401,
          json: async () => ({}),
        };
      },
    });
    expect(visited).toHaveLength(2);
    expect(endpoint).toMatchObject({
      endpoint: "127.0.0.1:6767",
      source: "config",
      available: true,
      requiresPassword: true,
    });
  });

  test("validates passwords with a bearer token", async () => {
    let authorization: string | undefined;
    const valid = await validateDaemonPassword({
      endpoint: "127.0.0.1:6767",
      password: "secret",
      fetch: async (_url, init) => {
        authorization = init?.headers?.Authorization;
        return { status: 200, json: async () => ({ serverId: "server" }) };
      },
    });
    expect(valid).toBe(true);
    expect(authorization).toBe("Bearer secret");
  });
});
