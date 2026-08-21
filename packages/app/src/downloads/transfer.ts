import type { FileReadResult } from "@getpaseo/client/internal/daemon-client";

export interface DownloadedFilePayload {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string | null;
}

export async function downloadFileThroughDaemon(input: {
  path: string;
  requestedFileName: string;
  readFile: (path: string) => Promise<FileReadResult>;
  saveFile: (file: DownloadedFilePayload) => Promise<void>;
  onReadComplete?: (progress: { bytesWritten: number; totalBytes: number }) => void;
}): Promise<void> {
  const file = await input.readFile(input.path);
  const fileName = input.requestedFileName.trim() || file.path.split(/[\\/]/u).pop() || "download";
  input.onReadComplete?.({ bytesWritten: file.bytes.byteLength, totalBytes: file.size });
  await input.saveFile({ bytes: file.bytes, fileName, mimeType: file.mime });
}
