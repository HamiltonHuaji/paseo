import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ipcMain } from "electron";
import {
  SkillRepositorySubscriptionSchema,
  SkillRepositoryExecutorJobRequestSchema,
  type SkillRepositoryExecutorJobResponse,
  type SkillRepositoryExecutorJobRequest,
  type SkillRepositorySubscription,
} from "@getpaseo/protocol/skill-repositories";

const execFileAsync = promisify(execFile);
type JobPayload = SkillRepositoryExecutorJobResponse["payload"];

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
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

async function bundleBranch(cwd: string, branch: string, file: string): Promise<string> {
  await git(cwd, "bundle", "create", file, `refs/heads/${branch}`);
  return (await fs.readFile(file)).toString("base64");
}

function isNonFastForwardRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { stdout?: unknown; stderr?: unknown };
  const output = `${String(value.stdout ?? "")}\n${String(value.stderr ?? "")}`;
  return /\[rejected\].*(non-fast-forward|fetch first|stale info)|non-fast-forward/i.test(output);
}

function parseJob(raw: unknown): {
  job: SkillRepositoryExecutorJobRequest;
  subscription: SkillRepositorySubscription;
} {
  if (typeof raw !== "object" || raw === null) throw new Error("Invalid skill repository job");
  const input = raw as Record<string, unknown>;
  const job = SkillRepositoryExecutorJobRequestSchema.parse(input.job);
  const subscription = SkillRepositorySubscriptionSchema.parse(input.subscription);
  if (job.repositoryId !== subscription.repositoryId) {
    throw new Error("Skill repository job does not match the configured repository");
  }
  const parsedUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(subscription.remoteUrl)
    ? new URL(subscription.remoteUrl)
    : null;
  if (parsedUrl?.username || parsedUrl?.password) {
    throw new Error("Skill repository URL contains credentials");
  }
  return { job, subscription };
}

export async function executeSkillRepositoryJob(raw: unknown): Promise<JobPayload> {
  const { job, subscription } = parseJob(raw);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-skill-repo-"));
  const repo = path.join(temp, "repo");
  const bundle = path.join(temp, "transfer.bundle");
  const resultBundle = path.join(temp, "result.bundle");
  const remoteRef = `refs/remotes/paseo/${subscription.branch}`;
  const branchRef = `refs/heads/${subscription.branch}`;
  try {
    await fs.mkdir(repo);
    await git(repo, "init", "-b", subscription.branch);
    if (job.operation === "fetch") {
      const advertised = await git(repo, "ls-remote", "--heads", subscription.remoteUrl, branchRef);
      if (!advertised) throw new Error("Skill repository branch does not exist");
      await git(repo, "fetch", "--no-tags", subscription.remoteUrl, `${branchRef}:${remoteRef}`);
      const remoteHead = await git(repo, "rev-parse", remoteRef);
      await git(repo, "update-ref", branchRef, remoteHead);
      return {
        requestId: job.requestId,
        repositoryId: job.repositoryId,
        state: "ok",
        remoteHead,
        bundleBase64: await bundleBranch(repo, subscription.branch, resultBundle),
      };
    }
    if (!job.bundleBase64 || !job.expectedHead) throw new Error("Missing local Git history");
    await fs.writeFile(bundle, Buffer.from(job.bundleBase64, "base64"));
    await git(repo, "bundle", "verify", bundle);
    await git(repo, "fetch", bundle, "HEAD:refs/heads/paseo-local");
    const localHead = await git(repo, "rev-parse", "refs/heads/paseo-local");
    if (localHead !== job.expectedHead) throw new Error("Local Git commit does not match request");

    const advertised = await git(repo, "ls-remote", "--heads", subscription.remoteUrl, branchRef);
    let remoteHead: string | null = null;
    if (advertised) {
      await git(repo, "fetch", "--no-tags", subscription.remoteUrl, `${branchRef}:${remoteRef}`);
      remoteHead = await git(repo, "rev-parse", remoteRef);
      await git(repo, "update-ref", branchRef, remoteHead);
    }
    let candidate = localHead;
    if (
      remoteHead &&
      (await gitMaybe(repo, "merge-base", "--is-ancestor", remoteHead, candidate)) === null
    ) {
      await git(repo, "checkout", "-B", "paseo-local", candidate);
      try {
        await git(
          repo,
          "-c",
          "user.name=Paseo",
          "-c",
          "user.email=paseo@localhost",
          "rebase",
          remoteHead,
        );
        candidate = await git(repo, "rev-parse", "HEAD");
      } catch {
        await gitMaybe(repo, "rebase", "--abort");
        return {
          requestId: job.requestId,
          repositoryId: job.repositoryId,
          state: "conflict",
          remoteHead,
          bundleBase64: await bundleBranch(repo, subscription.branch, resultBundle),
        };
      }
    }
    try {
      await git(
        repo,
        "push",
        subscription.remoteUrl,
        `${candidate}:refs/heads/${subscription.branch}`,
      );
    } catch (error) {
      if (!isNonFastForwardRejection(error)) throw error;
      const latestAdvertised = await gitMaybe(
        repo,
        "ls-remote",
        "--heads",
        subscription.remoteUrl,
        branchRef,
      );
      const latestRemoteHead = latestAdvertised?.split(/\s+/)[0] ?? null;
      if (!latestRemoteHead || latestRemoteHead === remoteHead) {
        throw error;
      }
      await git(repo, "fetch", "--no-tags", subscription.remoteUrl, `+${branchRef}:${remoteRef}`);
      await git(repo, "update-ref", branchRef, latestRemoteHead);
      return {
        requestId: job.requestId,
        repositoryId: job.repositoryId,
        state: "conflict",
        remoteHead: latestRemoteHead,
        bundleBase64: await bundleBranch(repo, subscription.branch, resultBundle),
      };
    }
    await git(repo, "update-ref", branchRef, candidate);
    return {
      requestId: job.requestId,
      repositoryId: job.repositoryId,
      state: "ok",
      remoteHead: candidate,
      publishedHead: candidate,
      bundleBase64: await bundleBranch(repo, subscription.branch, resultBundle),
    };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

export function registerSkillRepositoryIpc(): void {
  ipcMain.handle("paseo:skill-repository:execute", async (_event, raw: unknown) =>
    executeSkillRepositoryJob(raw),
  );
}
