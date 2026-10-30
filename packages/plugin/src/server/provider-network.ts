import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { EnvHttpProxyAgent } from "undici";

type Environment = Readonly<Record<string, string | undefined>>;

const requestEnvironment = new AsyncLocalStorage<Environment>();
const dispatchers = new Map<string, EnvHttpProxyAgent>();
const MAX_NETWORK_CONTEXTS = 32;

/** Snapshot only routing settings; never retain the rest of an agent's environment. */
export function providerProxyEnvironment(env: Environment) {
  const allProxy = env.all_proxy ?? env.ALL_PROXY ?? "";
  const httpProxy = env.http_proxy ?? env.HTTP_PROXY ?? allProxy;
  return {
    HTTP_PROXY: httpProxy,
    HTTPS_PROXY: (env.https_proxy ?? env.HTTPS_PROXY ?? allProxy) || httpProxy,
    NO_PROXY: env.no_proxy ?? env.NO_PROXY ?? "",
  };
}

export function withProviderNetworkEnvironment<T>(env: Environment, operation: () => T): T {
  return requestEnvironment.run(providerProxyEnvironment(env), operation);
}

/** Cache identity without putting proxy credentials in report IDs or diagnostics. */
export function providerNetworkKey(env: Environment = effectiveEnvironment()): string {
  return createHash("sha256")
    .update(JSON.stringify(providerProxyEnvironment(env)))
    .digest("hex");
}

function effectiveEnvironment(): Environment {
  return requestEnvironment.getStore() ?? process.env;
}

function validateProxy(value: string, variable: string): void {
  if (!value) return;
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    throw new Error(`Invalid provider ${variable} URL`);
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`Provider ${variable} requires an HTTP or HTTPS proxy`);
  }
}

function dispatcherFor(env: Environment): EnvHttpProxyAgent {
  const key = providerNetworkKey(env);
  const existing = dispatchers.get(key);
  if (existing) {
    dispatchers.delete(key);
    dispatchers.set(key, existing);
    return existing;
  }
  const proxy = providerProxyEnvironment(env);
  validateProxy(proxy.HTTP_PROXY, "HTTP_PROXY");
  validateProxy(proxy.HTTPS_PROXY, "HTTPS_PROXY");
  const dispatcher = new EnvHttpProxyAgent({
    httpProxy: proxy.HTTP_PROXY,
    httpsProxy: proxy.HTTPS_PROXY,
    noProxy: proxy.NO_PROXY,
  });
  dispatchers.set(key, dispatcher);
  if (dispatchers.size > MAX_NETWORK_CONTEXTS) {
    const [oldestKey, oldest] = dispatchers.entries().next().value!;
    dispatchers.delete(oldestKey);
    // close drains pending requests, including streamed response bodies.
    void oldest.close().catch(() => oldest.destroy());
  }
  return dispatcher;
}

/** Provider-only fetch: redirects use the same dispatcher and re-evaluate NO_PROXY. */
export async function providerFetch(
  ...[input, init]: Parameters<typeof fetch>
): ReturnType<typeof fetch> {
  const options = { ...init, dispatcher: dispatcherFor(effectiveEnvironment()) };
  return globalThis.fetch(input, options);
}
