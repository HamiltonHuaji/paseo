import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  SkillRepositorySubscriptionSchema,
  type SkillRepositorySubscription,
  type SkillRepositoryExecutorJobRequest,
  type SkillRepositoryExecutorJobResponse,
} from "@getpaseo/protocol/skill-repositories";

const execFileAsync = promisify(execFile);
const StoreSchema = z.object({
  subscriptions: z.array(SkillRepositorySubscriptionSchema),
  pendingPublications: z.record(z.string(), z.string()),
  blockedPublications: z.record(z.string(), z.string()).default({}),
  syncErrors: z.record(z.string(), z.string()).default({}),
  remoteCheckedAt: z.record(z.string(), z.string()).default({}),
});
type Store = z.infer<typeof StoreSchema>;

interface Executor {
  source: object;
  repositories: Map<string, { read: boolean; publish: boolean }>;
  send: (request: SkillRepositoryExecutorJobRequest) => void;
}

type JobResult = SkillRepositoryExecutorJobResponse["payload"];
interface PendingJob {
  source: object;
  repositoryId: string;
  resolve: (result: JobResult) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface SkillRepositoryStatus {
  repositoryId: string;
  checkoutPath: string;
  branch: string;
  localHead: string | null;
  remoteHead: string | null;
  remoteTrackingRef: string | null;
  remoteCheckedAt: string | null;
  worktree: "clean" | "dirty" | "conflicted";
  ahead: number | null;
  behind: number | null;
  publication: "none" | "pending" | "published" | "blocked";
  syncError: string | null;
}

export interface FetchResult {
  state: "fetched" | "unavailable";
  remoteHead: string | null;
  remoteTrackingRef: string | null;
  remoteCheckedAt: string | null;
}

export interface PublishResult {
  state: "published" | "local_only" | "needs_resolution";
  localHead: string;
  publishedHead: string | null;
  remoteHead: string | null;
  remoteTrackingRef: string | null;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

async function gitMaybe(cwd: string, ...args: string[]): Promise<string | null> {
  try {
    return await git(cwd, ...args);
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

function assertRepositoryId(id: string): void {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
    throw new Error("Invalid skill repository ID");
  }
}

function assertRemoteUrl(url: string): void {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      throw new Error("Skill repository URL must not contain credentials");
    }
  }
}

export class SkillRepositoryService {
  private readonly file: string;
  private readonly root: string;
  private store: Store = {
    subscriptions: [],
    pendingPublications: {},
    blockedPublications: {},
    syncErrors: {},
    remoteCheckedAt: {},
  };
  private readonly executors = new Map<object, Executor>();
  private readonly jobs = new Map<string, PendingJob>();
  private readonly originByAgent = new Map<string, { source: object | null; turnId?: string }>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private storeWrites: Promise<void> = Promise.resolve();

  private constructor(paseoHome: string) {
    this.root = path.join(paseoHome, "skill-repositories");
    this.file = path.join(this.root, "subscriptions.json");
  }

  static async open(paseoHome: string): Promise<SkillRepositoryService> {
    const service = new SkillRepositoryService(paseoHome);
    const raw = await fs.readFile(service.file, "utf8").catch(() => null);
    if (raw !== null) service.store = StoreSchema.parse(JSON.parse(raw));
    return service;
  }

  list(): SkillRepositorySubscription[] {
    return [...this.store.subscriptions];
  }

  checkoutPath(repositoryId: string): string {
    assertRepositoryId(repositoryId);
    return path.join(this.root, repositoryId, "checkout");
  }

  get(repositoryId: string): SkillRepositorySubscription {
    const subscription = this.store.subscriptions.find(
      (entry) => entry.repositoryId === repositoryId,
    );
    if (!subscription) throw new Error(`Skill repository ${repositoryId} is not subscribed`);
    return subscription;
  }

