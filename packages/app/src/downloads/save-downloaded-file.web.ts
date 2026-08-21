export async function saveDownloadedFile(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string | null;
}): Promise<void> {
  const blob = new Blob([input.bytes.slice().buffer], {
    type: input.mimeType ?? "application/octet-stream",
  });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = input.fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // The navigation starts asynchronously after click(). Revoke after the
    // current task so Chromium can acquire the blob first.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
