import {
  encodeTunnelStreamFrame,
  TunnelStreamOpcode,
  type TunnelStreamFrame,
} from "@getpaseo/protocol/binary-frames/index";

export interface DaemonTunnelHandlers {
  onData?: (data: Uint8Array) => void;
  onEnd?: () => void;
  onPause?: () => void;
  onResume?: () => void;
}

export class DaemonTunnel {
  private handlers: DaemonTunnelHandlers = {};
  private closed = false;

  constructor(
    readonly id: string,
    private readonly send: (frame: Uint8Array) => void,
    private readonly onClosed: () => void,
  ) {}

  setHandlers(handlers: DaemonTunnelHandlers): void {
    this.handlers = handlers;
  }

  write(data: Uint8Array): void {
    if (this.closed) return;
    this.send(
      encodeTunnelStreamFrame({
        opcode: TunnelStreamOpcode.Data,
        tunnelId: this.id,
        payload: data,
      }),
    );
  }

  end(): void {
    if (this.closed) return;
    this.sendControl(TunnelStreamOpcode.End);
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
        this.handlers.onData?.(frame.payload);
        break;
      case TunnelStreamOpcode.End:
        this.finish();
        this.handlers.onEnd?.();
        break;
      case TunnelStreamOpcode.Pause:
        this.handlers.onPause?.();
        break;
      case TunnelStreamOpcode.Resume:
        this.handlers.onResume?.();
        break;
    }
  }

  abort(): void {
    if (this.closed) return;
    this.finish();
    this.handlers.onEnd?.();
  }

  private sendControl(opcode: TunnelStreamOpcode): void {
    if (this.closed) return;
    this.send(encodeTunnelStreamFrame({ opcode, tunnelId: this.id }));
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClosed();
  }
}