  async upsert(input: SkillRepositorySubscription): Promise<SkillRepositorySubscription> {
    const subscription = SkillRepositorySubscriptionSchema.parse(input);
    assertRepositoryId(subscription.repositoryId);
    assertRemoteUrl(subscription.remoteUrl);
    await git(process.cwd(), "check-ref-format", "--branch", subscription.branch);
    return this.withLock(subscription.repositoryId, async () => {
      const previous = this.store.subscriptions.find(
        (entry) => entry.repositoryId === subscription.repositoryId,
      );
      if (
        previous &&
        (previous.remoteUrl !== subscription.remoteUrl || previous.branch !== subscription.branch)
      ) {
        throw new Error("Changing a subscribed repository's remote or branch requires a new ID");
      }
      const checkout = this.checkoutPath(subscription.repositoryId);
      await fs.mkdir(checkout, { recursive: true });
      if (!(await fs.stat(path.join(checkout, ".git")).catch(() => null))) {
        await git(checkout, "init", "-b", subscription.branch);
      }
      this.store.subscriptions = [
        ...this.store.subscriptions.filter(
          (entry) => entry.repositoryId !== subscription.repositoryId,
        ),
        subscription,
      ];
      delete this.store.syncErrors[subscription.repositoryId];
      await this.saveStore();
      if (subscription.autoReceive !== "none") {
        this.scheduleAutomatic(subscription.repositoryId);
      }
      return subscription;
    });
  }

  async remove(repositoryId: string): Promise<void> {
    await this.withLock(repositoryId, async () => {
      this.get(repositoryId);
      this.store.subscriptions = this.store.subscriptions.filter(
        (entry) => entry.repositoryId !== repositoryId,
      );
      delete this.store.pendingPublications[repositoryId];
      delete this.store.blockedPublications[repositoryId];
      delete this.store.syncErrors[repositoryId];
      delete this.store.remoteCheckedAt[repositoryId];
      await this.saveStore();
    });
  }

  private saveStore(): Promise<void> {
    this.storeWrites = this.storeWrites
      .catch(() => {})
      .then(() => writeAtomic(this.file, this.store));
    return this.storeWrites;
  }

  private scheduleAutomatic(repositoryId: string): void {
    void this.receiveAutomatic(repositoryId).catch(async (error) => {
      this.store.syncErrors[repositoryId] = error instanceof Error ? error.message : String(error);
      await this.saveStore();
    });
  }

  setTurnOrigin(agentId: string, source: object | null, turnId?: string): void {
    this.originByAgent.set(agentId, { source, turnId });
  }

  clearTurnOrigin(agentId: string, turnId?: string): void {
    const current = this.originByAgent.get(agentId);
    if (turnId && current?.turnId && turnId !== current.turnId) return;
    this.originByAgent.delete(agentId);
  }

  getTurnOrigin(agentId: string): object | null {
    return this.originByAgent.get(agentId)?.source ?? null;
  }

  registerExecutor(
    source: object,
    repositories: Array<{
      repositoryId: string;
      remoteUrl: string;
      branch: string;
      read: boolean;
      publish: boolean;
    }>,
    send: Executor["send"],
  ): () => void {
    const eligible = new Map<string, { read: boolean; publish: boolean }>();
    for (const entry of repositories) {
      if (
        this.store.subscriptions.some(
          (item) =>
            item.repositoryId === entry.repositoryId &&
            item.remoteUrl === entry.remoteUrl &&
            item.branch === entry.branch,
        )
      ) {
        eligible.set(entry.repositoryId, { read: entry.read, publish: entry.publish });
      }
    }
    const executor = { source, repositories: eligible, send };
    this.executors.set(source, executor);
    for (const [repositoryId, capability] of eligible) {
      if (
        capability.publish &&
        this.store.pendingPublications[repositoryId] &&
        !this.store.blockedPublications[repositoryId]
      ) {
        void this.publish(repositoryId, this.store.pendingPublications[repositoryId]).catch(
          () => {},
        );
      }
      if (capability.read && this.get(repositoryId).autoReceive !== "none") {
        this.scheduleAutomatic(repositoryId);
      }
    }
    return () => this.unregisterExecutor(source, executor);
  }

  unregisterExecutor(source: object, expected?: Executor): void {
    if (expected && this.executors.get(source) !== expected) return;
    this.executors.delete(source);
    for (const [requestId, job] of this.jobs) {
      if (job.source !== source) continue;
      clearTimeout(job.timeout);
      this.jobs.delete(requestId);
      job.resolve({ requestId, repositoryId: job.repositoryId, state: "unavailable" });
    }
  }

