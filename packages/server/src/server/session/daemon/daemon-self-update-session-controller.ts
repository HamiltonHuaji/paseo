import type pino from "pino";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  daemonSelfUpdater,
  DaemonSelfUpdateInProgressError,
  type DaemonSelfUpdatePhase,
  type DaemonSelfUpdater,
} from "./daemon-self-updater.js";
import { getErrorMessage } from "@getpaseo/protocol/error-utils";

type UpdateControls = Pick<DaemonSelfUpdater, "update" | "getStatus" | "cancel" | "transfer">;

type DaemonUpdateControl = Extract<
  SessionInboundMessage,
  {
    type:
      | "daemon.update.status.request"
      | "daemon.update.cancel.request"
      | "daemon.update.transfer.request";
  }
>;

type DaemonUpdateRequest = Extract<SessionInboundMessage, { type: "daemon.update.request" }>;

const DAEMON_SELF_UPDATE_MESSAGE_TYPES: ReadonlySet<SessionInboundMessage["type"]> = new Set([
  "daemon.update.request",
]);

interface DaemonSelfUpdateRestartIntent {
  type: "restart";
  clientId: string;
  requestId: string;
  reason: string;
}

export interface DaemonSelfUpdateSessionControllerOptions {
  clientId: string;
  daemonVersion: string | null;
  desktopManaged?: boolean;
  emit: (msg: SessionOutboundMessage) => void;
  emitLifecycleIntent: (intent: DaemonSelfUpdateRestartIntent) => void;
  sessionLogger: pino.Logger;
  updater?: UpdateControls;
}

function isDaemonSelfUpdateMessage(msg: SessionInboundMessage): msg is DaemonUpdateRequest {
  return DAEMON_SELF_UPDATE_MESSAGE_TYPES.has(msg.type);
}

export class DaemonSelfUpdateSessionController {
  private readonly clientId: string;
  private readonly daemonVersion: string | null;
  private readonly desktopManaged: boolean;
  private readonly emit: (msg: SessionOutboundMessage) => void;
  private readonly emitLifecycleIntent: (intent: DaemonSelfUpdateRestartIntent) => void;
  private readonly sessionLogger: pino.Logger;
  private readonly updater: UpdateControls;

  constructor(options: DaemonSelfUpdateSessionControllerOptions) {
    this.clientId = options.clientId;
    this.daemonVersion = options.daemonVersion;
    this.desktopManaged = options.desktopManaged === true;
    this.emit = options.emit;
    this.emitLifecycleIntent = options.emitLifecycleIntent;
    this.sessionLogger = options.sessionLogger;
    this.updater = options.updater ?? daemonSelfUpdater;
  }

  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    if (
      msg.type === "daemon.update.status.request" ||
      msg.type === "daemon.update.cancel.request" ||
      msg.type === "daemon.update.transfer.request"
    )
      return this.handleControl(msg);
    if (!isDaemonSelfUpdateMessage(msg)) {
      return undefined;
    }
    return this.handleDaemonUpdateRequest(msg);
  }

  private async handleControl(msg: DaemonUpdateControl): Promise<void> {
    try {
      if (msg.type === "daemon.update.status.request") {
        this.emit({
          type: "daemon.update.status.response",
          payload: { requestId: msg.requestId, job: this.updater.getStatus() },
        });
      } else if (msg.type === "daemon.update.cancel.request") {
        const job = await this.updater.cancel(msg.jobId);
        this.emit({
          type: "daemon.update.cancel.response",
          payload: { requestId: msg.requestId, job },
        });
      } else {
        if (this.desktopManaged) throw new Error("This daemon is managed by Paseo Desktop");
        const job = await this.updater.transfer(msg.transfer);
        this.emit({
          type: "daemon.update.transfer.response",
          payload: { requestId: msg.requestId, job },
        });
      }
    } catch (error) {
      this.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: getErrorMessage(error),
          code:
            error instanceof DaemonSelfUpdateInProgressError ? "already_updating" : "update_failed",
        },
      });
    }
  }

  private async handleDaemonUpdateRequest(msg: DaemonUpdateRequest): Promise<void> {
    const previousVersion = this.daemonVersion;

    try {
      const result = await this.updater.update({
        ...(msg.uploadId ? { uploadId: msg.uploadId } : {}),
        daemonVersion: previousVersion,
        desktopManaged: this.desktopManaged,
        onProgress: (phase, output) => this.emitProgress(msg.requestId, phase, output),
        logger: this.sessionLogger,
      });

      this.emitResponse({
        requestId: msg.requestId,
        success: result.success,
        error: result.error,
        previousVersion,
        newVersion: result.newVersion,
      });
      if (!result.success) {
        return;
      }

      this.emitLifecycleIntent({
        type: "restart",
        clientId: this.clientId,
        requestId: msg.requestId,
        reason: "daemon_update",
      });
    } catch (error) {
      if (error instanceof DaemonSelfUpdateInProgressError) {
        this.emit({
          type: "rpc_error",
          payload: {
            requestId: msg.requestId,
            requestType: "daemon.update.request",
            error: error.message,
            code: "already_updating",
          },
        });
        return;
      }
      this.sessionLogger.error({ err: error }, "Daemon update failed with exception");
      this.emitResponse({
        requestId: msg.requestId,
        success: false,
        error: getErrorMessage(error),
        previousVersion,
        newVersion: null,
      });
    }
  }

  private emitProgress(requestId: string, phase: DaemonSelfUpdatePhase, output?: string): void {
    this.emit({
      type: "daemon.update.progress",
      payload: {
        requestId,
        phase,
        ...(output ? { output } : {}),
      },
    });
  }

  private emitResponse(payload: {
    requestId: string;
    success: boolean;
    error: string | null;
    previousVersion: string | null;
    newVersion: string | null;
  }): void {
    this.emit({
      type: "daemon.update.response",
      payload,
    });
  }
}
