import type pino from "pino";
import { readFileSync } from "node:fs";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "../private-files.js";

/**
 * Store for Expo push tokens.
 *
 * Tokens are persisted to disk so pushes still work after daemon restarts.
 */
export class PushTokenStore {
  private readonly logger: pino.Logger;
  private subscriptions = new Map<string, number>();
  private document: Record<string, unknown> = {};
  private readonly filePath: string;
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly write: typeof writePrivateFileAtomicSync;

  constructor(
    logger: pino.Logger,
    filePath: string,
    now: () => number,
    leaseMs: number,
    write: typeof writePrivateFileAtomicSync = writePrivateFileAtomicSync,
  ) {
    this.logger = logger.child({ component: "token-store" });
    this.filePath = filePath;
    this.now = now;
    this.leaseMs = leaseMs;
    this.write = write;
    this.loadFromDisk();
  }

  renewToken(token: string): void {
    const normalized = token.trim();
    if (!normalized) return;
    const now = this.now();
    const currentExpiry = this.subscriptions.get(normalized);
    if (currentExpiry !== undefined && currentExpiry - now > this.leaseMs / 2) return;
    const next = new Map(this.subscriptions);
    next.set(normalized, now + this.leaseMs);
    this.persist(next);
    this.subscriptions = next;
    this.logger.debug({ total: this.subscriptions.size }, "Renewed token");
  }

  revokeToken(token: string): void {
    const normalized = token.trim();
    if (!normalized) return;
    if (!this.subscriptions.has(normalized)) return;
    const next = new Map(this.subscriptions);
    next.delete(normalized);
    this.persist(next);
    this.subscriptions = next;
    this.logger.debug({ total: this.subscriptions.size }, "Revoked token");
  }

  getActiveTokens(): string[] {
    const now = this.now();
    const active = new Map(this.subscriptions);
    for (const [token, expiresAt] of this.subscriptions) {
      if (expiresAt <= now) {
        active.delete(token);
      }
    }
    if (active.size !== this.subscriptions.size) {
      try {
        this.persist(active);
        this.subscriptions = active;
      } catch {
        // Keep the previous state so a later send retries pruning. Expired tokens
        // are still excluded from this delivery.
      }
    }
    return Array.from(active.keys());
  }

  private loadFromDisk(): void {
    let raw: string;
    try {
      ensurePrivateFile(this.filePath);
      raw = readFileSync(this.filePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      !isTokenObject(parsed) ||
      (parsed.subscriptions !== undefined && !Array.isArray(parsed.subscriptions)) ||
      (parsed.tokens !== undefined && !Array.isArray(parsed.tokens))
    ) {
      throw new Error(`Invalid push token store: ${this.filePath}`);
    }
    this.document = parsed;
    const loaded = new Map<string, number>();
    for (const value of Array.isArray(parsed.subscriptions) ? parsed.subscriptions : []) {
      const subscription = parseSubscription(value);
      if (subscription) loaded.set(subscription.token, subscription.expiresAt);
    }
    this.subscriptions = loaded;

    const legacyTokens = Array.isArray(parsed.tokens)
      ? parsed.tokens.filter((token): token is string => typeof token === "string")
      : [];
    if (legacyTokens.length > 0) {
      const migrated = new Map(loaded);
      const expiresAt = this.now() + this.leaseMs;
      for (const token of legacyTokens) {
        const normalized = token.trim();
        if (normalized) migrated.set(normalized, expiresAt);
      }
      this.persist(migrated);
      this.subscriptions = migrated;
    }
    this.logger.info({ total: this.subscriptions.size }, "Loaded push tokens");
  }

  private persist(subscriptions: ReadonlyMap<string, number>): void {
    try {
      const remaining = new Map(subscriptions);
      const entries: unknown[] = [];
      for (const value of Array.isArray(this.document.subscriptions)
        ? this.document.subscriptions
        : []) {
        const previous = parseSubscription(value);
        if (!previous || !isTokenObject(value)) {
          entries.push(value);
          continue;
        }
        const expiresAt = subscriptions.get(previous.token);
        if (expiresAt === undefined) continue;
        entries.push(
          expiresAt === previous.expiresAt
            ? value
            : { ...value, expiresAt: new Date(expiresAt).toISOString() },
        );
        remaining.delete(previous.token);
      }
      for (const [token, expiresAt] of remaining) {
        entries.push({ token, expiresAt: new Date(expiresAt).toISOString() });
      }
      const document: Record<string, unknown> = { ...this.document, subscriptions: entries };
      if (Array.isArray(document.tokens)) {
        // Migrate understood legacy strings once; keep unrecognized entries in
        // the same file so a newer daemon can still read them.
        const opaqueTokens = document.tokens.filter((token) => typeof token !== "string");
        if (opaqueTokens.length > 0) document.tokens = opaqueTokens;
        else delete document.tokens;
      }
      const payload = JSON.stringify(document, null, 2) + "\n";
      this.write(this.filePath, payload);
      this.document = document;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ err }, "Failed to persist push tokens");
      throw err;
    }
  }
}

function isTokenObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSubscription(value: unknown): { token: string; expiresAt: number } | null {
  if (!isTokenObject(value)) return null;
  if (typeof value.token !== "string" || typeof value.expiresAt !== "string") return null;
  const token = value.token.trim();
  const expiresAt = Date.parse(value.expiresAt);
  return token && Number.isFinite(expiresAt) ? { token, expiresAt } : null;
}
