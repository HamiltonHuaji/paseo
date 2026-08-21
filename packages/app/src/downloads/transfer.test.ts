import { describe, expect, it } from "vitest";
import { downloadFileThroughDaemon, type DownloadedFilePayload } from "./transfer";

describe("downloadFileThroughDaemon", () => {
  it("reads the workspace file once and gives its bytes to the platform saver", async () => {
    const reads: string[] = [];
    const saved: DownloadedFilePayload[] = [];
    const progress: Array<{ bytesWritten: number; totalBytes: number }> = [];

    await downloadFileThroughDaemon({
      path: "results/preview.png",
      requestedFileName: "preview.png",
      readFile: async (path) => {
        reads.push(path);
        return {
          bytes: Uint8Array.from([1, 2, 3]),
          mime: "image/png",
          size: 3,
          path,
          kind: "image",
          modifiedAt: "2026-08-21T00:00:00.000Z",
        };
      },
      saveFile: async (file) => {
        saved.push(file);
      },
      onReadComplete: (value) => progress.push(value),
    });

    expect(reads).toEqual(["results/preview.png"]);
    expect(saved).toEqual([
      {
        bytes: Uint8Array.from([1, 2, 3]),
        fileName: "preview.png",
        mimeType: "image/png",
      },
    ]);
    expect(progress).toEqual([{ bytesWritten: 3, totalBytes: 3 }]);
  });

  it("derives a filename from the daemon path when the requested name is empty", async () => {
    const saved: DownloadedFilePayload[] = [];
    await downloadFileThroughDaemon({
      path: "artifacts/model.bin",
      requestedFileName: " ",
      readFile: async (path) => ({
        bytes: Uint8Array.from([9]),
        mime: "application/octet-stream",
        size: 1,
        path,
        kind: "binary",
        modifiedAt: "2026-08-21T00:00:00.000Z",
      }),
      saveFile: async (file) => {
        saved.push(file);
      },
    });

    expect(saved[0]?.fileName).toBe("model.bin");
  });
});
