import { randomUUID } from "node:crypto";
import type { DaemonUpdateJob, DaemonUpdateTransfer } from "@getpaseo/protocol/daemon-updates";
import { DaemonUpdateUpload } from "./daemon-update-upload.js";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";
import {
  daemonInstallOriginRuntime,
  resolveNpmGlobalPrefix,
  validateDaemonInstallOrigin,
  type DaemonInstallOriginRuntime,
} from "./install-origin.js";
import { currentDaemonDistribution, type PaseoDaemonDistribution } from "./distribution.js";
import {
  npmGlobalPaseoCli,
  type NpmGlobalOptions,
  type NpmGlobalPaseoCli,
} from "./npm-global-cli.js";

export type DaemonSelfUpdatePhase = "starting" | "downloading" | "installing" | "complete";

const INSTALL_PROGRESS_INTERVAL_MS = 15_000;

export interface DaemonSelfUpdateResult {
  success: boolean;
  error: string | null;
  newVersion: string | null;
}

export interface DaemonSelfUpdateInput {
  uploadId?: string;
  daemonVersion: string | null;
  desktopManaged: boolean;
  onProgress: (phase: DaemonSelfUpdatePhase, output?: string) => void;
  logger: DaemonSelfUpdateLogger;
}

export interface DaemonSelfUpdateLogger {
  error(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export interface DaemonSelfUpdateRuntime {
  npm: NpmGlobalPaseoCli;
  installOrigin: DaemonInstallOriginRuntime;
  distribution: PaseoDaemonDistribution;
}

export class DaemonSelfUpdateInProgressError extends Error {
  constructor() {
    super("An update is already in progress");
    this.name = "DaemonSelfUpdateInProgressError";
  }
}

const defaultRuntime: DaemonSelfUpdateRuntime = {
  npm: npmGlobalPaseoCli,
  installOrigin: daemonInstallOriginRuntime,
  distribution: currentDaemonDistribution,
};

const DESKTOP_MANAGED_UPDATE_ERROR =
  "This daemon is managed by Paseo Desktop. Update Paseo Desktop on the host.";

interface UpdateJob {
  snapshot: DaemonUpdateJob;
  abort: AbortController;
  upload: DaemonUpdateUpload | null;
  uploadTimer: ReturnType<typeof setTimeout> | null;
  installing: boolean;
}

export class DaemonSelfUpdater {
  private job: UpdateJob | null = null;

  constructor(private readonly runtime: DaemonSelfUpdateRuntime = defaultRuntime) {}

  getStatus(): DaemonUpdateJob | null {
    return this.job ? structuredClone(this.job.snapshot) : null;
  }

  private isActive(): boolean {
    return this.job?.snapshot.status === "running" || this.job?.snapshot.status === "cancelling";
  }

  private createJob(upload: DaemonUpdateUpload | null): UpdateJob {
    if (this.isActive()) throw new DaemonSelfUpdateInProgressError();
    const now = Date.now();
    const job: UpdateJob = {
      snapshot: {
        id: randomUUID(),
        status: "running",
        phase: upload ? "uploading" : "starting",
        startedAt: now,
        updatedAt: now,
        output: "",
        error: null,
        package: upload?.metadata ?? null,
        receivedBytes: 0,
      },
      abort: new AbortController(),
      upload,
      uploadTimer: null,
      installing: false,
    };
    this.job = job;
    return job;
  }

  private clearUploadTimer(job: UpdateJob): void {
    if (job.uploadTimer) clearTimeout(job.uploadTimer);
    job.uploadTimer = null;
  }

  private touchUpload(job: UpdateJob): void {
    this.clearUploadTimer(job);
    job.uploadTimer = setTimeout(() => {
      void this.endUpload(job, "failed", "Upload stopped receiving data. Retry the update.");
    }, 5 * 60_000);
    job.uploadTimer.unref();
  }

  private async endUpload(
    job: UpdateJob,
    status: "failed" | "cancelled",
    error: string,
  ): Promise<void> {
    this.clearUploadTimer(job);
    job.abort.abort(new Error(error));
    job.snapshot.status = "cancelling";
    try {
      await job.upload?.dispose();
    } finally {
      job.snapshot.status = status;
      job.snapshot.error = error;
      job.snapshot.updatedAt = Date.now();
    }
  }

  async cancel(jobId: string): Promise<DaemonUpdateJob | null> {
    const job = this.job;
    if (!job || job.snapshot.id !== jobId) throw new Error("This update task is no longer current");
    if (!this.isActive()) return this.getStatus();
    job.snapshot.status = "cancelling";
    job.snapshot.updatedAt = Date.now();
    job.abort.abort(new Error("Update cancelled by the user"));
    if (!job.installing) await this.endUpload(job, "cancelled", "Update cancelled by the user");
    return this.getStatus();
  }

  async transfer(transfer: DaemonUpdateTransfer): Promise<DaemonUpdateJob> {
    if (this.runtime.distribution.kind !== "bundled")
      throw new Error("This distribution does not support client-supplied update packages");
    if (transfer.action === "begin") {
      const upload = new DaemonUpdateUpload(transfer.package);
      const job = this.createJob(upload);
      try {
        await upload.open();
        job.abort.signal.throwIfAborted();
        this.touchUpload(job);
      } catch (error) {
        await this.endUpload(
          job,
          job.abort.signal.aborted ? "cancelled" : "failed",
          getErrorMessage(error),
        );
        throw error;
      }
      return structuredClone(job.snapshot);
    }
    const job = this.job;
    if (
      !job ||
      job.snapshot.id !== transfer.jobId ||
      job.snapshot.status !== "running" ||
      !job.upload ||
      job.installing
    )
      throw new Error("No matching upload is accepting data");
    this.clearUploadTimer(job);
    try {
      job.snapshot.receivedBytes = await job.upload.write(transfer.offset, transfer.data);
      job.abort.signal.throwIfAborted();
      job.snapshot.updatedAt = Date.now();
      this.touchUpload(job);
      return structuredClone(job.snapshot);
    } catch (error) {
      await this.endUpload(
        job,
        job.abort.signal.aborted ? "cancelled" : "failed",
        getErrorMessage(error),
      );
      throw error;
    }
  }

  async update(input: DaemonSelfUpdateInput): Promise<DaemonSelfUpdateResult> {
    if (this.runtime.distribution.kind === "source") {
      return {
        success: false,
        error:
          "This daemon runs from a source checkout. Rebuild this checkout and restart its isolated daemon explicitly.",
        newVersion: null,
      };
    }
    if (input.desktopManaged) {
      return { success: false, error: DESKTOP_MANAGED_UPDATE_ERROR, newVersion: null };
    }
    let job: UpdateJob;
    if (input.uploadId) {
      const pending = this.job;
      if (
        !pending ||
        pending.snapshot.id !== input.uploadId ||
        !pending.upload ||
        pending.snapshot.status !== "running" ||
        pending.installing
      ) {
        throw new Error("No completed upload is available for this update");
      }
      job = pending;
    } else {
      job = this.createJob(null);
    }
    job.installing = true;
    this.clearUploadTimer(job);
    const progress = (phase: DaemonSelfUpdatePhase, output?: string): void => {
      job.snapshot.phase = phase;
      job.snapshot.updatedAt = Date.now();
      if (output) job.snapshot.output = `${job.snapshot.output}${output}`.slice(-8192);
      // Losing the requesting client must not terminate a daemon-owned installation.
      try {
        input.onProgress(phase, output);
      } catch (error) {
        input.logger.warn({ err: error }, "Update progress recipient disconnected");
      }
    };
    let result: DaemonSelfUpdateResult;
    try {
      result = await this.install(job, input, progress);
    } catch (error) {
      input.logger.error({ err: error }, "Daemon self-update failed with exception");
      result = { success: false, error: getErrorMessage(error), newVersion: null };
    }
    try {
      await job.upload?.dispose();
    } catch (error) {
      input.logger.warn({ err: error }, "Unable to remove temporary update package");
    }
    if (job.abort.signal.aborted) {
      result = { success: false, error: "Update cancelled by the user", newVersion: null };
      job.snapshot.status = "cancelled";
    } else {
      job.snapshot.status = result.success ? "complete" : "failed";
    }
    job.snapshot.error = result.error;
    job.snapshot.updatedAt = Date.now();
    return result;
  }

  private async install(
    job: UpdateJob,
    input: DaemonSelfUpdateInput,
    progress: DaemonSelfUpdateInput["onProgress"],
  ): Promise<DaemonSelfUpdateResult> {
    progress("starting");
    const npmOptions: NpmGlobalOptions = {
      prefix: resolveNpmGlobalPrefix(this.runtime.installOrigin.resolveCurrentServerPackageRoot()),
      signal: job.abort.signal,
    };
    if (job.upload) {
      job.snapshot.phase = "verifying";
      npmOptions.installSpec = await job.upload.finish(this.runtime.distribution.packageName);
    }
    job.abort.signal.throwIfAborted();
    if (this.runtime.distribution.kind === "official") {
      const install = await this.runtime.npm.inspect(npmOptions);
      const unsupportedReason = validateDaemonInstallOrigin(
        install,
        input.daemonVersion,
        this.runtime.distribution,
        this.runtime.installOrigin,
      );
      if (unsupportedReason) return { success: false, error: unsupportedReason, newVersion: null };
    }
    job.abort.signal.throwIfAborted();
    progress("downloading");
    progress("installing");
    const timer = setInterval(() => progress("installing"), INSTALL_PROGRESS_INTERVAL_MS);
    const result = await this.runtime.npm
      .installLatest(npmOptions, (output) => progress("installing", output))
      .finally(() => clearInterval(timer));
    job.abort.signal.throwIfAborted();
    if (result.exitCode !== 0) {
      const error =
        result.stderr.trim() || result.stdout.trim() || `npm exited with code ${result.exitCode}`;
      input.logger.error(
        { exitCode: result.exitCode, stderr: result.stderr },
        "Daemon self-update failed",
      );
      return { success: false, error, newVersion: null };
    }
    const updated = await this.runtime.npm.inspect(npmOptions).catch((error: unknown) => {
      input.logger.warn({ err: error }, "Unable to read updated npm package version");
      return null;
    });
    job.abort.signal.throwIfAborted();
    progress("complete");
    return { success: true, error: null, newVersion: updated?.version ?? null };
  }
}

export const daemonSelfUpdater = new DaemonSelfUpdater();