  refreshExecutor(source: object): void {
    const executor = this.executors.get(source);
    if (!executor) return;
    for (const [repositoryId, capability] of executor.repositories) {
      if (
        capability.publish &&
        this.store.pendingPublications[repositoryId] &&
        !this.store.blockedPublications[repositoryId]
      ) {
        void this.publish(repositoryId, this.store.pendingPublications[repositoryId]).catch(
          () => {},
        );
      }
      if (capability.read && this.get(repositoryId).autoReceive !== "none") {
        this.scheduleAutomatic(repositoryId);
      }
    }
  }

  receiveJobResponse(source: object, response: SkillRepositoryExecutorJobResponse): boolean {
    const result = response.payload;
    const job = this.jobs.get(result.requestId);
    if (!job || job.source !== source || job.repositoryId !== result.repositoryId) return false;
    clearTimeout(job.timeout);
    this.jobs.delete(result.requestId);
    job.resolve(result);
    return true;
  }

  private chooseExecutor(
    repositoryId: string,
    operation: "read" | "publish",
    preferred: object | null,
  ): Executor | null {
    const preferredExecutor = preferred ? this.executors.get(preferred) : undefined;
    if (preferredExecutor?.repositories.get(repositoryId)?.[operation]) return preferredExecutor;
    for (const executor of this.executors.values()) {
      if (executor.repositories.get(repositoryId)?.[operation]) return executor;
    }
    return null;
  }

