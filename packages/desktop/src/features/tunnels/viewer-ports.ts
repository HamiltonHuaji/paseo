import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import {
  ViewerProxyStateSchema,
  type ViewerProxyState,
} from "@getpaseo/client/internal/viewer-http-proxy";

let loadedState: Promise<ViewerProxyState> | null = null;

export function loadViewerPorts(): Promise<ViewerProxyState> {
  loadedState ??= readFile(path.join(app.getPath("userData"), "viewer-proxy-ports.json"), "utf8")
    .then((contents) => ViewerProxyStateSchema.parse(JSON.parse(contents)))
    .catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw error;
    });
  return loadedState;
}

// The proxy registry serializes mutations so the atomic writer has one owner.
export async function saveViewerPorts(state: ViewerProxyState): Promise<void> {
  const directory = app.getPath("userData");
  const file = path.join(directory, "viewer-proxy-ports.json");
  await mkdir(directory, { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(state)}\n`, "utf8");
  await rename(`${file}.tmp`, file);
}
