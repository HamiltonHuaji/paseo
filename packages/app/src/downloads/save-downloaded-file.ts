import { File as FSFile, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function saveDownloadedFile(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string | null;
}): Promise<void> {
  const targetFile = resolveDownloadTargetFile(input.fileName);
  targetFile.write(input.bytes);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(targetFile.uri, {
      mimeType: input.mimeType ?? undefined,
      dialogTitle: input.fileName,
    });
  }
}

function resolveDownloadTargetFile(fileName: string): FSFile {
  const directory = Paths.cache ?? Paths.document;
  if (!directory) {
    throw new Error("No download directory available.");
  }

  const safeName = sanitizeDownloadFileName(fileName);
  const split = splitFileName(safeName);
  let targetFile = new FSFile(directory, safeName);
  let suffix = 1;

  while (targetFile.exists) {
    targetFile = new FSFile(directory, `${split.base} (${suffix})${split.ext}`);
    suffix += 1;
  }

  return targetFile;
}

function sanitizeDownloadFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return "download";
  return trimmed.replace(/[\\/:*?"<>|]+/g, "_");
}

function splitFileName(fileName: string): { base: string; ext: string } {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) return { base: fileName, ext: "" };
  return { base: fileName.slice(0, lastDot), ext: fileName.slice(lastDot) };
}
