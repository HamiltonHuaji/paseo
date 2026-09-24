import {
  encodeViewerHttpFrame,
  ViewerHttpOpcode,
  VIEWER_HTTP_WINDOW_BYTES,
  type ViewerHttpFrame,
  viewerHttpCreditPayload,
} from "@getpaseo/protocol/binary-frames/index";

export interface ViewerHttpHandlers {
  onData(data: Uint8Array): void;
  onEnd(): void;
  onReset(): void;
}

export class ViewerHttpStream {
  private handlers: ViewerHttpHandlers | null = null;
  private closed = false;
  private readonly closedPromise: Promise<void>;
  private resolveClosed!: () => void;

  constructor(
    readonly id: string,
    private readonly send: (frame: Uint8Array) => void,
    private readonly onClosed: () => void,
    private readonly flowControlled: boolean,
  ) {
    this.closedPromise = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  whenClosed(): Promise<void> {
    return this.closedPromise;
  }

  setHandlers(handlers: ViewerHttpHandlers): void {
    if (this.closed) return;
    this.handlers = handlers;
    if (this.flowControlled) this.grant(VIEWER_HTTP_WINDOW_BYTES);
    else this.resume();
  }

  pause(): void {
    if (this.flowControlled) return;
    this.control(ViewerHttpOpcode.Pause);
  }

  resume(): void {
    if (this.flowControlled) return;
    this.control(ViewerHttpOpcode.Resume);
  }

  consumed(bytes: number): void {
    if (this.flowControlled && !this.closed && bytes > 0) this.grant(bytes);
  }

  cancel(): void {
    if (this.closed) return;
    try {
      this.control(ViewerHttpOpcode.Reset);
    } finally {
      this.finish();
    }
  }

  abort(): void {
    if (this.closed) return;
    this.finish();
    this.handlers?.onReset();
  }

  handleFrame(frame: ViewerHttpFrame): void {
    if (this.closed) return;
    if (frame.opcode === ViewerHttpOpcode.Data) {
      this.handlers?.onData(frame.payload);
    } else if (frame.opcode === ViewerHttpOpcode.End) {
      this.finish();
      this.handlers?.onEnd();
    } else if (frame.opcode === ViewerHttpOpcode.Reset) {
      this.abort();
    }
  }

  private control(opcode: ViewerHttpOpcode): void {
    if (this.closed) return;
    this.send(encodeViewerHttpFrame({ opcode, requestId: this.id }));
  }

  private grant(bytes: number): void {
    this.send(
      encodeViewerHttpFrame({
        opcode: ViewerHttpOpcode.Credit,
        requestId: this.id,
        payload: viewerHttpCreditPayload(bytes),
      }),
    );
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClosed();
    this.resolveClosed();
  }
}
