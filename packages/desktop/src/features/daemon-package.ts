import { createHash } from "node:crypto";
import { mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ipcMain, net } from "electron";
import { z } from "zod";
import {
  DAEMON_UPDATE_CHUNK_BYTES,
  DaemonUpdatePackageSchema,
  type DaemonPackageDownload,
  type DaemonUpdatePackage,
} from "@getpaseo/protocol/daemon-updates";
import { FORK_REPOSITORY } from "./fork-build-info.js";

const ReleaseSchema = z.object({
  tag_name: z.string(),
  assets: z.array(
    z.object({
      name: z.string(),
      size: z.number().int().positive(),
      browser_download_url: z.string().url(),
      digest: z.string().nullable().optional(),
    }),
  ),
});

interface Download {
  state: DaemonPackageDownload;
  abort: AbortController;
  directory: string;
  file: string;
  completion: Promise<DaemonUpdatePackage>;
}
const downloads = new Map<string, Download>();

async function downloadPackage(download: Download): Promise<DaemonUpdatePackage> {
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const touch = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => download.abort.abort(new Error("Download stopped receiving data. Retry the update.")),
      60_000,
    );
  };
  touch();
  try {
    const response = await net.fetch(
      `https://api.github.com/repos/${FORK_REPOSITORY.owner}/${FORK_REPOSITORY.repo}/releases/latest`,
      {
        signal: download.abort.signal,
        headers: { Accept: "application/vnd.github+json" },
      },
    );
    if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status})`);
    const release = ReleaseSchema.parse(await response.json());
    const asset = release.assets.find((entry) => entry.name === "paseo-fork.tgz");
    if (!asset?.digest?.startsWith("sha256:"))
      throw new Error("The release has no verified daemon package yet");
    const metadata = DaemonUpdatePackageSchema.parse({
      version: release.tag_name.replace(/^v/, ""),
      size: asset.size,
      sha256: asset.digest.slice(7),
    });
    download.state.package = metadata;
    download.directory = await mkdtemp(path.join(os.tmpdir(), "paseo-daemon-package-"));
    download.file = path.join(download.directory, "paseo-fork.tgz");
    touch();
    const body = await net.fetch(asset.browser_download_url, {
      signal: download.abort.signal,
      redirect: "follow",
    });
    if (!body.ok || !body.body) throw new Error(`Daemon package download failed (${body.status})`);
    const reader = body.body.getReader();
    const file = await open(download.file, "wx", 0o600);
    const hash = createHash("sha256");
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        touch();
        await file.writeFile(chunk.value);
        hash.update(chunk.value);
        download.state.receivedBytes += chunk.value.length;
      }
    } finally {
      reader.releaseLock();
      await file.close();
    }
    download.abort.signal.throwIfAborted();
    if (download.state.receivedBytes !== metadata.size || hash.digest("hex") !== metadata.sha256) {
      throw new Error("The downloaded daemon package does not match the release asset");
    }
    download.state.status = "ready";
    return metadata;
  } catch (error) {
    download.state.status = download.abort.signal.reason === "cancelled" ? "cancelled" : "failed";
    download.state.error = error instanceof Error ? error.message : String(error);
    if (download.directory) await rm(download.directory, { recursive: true, force: true });
    throw error;
  } finally {
    clearTimeout(idleTimer);
  }
}

function prepare(serverId: string): Promise<DaemonUpdatePackage> {
  const existing = downloads.get(serverId);
  if (existing && (existing.state.status === "downloading" || existing.state.status === "ready"))
    return existing.completion;
  const download: Download = {
    state: { status: "downloading", receivedBytes: 0, package: null, error: null },
    abort: new AbortController(),
    directory: "",
    file: "",
    completion: Promise.resolve().then(() => downloadPackage(download)),
  };
  downloads.set(serverId, download);
  return download.completion;
}

export function registerDaemonPackageIpc(): void {
  ipcMain.handle("paseo:daemonPackage:prepare", (_event, input: unknown) =>
    prepare(z.string().min(1).parse(input)),
  );
  ipcMain.handle(
    "paseo:daemonPackage:status",
    (_event, input: unknown) => downloads.get(z.string().parse(input))?.state ?? null,
  );
  ipcMain.handle("paseo:daemonPackage:read", async (_event, input: unknown) => {
    const { serverId, offset } = z
      .object({ serverId: z.string(), offset: z.number().int().nonnegative() })
      .parse(input);
    const download = downloads.get(serverId);
    if (!download || download.state.status !== "ready")
      throw new Error("The daemon package is not downloaded");
    const file = await open(download.file, "r");
    try {
      const data = Buffer.alloc(DAEMON_UPDATE_CHUNK_BYTES);
      const { bytesRead } = await file.read(data, 0, data.length, offset);
      return data.subarray(0, bytesRead).toString("base64");
    } finally {
      await file.close();
    }
  });
  ipcMain.handle("paseo:daemonPackage:cancel", async (_event, input: unknown) => {
    const serverId = z.string().parse(input);
    const download = downloads.get(serverId);
    if (!download) return;
    download.abort.abort("cancelled");
    await download.completion.catch(() => undefined);
    if (download.directory) await rm(download.directory, { recursive: true, force: true });
    download.state.status = "cancelled";
  });
}
