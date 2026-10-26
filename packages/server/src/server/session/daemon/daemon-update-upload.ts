import { createHash } from "node:crypto";
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { t as listTar } from "tar";
import {
  DAEMON_UPDATE_CHUNK_BYTES,
  type DaemonUpdatePackage,
} from "@getpaseo/protocol/daemon-updates";

/** Serializes disk writes and cleanup so cancellation cannot leave a late write behind. */
export class DaemonUpdateUpload {
  private directory = "";
  private file: FileHandle | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly hash = createHash("sha256");
  private received = 0;

  constructor(readonly metadata: DaemonUpdatePackage) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => undefined);
    return next;
  }

  open(): Promise<void> {
    return this.enqueue(async () => {
      this.directory = await mkdtemp(path.join(os.tmpdir(), "paseo-update-"));
      this.file = await open(path.join(this.directory, "paseo-fork.tgz"), "wx", 0o600);
    });
  }

  write(offset: number, data: string): Promise<number> {
    return this.enqueue(async () => {
      if (!this.file) throw new Error("Update upload is closed");
      const bytes = Buffer.from(data, "base64");
      if (
        !bytes.length ||
        bytes.length > DAEMON_UPDATE_CHUNK_BYTES ||
        bytes.toString("base64") !== data
      ) {
        throw new Error("Invalid update upload chunk");
      }
      if (offset !== this.received || offset + bytes.length > this.metadata.size) {
        throw new Error("Update upload offset or size does not match");
      }
      await this.file.writeFile(bytes);
      this.hash.update(bytes);
      this.received += bytes.length;
      return this.received;
    });
  }

  finish(packageName: string): Promise<string> {
    return this.enqueue(async () => {
      if (!this.file) throw new Error("Update upload is closed");
      await this.file.close();
      this.file = null;
      if (
        this.received !== this.metadata.size ||
        this.hash.digest("hex") !== this.metadata.sha256
      ) {
        throw new Error("Uploaded update package is incomplete or its checksum does not match");
      }
      const file = path.join(this.directory, "paseo-fork.tgz");
      let manifest = "";
      let oversized = false;
      await listTar({
        file,
        strict: true,
        onReadEntry: (entry) => {
          if (entry.path !== "package/package.json") return;
          if (entry.size > 64 * 1024) {
            oversized = true;
            return;
          }
          entry.on("data", (chunk: Buffer) => {
            manifest += chunk.toString("utf8");
          });
        },
      });
      if (oversized) throw new Error("Invalid update package manifest");
      const parsed: unknown = JSON.parse(manifest);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !("name" in parsed) ||
        !("version" in parsed) ||
        parsed.name !== packageName ||
        parsed.version !== this.metadata.version
      ) {
        throw new Error(
          "Uploaded package does not match this daemon's distribution and selected version",
        );
      }
      return file;
    });
  }

  dispose(): Promise<void> {
    return this.enqueue(async () => {
      await this.file?.close();
      this.file = null;
      if (this.directory) await rm(this.directory, { recursive: true, force: true });
    });
  }
}
