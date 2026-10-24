import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import {
  ViewerProxyStateSchema,
  type ViewerProxyState,
} from "@getpaseo/client/internal/viewer-http-proxy";

let loadedState: Promise<ViewerProxyState> | null = null;

async function readSavedPorts(): Promise<{
  raw: Record<string, unknown>;
  state: ViewerProxyState;
}> {
  const file = path.join(app.getPath("userData"), "viewer-proxy-ports.json");
  let contents: string;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { raw: {}, state: {} };
    }
    throw error;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new Error(`Cannot read ${file}: invalid JSON; original data was retained`);
  }
  const result = ViewerProxyStateSchema.safeParse(raw);
  if (!result.success || typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Cannot read ${file}; original data was retained`);
  }
  return { raw: { ...raw }, state: result.data };
}

export function loadViewerPorts(): Promise<ViewerProxyState> {
  loadedState ??= readSavedPorts()
    .then(({ state }) => state)
    .catch((error) => {
      loadedState = null;
      throw error;
    });
  return loadedState;
}

// The proxy registry serializes mutations so the atomic writer has one owner.
export async function saveViewerPorts(state: ViewerProxyState): Promise<void> {
  const next = ViewerProxyStateSchema.parse(state);
  const { raw } = await readSavedPorts();
  const saved = Object.fromEntries(
    Object.entries(next).map(([serverId, assignment]) => {
      const previous = raw[serverId];
      return [
        serverId,
        typeof previous === "object" && previous !== null && !Array.isArray(previous)
          ? { ...previous, ...assignment }
          : assignment,
      ];
    }),
  );
  const directory = app.getPath("userData");
  const file = path.join(directory, "viewer-proxy-ports.json");
  await mkdir(directory, { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(saved)}\n`, "utf8");
  await rename(`${file}.tmp`, file);
}
