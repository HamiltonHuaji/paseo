import {
  encodeTunnelStreamFrame,
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
  private remoteEnded = false;
  private activated = false;
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

  whenClosed(): Promise<void> {
    return this.closedPromise;
  }

  setHandlers(handlers: DaemonTunnelHandlers): void {
    this.handlers = handlers;
    if (!this.activated) {
      this.activated = true;
      this.sendControl(TunnelStreamOpcode.Resume);
    }
  }

  write(data: Uint8Array): void {
    if (this.closed || this.localEnded) return;
    this.send(
      encodeTunnelStreamFrame({
        opcode: TunnelStreamOpcode.Data,
        tunnelId: this.id,
        payload: data,
      }),
    );
  }

  end(): void {
    if (this.closed || this.localEnded) return;
    this.localEnded = true;
    this.sendControl(TunnelStreamOpcode.End);
    this.finishIfClosed();
  }

  reset(): void {
    if (this.closed) return;
    this.sendControl(TunnelStreamOpcode.Reset);
    this.finish();
  }

  pauseRemote(): void {
    this.sendControl(TunnelStreamOpcode.Pause);
  }

  resumeRemote(): void {
    this.sendControl(TunnelStreamOpcode.Resume);
  }

  handleFrame(frame: TunnelStreamFrame): void {
    if (this.closed) return;
    switch (frame.opcode) {
      case TunnelStreamOpcode.Data:
        if (this.remoteEnded) {
          this.reset();
          this.handlers.onReset?.();
          break;
        }
        this.handlers.onData?.(frame.payload);
        break;
      case TunnelStreamOpcode.End:
        if (this.remoteEnded) break;
        this.remoteEnded = true;
        this.handlers.onEnd?.();
        this.finishIfClosed();
        break;
      case TunnelStreamOpcode.Pause:
        this.handlers.onPause?.();
        break;
      case TunnelStreamOpcode.Resume:
        this.handlers.onResume?.();
        break;
      case TunnelStreamOpcode.Reset:
        this.finish();
        this.handlers.onReset?.();
        break;
    }
  }

  abort(): void {
    if (this.closed) return;
    this.finish();
    this.handlers.onReset?.();
  }

  private sendControl(opcode: TunnelStreamOpcode): void {
    if (this.closed) return;
    this.send(encodeTunnelStreamFrame({ opcode, tunnelId: this.id }));
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClosed();
    this.resolveClosed();
  }

  private finishIfClosed(): void {
    if (this.localEnded && this.remoteEnded) this.finish();
  }
}
