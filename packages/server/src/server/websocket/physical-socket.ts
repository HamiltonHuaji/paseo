// OOM backstop for a socket whose client stopped draining. A daemon normally has
// 1-10 physical sockets (tens at the outside), so 64 MiB bounds abandoned queues
// without treating ordinary large frames as a protocol or frame-size violation.
export const MAX_PHYSICAL_SOCKET_BUFFERED_BYTES = 64 * 1024 * 1024;
// Current clients ping every 10 seconds. Four delayed cycles fit inside the
// lease without making an abandoned application socket linger for minutes.
export const APPLICATION_SOCKET_LEASE_MS = 45_000;
export const APPLICATION_SOCKET_LEASE_CHECK_INTERVAL_MS = 10_000;

type Clock = () => number;

export class ApplicationSocketLease<TSocket extends object> {
  private readonly deadlines = new Map<TSocket, number>();

  constructor(private readonly clock: Clock = Date.now) {}

  claim(socket: TSocket): void {
    this.deadlines.set(socket, this.clock() + APPLICATION_SOCKET_LEASE_MS);
  }

  renew(socket: TSocket): void {
    if (this.deadlines.has(socket)) {
      this.claim(socket);
    }
  }

  release(socket: TSocket): void {
    this.deadlines.delete(socket);
  }

  listExpired(): TSocket[] {
    const now = this.clock();
    const expired: TSocket[] = [];
    for (const [socket, deadline] of this.deadlines) {
      if (deadline > now) continue;
      expired.push(socket);
    }
    return expired;
  }

  clear(): void {
    this.deadlines.clear();
  }
}

export function outboundFrameByteLength(data: string | Uint8Array | ArrayBuffer): number {
  if (typeof data === "string") return Buffer.byteLength(data);
  return data.byteLength;
}

interface BoundedPhysicalSocket {
  readyState: number;
  bufferedAmount?: number;
  outboundWireByteLength?: (data: string | Uint8Array | ArrayBuffer) => number;
  send: (
    data: string | Uint8Array | ArrayBuffer,
    callback?: (error?: Error) => void,
  ) => void | Promise<void>;
}

interface LargeFrameReservation {
  bytes: number;
  ordinaryBytes: number;
  completed: Promise<void>;
}

const largeFrames = new WeakMap<object, LargeFrameReservation>();

function reserveFrame(socket: BoundedPhysicalSocket, bytes: number): () => void {
  if (bytes <= MAX_PHYSICAL_SOCKET_BUFFERED_BYTES) {
    const reservation = largeFrames.get(socket);
    if (!reservation) return () => {};
    reservation.ordinaryBytes += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      reservation.ordinaryBytes -= bytes;
    };
  }
  let resolve!: () => void;
  const completed = new Promise<void>((complete) => {
    resolve = complete;
  });
  const reservation = { bytes, ordinaryBytes: 0, completed };
  largeFrames.set(socket, reservation);
  return () => {
    if (largeFrames.get(socket) === reservation) largeFrames.delete(socket);
    resolve();
  };
}

export async function sendBoundedPhysicalFrameAndWait(params: {
  socket: BoundedPhysicalSocket;
  frame: string | Uint8Array | ArrayBuffer;
  frameBytes?: number;
  onHighWater: () => void;
}): Promise<boolean> {
  const { socket, frame, onHighWater } = params;
  const frameBytes =
    socket.outboundWireByteLength?.(frame) ?? params.frameBytes ?? outboundFrameByteLength(frame);
  if (socket.readyState !== 1) return false;
  if (frameBytes > MAX_PHYSICAL_SOCKET_BUFFERED_BYTES) {
    // Large-response producers serialize before materializing their frames.
    // Keep this shared boundary safe for independently awaited deliveries too.
    for (;;) {
      const previous = largeFrames.get(socket);
      if (!previous) break;
      await previous.completed;
      if (socket.readyState !== 1) return false;
    }
  }
  if (!physicalSocketHasCapacity(socket, frameBytes)) {
    onHighWater();
    return false;
  }

  const release = reserveFrame(socket, frameBytes);
  try {
    await new Promise<void>((resolve, reject) => {
      let callbackUsed = false;
      const result = socket.send(frame, (error) => {
        callbackUsed = true;
        if (error) reject(error);
        else resolve();
      });
      if (result && typeof result.then === "function") {
        result.then(resolve, reject);
      } else if (socket.send.length < 2 && !callbackUsed) {
        resolve();
      }
    });
  } finally {
    release();
  }
  return true;
}

export function physicalSocketHasCapacity(
  socket: Pick<BoundedPhysicalSocket, "bufferedAmount">,
  frameBytes: number,
): boolean {
  const reservation = largeFrames.get(socket);
  if (frameBytes > MAX_PHYSICAL_SOCKET_BUFFERED_BYTES) {
    return !reservation && (socket.bufferedAmount ?? 0) <= MAX_PHYSICAL_SOCKET_BUFFERED_BYTES;
  }
  // Draining part of a large frame must not turn its vacated allowance into an
  // additional ordinary queue that would exceed the budget when it completes.
  if (reservation && reservation.ordinaryBytes + frameBytes > MAX_PHYSICAL_SOCKET_BUFFERED_BYTES)
    return false;
  if (typeof socket.bufferedAmount !== "number") return true;
  // A single valid response is allowed to exceed the slow-reader queue budget.
  // It occupies its own allowance until the send completes; unrelated small
  // replies do not turn that response into a high-water disconnect.
  return (
    socket.bufferedAmount + frameBytes <=
    MAX_PHYSICAL_SOCKET_BUFFERED_BYTES + (reservation?.bytes ?? 0)
  );
}

export function sendBoundedPhysicalFrame(params: {
  socket: BoundedPhysicalSocket;
  frame: string | Uint8Array | ArrayBuffer;
  frameBytes?: number;
  onHighWater: () => void;
}): boolean {
  const { socket, frame, onHighWater } = params;
  const frameBytes =
    socket.outboundWireByteLength?.(frame) ?? params.frameBytes ?? outboundFrameByteLength(frame);
  if (socket.readyState !== 1) return false;
  if (!physicalSocketHasCapacity(socket, frameBytes)) {
    onHighWater();
    return false;
  }
  const release = reserveFrame(socket, frameBytes);
  if (frameBytes <= MAX_PHYSICAL_SOCKET_BUFFERED_BYTES) {
    try {
      const result = socket.send(frame);
      if (result && typeof result.then === "function") void result.then(release, release);
    } catch (error) {
      release();
      throw error;
    }
    return true;
  }
  try {
    let callbackUsed = false;
    const result = socket.send(frame, () => {
      callbackUsed = true;
      release();
    });
    if (result && typeof result.then === "function") {
      void result.finally(release).catch(() => undefined);
    } else if (socket.send.length < 2 && !callbackUsed) {
      release();
    }
  } catch (error) {
    release();
    throw error;
  }
  return true;
}