  private async requestJob(
    repositoryId: string,
    operation: "fetch" | "publish",
    preferred: object | null,
    bundleBase64?: string,
    expectedHead?: string,
  ): Promise<JobResult | null> {
    const executor = this.chooseExecutor(
      repositoryId,
      operation === "fetch" ? "read" : "publish",
      preferred,
    );
    if (!executor) return null;
    const requestId = randomUUID();
    const result = new Promise<JobResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.jobs.delete(requestId);
        resolve({ requestId, repositoryId, state: "unavailable" });
      }, 60_000);
      this.jobs.set(requestId, { source: executor.source, repositoryId, timeout, resolve });
    });
    try {
      executor.send({
        type: "skills.repository.executor.job.request",
        requestId,
        repositoryId,
        operation,
        ...(bundleBase64 ? { bundleBase64 } : {}),
        ...(expectedHead ? { expectedHead } : {}),
      });
      return await result;
    } catch (error) {
      const pending = this.jobs.get(requestId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.jobs.delete(requestId);
      }
      throw error;
    }
  }

  private async withLock<T>(repositoryId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(repositoryId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(run);
    this.locks.set(repositoryId, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(repositoryId) === next) this.locks.delete(repositoryId);
    }
  }

  private trackingRef(subscription: SkillRepositorySubscription): string {
    return `refs/remotes/paseo/${subscription.branch}`;
  }

  private async importBundle(
    repositoryId: string,
    base64: string,
    allowRewrite = false,
  ): Promise<string> {
    const subscription = this.get(repositoryId);
    const checkout = this.checkoutPath(repositoryId);
    const file = path.join(this.root, repositoryId, `${randomUUID()}.bundle`);
    try {
      await fs.writeFile(file, Buffer.from(base64, "base64"), { mode: 0o600 });
      await git(checkout, "bundle", "verify", file);
      const previousRemoteHead = await gitMaybe(
        checkout,
        "rev-parse",
        this.trackingRef(subscription),
      );
      if (allowRewrite && previousRemoteHead) {
        await git(
          checkout,
          "update-ref",
          `refs/paseo/recovery/remote-${randomUUID()}`,
          previousRemoteHead,
        );
      }
      await git(
        checkout,
        "fetch",
        file,
        `${allowRewrite ? "+" : ""}refs/heads/${subscription.branch}:${this.trackingRef(subscription)}`,
      );
      return await git(checkout, "rev-parse", this.trackingRef(subscription));
    } finally {
      await fs.rm(file, { force: true });
    }
  }

  private async exportBundle(repositoryId: string): Promise<string> {
    const checkout = this.checkoutPath(repositoryId);
    const file = path.join(this.root, repositoryId, `${randomUUID()}.bundle`);
    try {
      await git(checkout, "bundle", "create", file, "HEAD");
      return (await fs.readFile(file)).toString("base64");
    } finally {
      await fs.rm(file, { force: true });
    }
  }

  private async fetchLocked(
    repositoryId: string,
    preferred: object | null,
    allowRewrite = false,
  ): Promise<FetchResult> {
    const subscription = this.get(repositoryId);
    const result = await this.requestJob(repositoryId, "fetch", preferred);
    if (!result || result.state === "unavailable") {
      return {
        state: "unavailable",
        remoteHead: null,
        remoteTrackingRef: null,
        remoteCheckedAt: null,
      };
    }
    if (result.state !== "ok" || !result.bundleBase64) {
      throw new Error(result.error ?? "Skill repository fetch failed");
    }
    const remoteHead = await this.importBundle(repositoryId, result.bundleBase64, allowRewrite);
    if (result.remoteHead && result.remoteHead !== remoteHead) {
      throw new Error("Client reported a different remote Git commit");
    }
    const remoteCheckedAt = new Date().toISOString();
    this.store.remoteCheckedAt[repositoryId] = remoteCheckedAt;
    await this.saveStore();
    return {
      state: "fetched",
      remoteHead,
      remoteTrackingRef: this.trackingRef(subscription),
      remoteCheckedAt,
    };
  }

  async fetch(
    repositoryId: string,
    preferred: object | null = null,
    allowRewrite = false,
  ): Promise<FetchResult> {
    return this.withLock(repositoryId, () =>
      this.fetchLocked(repositoryId, preferred, allowRewrite),
    );
  }

  private async receiveAutomatic(repositoryId: string): Promise<void> {
    await this.withLock(repositoryId, async () => {
      const subscription = this.get(repositoryId);
      if (subscription.autoReceive === "none") return;
      const fetched = await this.fetchLocked(repositoryId, null);
      if (fetched.state !== "fetched" || !fetched.remoteTrackingRef) return;
      const checkout = this.checkoutPath(repositoryId);
      const localHead = await gitMaybe(checkout, "rev-parse", "HEAD");
      if (subscription.autoReceive === "overwrite") {
        if (localHead) {
          await git(checkout, "update-ref", `refs/paseo/recovery/${randomUUID()}`, localHead);
        }
        await git(checkout, "reset", "--hard", fetched.remoteTrackingRef);
        await git(checkout, "clean", "-fdx");
        delete this.store.pendingPublications[repositoryId];
        delete this.store.blockedPublications[repositoryId];
        delete this.store.syncErrors[repositoryId];
        await this.saveStore();
        return;
      }
      if (!localHead) {
        await git(checkout, "checkout", "-B", subscription.branch, fetched.remoteTrackingRef);
        delete this.store.syncErrors[repositoryId];
        await this.saveStore();
        return;
      }
      if (
        (await gitMaybe(
          checkout,
          "merge-base",
          "--is-ancestor",
          fetched.remoteTrackingRef,
          localHead,
        )) !== null
      ) {
        delete this.store.syncErrors[repositoryId];
        await this.saveStore();
        return;
      }
      if ((await git(checkout, "status", "--porcelain")) !== "") {
        this.store.syncErrors[repositoryId] = "Local skill checkout has uncommitted changes";
        await this.saveStore();
        return;
      }
      if (
        (await gitMaybe(
          checkout,
          "merge-base",
          "--is-ancestor",
          localHead,
          fetched.remoteTrackingRef,
        )) === null
      ) {
        this.store.syncErrors[repositoryId] = "Local and remote skill histories have diverged";
        await this.saveStore();
        return;
      }
      await git(checkout, "merge", "--ff-only", fetched.remoteTrackingRef);
      delete this.store.syncErrors[repositoryId];
      await this.saveStore();
    });
  }

  async status(repositoryId: string): Promise<SkillRepositoryStatus> {
    const subscription = this.get(repositoryId);
    const checkout = this.checkoutPath(repositoryId);
    const localHead = await gitMaybe(checkout, "rev-parse", "HEAD");
    const remoteHead = await gitMaybe(checkout, "rev-parse", this.trackingRef(subscription));
    const porcelain = await git(checkout, "status", "--porcelain");
    const unmerged = await git(checkout, "diff", "--name-only", "--diff-filter=U");
    const counts =
      localHead && remoteHead
        ? await gitMaybe(
            checkout,
            "rev-list",
            "--left-right",
            "--count",
            `${remoteHead}...${localHead}`,
          )
        : null;
    const [behind, ahead] = counts?.split(/\s+/).map(Number) ?? [null, null];
    const pending = this.store.pendingPublications[repositoryId];
    let publication: SkillRepositoryStatus["publication"] = "none";
    if (pending)
      publication =
        this.store.blockedPublications[repositoryId] === pending ? "blocked" : "pending";
    else if (localHead && localHead === remoteHead) publication = "published";
    let worktree: SkillRepositoryStatus["worktree"] = "clean";
    if (unmerged) worktree = "conflicted";
    else if (porcelain) worktree = "dirty";
    return {
      repositoryId,
      checkoutPath: checkout,
      branch: subscription.branch,
      localHead,
      remoteHead,
      remoteTrackingRef: remoteHead ? this.trackingRef(subscription) : null,
      remoteCheckedAt: this.store.remoteCheckedAt[repositoryId] ?? null,
      worktree,
      ahead: ahead ?? null,
      behind: behind ?? null,
      publication,
      syncError: this.store.syncErrors[repositoryId] ?? null,
    };
  }

  async publish(
    repositoryId: string,
    expectedHead: string,
    preferred: object | null = null,
  ): Promise<PublishResult> {
    return this.withLock(repositoryId, async () => {
      const subscription = this.get(repositoryId);
      if (!subscription.agentPublishAllowed) throw new Error("Agent publication is disabled");
      const status = await this.status(repositoryId);
      if (status.localHead !== expectedHead) throw new Error("head_changed");
      if (status.worktree === "conflicted") throw new Error("Resolve Git conflicts first");
      this.store.pendingPublications[repositoryId] = expectedHead;
      delete this.store.blockedPublications[repositoryId];
      await this.saveStore();
      if (!this.chooseExecutor(repositoryId, "publish", preferred)) {
        return {
          state: "local_only",
          localHead: expectedHead,
          publishedHead: null,
          remoteHead: status.remoteHead,
          remoteTrackingRef: status.remoteTrackingRef,
        };
      }
      const bundleBase64 = await this.exportBundle(repositoryId);
      const result = await this.requestJob(
        repositoryId,
        "publish",
        preferred,
        bundleBase64,
        expectedHead,
      );
      if (!result || result.state === "unavailable") {
        return {
          state: "local_only",
          localHead: expectedHead,
          publishedHead: null,
          remoteHead: status.remoteHead,
          remoteTrackingRef: status.remoteTrackingRef,
        };
      }
      if (result.bundleBase64) await this.importBundle(repositoryId, result.bundleBase64);
      if (result.state === "conflict") {
        this.store.blockedPublications[repositoryId] = expectedHead;
        await this.saveStore();
        return {
          state: "needs_resolution",
          localHead: expectedHead,
          publishedHead: null,
          remoteHead: result.remoteHead ?? null,
          remoteTrackingRef: this.trackingRef(subscription),
        };
      }
      if (result.state !== "ok" || !result.publishedHead) {
        throw new Error(result.error ?? "Skill repository publication failed");
      }
      const remoteHead = await git(
        this.checkoutPath(repositoryId),
        "rev-parse",
        this.trackingRef(subscription),
      );
      if (remoteHead !== result.publishedHead) {
        throw new Error("Published commit is missing from the returned Git bundle");
      }
      const current = await this.status(repositoryId);
      if (current.localHead === expectedHead && current.worktree === "clean") {
        if (remoteHead !== expectedHead) {
          await git(
            this.checkoutPath(repositoryId),
            "update-ref",
            `refs/paseo/recovery/${randomUUID()}`,
            expectedHead,
          );
        }
        await git(this.checkoutPath(repositoryId), "reset", "--hard", remoteHead);
      }
      delete this.store.pendingPublications[repositoryId];
      delete this.store.blockedPublications[repositoryId];
      await this.saveStore();
      return {
        state: "published",
        localHead:
          (await gitMaybe(this.checkoutPath(repositoryId), "rev-parse", "HEAD")) ?? expectedHead,
        publishedHead: remoteHead,
        remoteHead,
        remoteTrackingRef: this.trackingRef(subscription),
      };
    });
  }
}
