import {
  decodeTunnelCredit,
  encodeTunnelCredit,
  encodeTunnelStreamFrame,
  TUNNEL_DATA_FRAME_BYTES,
  TUNNEL_PENDING_BYTES,
  TUNNEL_WINDOW_BYTES,
  TunnelStreamOpcode,
  type TunnelStreamFrame,
} from "@getpaseo/protocol/binary-frames/index";

export interface DaemonTunnelHandlers {
  onData?: (data: Uint8Array) => void;
  onEnd?: () => void;
  onReset?: () => void;
  onPause?: () => void;
  onResume?: () => void;
}

export class DaemonTunnel {
  private handlers: DaemonTunnelHandlers = {};
  private closed = false;
  private localEnded = false;
  private endSent = false;
  private remoteEnded = false;
  private activated = false;
  private remotePaused = false;
  private producerPaused = false;
  private sendCredit = TUNNEL_WINDOW_BYTES;
  private receiveCredit = TUNNEL_WINDOW_BYTES;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private sentBytes = 0;
  private receivedBytes = 0;
  private terminationReason: string | null = null;
  private readonly closedPromise: Promise<void>;
  private resolveClosed!: () => void;

  constructor(
    readonly id: string,
    private readonly send: (frame: Uint8Array) => void,
    private readonly onClosed: () => void,
  ) {
    this.closedPromise = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  getState() {
    return {
      tunnelId: this.id,
      state: this.stateName(),
      sentBytes: this.sentBytes,
      receivedBytes: this.receivedBytes,
      queuedBytes: this.pendingBytes,
      terminationReason: this.terminationReason,
    };
  }

  private stateName(): string {
    if (this.closed) return this.terminationReason === "complete" ? "closed" : "aborted";
    if (this.localEnded) return "downstream_half_closed";
    if (this.remoteEnded) return "upstream_half_closed";
    return "open";
  }

  whenClosed(): Promise<void> {
    return this.closedPromise;
  }

  setHandlers(handlers: DaemonTunnelHandlers): void {
    this.handlers = handlers;
    if (this.closed) {
      handlers.onReset?.();
      return;
    }
    if (!this.activated) {
      this.activated = true;
      this.sendControl(TunnelStreamOpcode.Resume);
    }
  }

  write(data: Uint8Array): void {
    if (this.closed || this.localEnded) throw new Error("Tunnel write after end");
    if (this.pendingBytes + data.byteLength > TUNNEL_PENDING_BYTES) {
      this.reset("send_queue_limit");
      throw new Error("Tunnel send queue limit exceeded");
    }
    if (data.byteLength) {
      this.pending.push(data);
      this.pendingBytes += data.byteLength;
    }
    this.flush();
  }

  end(): void {
    if (this.closed || this.localEnded) return;
    this.localEnded = true;
    this.flush();
  }

  reset(reason = "local_reset"): void {
    if (this.closed) return;
    try {
      this.sendControl(TunnelStreamOpcode.Reset);
    } finally {
      this.finish(reason);
    }
  }

  pauseRemote(): void {
    this.sendControl(TunnelStreamOpcode.Pause);
  }
  resumeRemote(): void {
    this.sendControl(TunnelStreamOpcode.Resume);
  }

  /** Return receive credit only after the downstream socket has accepted these bytes. */
  consumed(bytes: number): void {
    if (this.closed) return;
    if (
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      this.receiveCredit + bytes > TUNNEL_WINDOW_BYTES
    ) {
      this.reset("invalid_credit");
      throw new Error("Invalid tunnel receive credit");
    }
    this.receiveCredit += bytes;
    this.sendControl(TunnelStreamOpcode.Window, encodeTunnelCredit(bytes));
  }

  handleFrame(frame: TunnelStreamFrame): void {
    if (this.closed) return;
    switch (frame.opcode) {
      case TunnelStreamOpcode.Data:
        if (this.remoteEnded || !this.activated || frame.payload.byteLength > this.receiveCredit) {
          this.reset(this.remoteEnded ? "data_after_end" : "receive_window_exceeded");
          this.handlers.onReset?.();
          return;
        }
        this.receiveCredit -= frame.payload.byteLength;
        this.receivedBytes += frame.payload.byteLength;
        this.handlers.onData?.(frame.payload);
        break;
      case TunnelStreamOpcode.End:
        if (this.remoteEnded) return;
        this.remoteEnded = true;
        this.handlers.onEnd?.();
        this.finishIfClosed();
        break;
      case TunnelStreamOpcode.Pause:
        this.remotePaused = true;
        this.updateProducer();
        break;
      case TunnelStreamOpcode.Resume:
        this.remotePaused = false;
        this.flush();
        if (!this.producerPaused) this.handlers.onResume?.();
        break;
      case TunnelStreamOpcode.Window:
        this.receiveWindow(frame.payload);
        break;
      case TunnelStreamOpcode.Reset:
        this.abort("remote_reset");
        break;
    }
  }

  private receiveWindow(payload: Uint8Array): void {
    const bytes = decodeTunnelCredit(payload);
    if (!bytes || this.sendCredit + bytes > TUNNEL_WINDOW_BYTES) {
      this.reset("invalid_credit");
      this.handlers.onReset?.();
      return;
    }
    this.sendCredit += bytes;
    this.flush();
  }

  abort(reason = "source_detached"): void {
    if (this.closed) return;
    this.finish(reason);
    this.handlers.onReset?.();
  }

  private flush(): void {
    while (!this.closed && !this.remotePaused && this.sendCredit > 0 && this.pending.length) {
      const chunk = this.pending[0]!;
      const size = Math.min(chunk.byteLength, this.sendCredit, TUNNEL_DATA_FRAME_BYTES);
      this.sendCredit -= size;
      this.pendingBytes -= size;
      if (size === chunk.byteLength) this.pending.shift();
      else this.pending[0] = chunk.subarray(size);
      this.sendControl(TunnelStreamOpcode.Data, chunk.subarray(0, size));
      this.sentBytes += size;
    }
    if (this.localEnded && !this.pendingBytes && !this.endSent && !this.closed) {
      this.endSent = true;
      this.sendControl(TunnelStreamOpcode.End);
      this.finishIfClosed();
    }
    this.updateProducer();
  }

  private updateProducer(): void {
    const paused = this.remotePaused || this.sendCredit === 0 || this.pendingBytes > 0;
    if (this.closed || paused === this.producerPaused) return;
    this.producerPaused = paused;
    if (paused) this.handlers.onPause?.();
    else this.handlers.onResume?.();
  }

  private sendControl(opcode: TunnelStreamOpcode, payload?: Uint8Array): void {
    if (this.closed) return;
    try {
      this.send(encodeTunnelStreamFrame({ opcode, tunnelId: this.id, payload }));
    } catch (error) {
      this.abort("send_failed");
      throw error;
    }
  }

  private finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.terminationReason = reason;
    this.pending = [];
    this.pendingBytes = 0;
    this.onClosed();
    this.resolveClosed();
  }

  private finishIfClosed(): void {
    if (this.endSent && this.remoteEnded) this.finish("complete");
  }
}
