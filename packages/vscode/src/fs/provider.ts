import * as vscode from "vscode";
import type { PaseoConnection } from "../daemon/connection";
import { parsePaseoWorkspaceUri } from "./uri";

interface CachedDirectory {
  expiresAt: number;
  entries: Awaited<ReturnType<PaseoFileSystemProvider["fetchDirectory"]>>;
}

const DIRECTORY_CACHE_TTL_MS = 1_000;

export class PaseoFileSystemProvider implements vscode.FileSystemProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly directoryCache = new Map<string, CachedDirectory>();

  readonly onDidChangeFile = this.changeEmitter.event;

  constructor(private readonly connection: PaseoConnection) {}

  watch(): vscode.Disposable {
    // The first read-only milestone refreshes on demand. A daemon file-watch RPC belongs to the
    // later writable-workspace milestone; VS Code accepts a no-op watcher for read-only providers.
    return new vscode.Disposable(() => {});
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const parts = parsePaseoWorkspaceUri(uri);
    if (!parts.relativePath) {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }

    const slash = parts.relativePath.lastIndexOf("/");
    const parent = slash === -1 ? "" : parts.relativePath.slice(0, slash);
    const name = parts.relativePath.slice(slash + 1);
    const entries = await this.getDirectory(uri, parent);
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return this.toFileStat(entry);
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const parts = parsePaseoWorkspaceUri(uri);
    const entries = await this.getDirectory(uri, parts.relativePath);
    return entries.map((entry) => [
      entry.name,
      entry.kind === "directory" ? vscode.FileType.Directory : vscode.FileType.File,
    ]);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const parts = parsePaseoWorkspaceUri(uri);
    if (!parts.relativePath) {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }
    try {
      await this.connection.assertServer(parts.serverId);
      const workspace = await this.connection.getWorkspace(parts.workspaceId);
      const client = await this.connection.ensureConnected();
      return (await client.readFile(workspace.workspaceDirectory, parts.relativePath)).bytes;
    } catch (error) {
      throw this.toFileSystemError(error, uri);
    }
  }

  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(`Read-only Paseo workspace: ${uri.toString()}`);
  }

  writeFile(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(`Read-only Paseo workspace: ${uri.toString()}`);
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(`Read-only Paseo workspace: ${uri.toString()}`);
  }

  rename(oldUri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(`Read-only Paseo workspace: ${oldUri.toString()}`);
  }

  copy(source: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(`Read-only Paseo workspace: ${source.toString()}`);
  }

  dispose(): void {
    this.directoryCache.clear();
    this.changeEmitter.dispose();
  }

  private async getDirectory(
    uri: vscode.Uri,
    relativePath: string,
  ): Promise<Awaited<ReturnType<PaseoFileSystemProvider["fetchDirectory"]>>> {
    const parts = parsePaseoWorkspaceUri(uri);
    await this.connection.assertServer(parts.serverId);
    const cacheKey = `${parts.workspaceId}:${relativePath}`;
    const cached = this.directoryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.entries;
    }
    try {
      const entries = await this.fetchDirectory(parts.workspaceId, relativePath);
      this.directoryCache.set(cacheKey, {
        entries,
        expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS,
      });
      return entries;
    } catch (error) {
      throw this.toFileSystemError(error, uri);
    }
  }

  private async fetchDirectory(workspaceId: string, relativePath: string) {
    const workspace = await this.connection.getWorkspace(workspaceId);
    const client = await this.connection.ensureConnected();
    return (await client.listDirectory(workspace.workspaceDirectory, relativePath)).entries;
  }

  private toFileStat(
    entry: Awaited<ReturnType<PaseoFileSystemProvider["fetchDirectory"]>>[number],
  ) {
    const mtime = Date.parse(entry.modifiedAt);
    return {
      type: entry.kind === "directory" ? vscode.FileType.Directory : vscode.FileType.File,
      ctime: Number.isFinite(mtime) ? mtime : 0,
      mtime: Number.isFinite(mtime) ? mtime : 0,
      size: entry.size,
    };
  }

  private toFileSystemError(error: unknown, uri: vscode.Uri): vscode.FileSystemError {
    if (error instanceof vscode.FileSystemError) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/not found|no such file|unavailable/i.test(message)) {
      return vscode.FileSystemError.FileNotFound(uri);
    }
    if (/permission|denied|outside|escape/i.test(message)) {
      return vscode.FileSystemError.NoPermissions(message);
    }
    return vscode.FileSystemError.Unavailable(message);
  }
}
