import { stat } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { WorkDataQuerySchema } from "@getpaseo/protocol/work-data";
import type { ProjectRegistry } from "../workspace-registry.js";
import { ViewerDirectoryPager } from "../experiments/viewer-directory.js";
import { WorkError } from "./store.js";
import type { WorkService } from "./service.js";
import { resolveViewerPath, viewerDataPath, errorMessage } from "./viewers.js";
import { queryWandb } from "./wandb/query.js";

interface ViewerRouterOptions {
  service: () => WorkService;
  projects: () => Pick<ProjectRegistry, "list">;
}
export function createWorkViewerRouter(options: ViewerRouterOptions): express.Router {
  const router = express.Router();
  const directories = new ViewerDirectoryPager();
  function route(
    pattern: string,
    handler: (req: express.Request, res: express.Response, signal: AbortSignal) => Promise<void>,
  ): void {
    router.get(pattern, (req, res) => {
      const abort = new AbortController();
      const cancel = () => abort.abort();
      res.once("close", cancel);
      void handler(req, res, abort.signal)
        .catch((error) => sendError(res, error))
        .finally(() => res.off("close", cancel));
    });
  }
  route("/", async (_req, res) => {
    const sections: string[] = [];
    for (const project of await options.projects().list()) {
      const existing = await stat(path.join(project.rootPath, ".paseo", "v2", "state.db")).then(
        () => true,
        () => false,
      );
      if (!existing) continue;
      const service = options.service();
      const store = await service.store(project.projectId);
      const rows: string[] = [];
      for (const card of store.allCards()) {
        for (const object of [
          card,
          ...store.allItems(card.id).filter((item) => !item.archivedAt),
        ]) {
          const viewers = await service.viewerEntries(project.projectId, object.id);
          const links = viewers.entries.map(
            (entry) =>
              `<li><a href="${escapeHtml(entry.path)}">${escapeHtml(entry.name)}</a>${entry.available ? "" : ` — ${escapeHtml(entry.unavailableReason ?? "Unavailable")}`}</li>`,
          );
          links.push(
            ...viewers.sources.map(
              (source) =>
                `<li><a href="${escapeHtml(source.apiPath)}/meta">${escapeHtml(source.source.source)} (data)</a></li>`,
            ),
          );
          if (links.length)
            rows.push(`<h3>${escapeHtml(object.title)}</h3><ul>${links.join("")}</ul>`);
        }
      }
      if (rows.length)
        sections.push(
          `<section><h2>${escapeHtml(project.displayName)}</h2>${rows.join("")}</section>`,
        );
    }
    res.setHeader("Cache-Control", "no-store");
    res
      .type("html")
      .send(
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Paseo Works viewers</title></head><body><h1>Works</h1>${sections.join("") || "<p>No published viewers.</p>"}</body></html>`,
      );
  });
  route("/:projectId/:objectId/files/:viewerPath(*)", async (req, res) => {
    const store = await options.service().store(req.params.projectId!);
    const file = await resolveViewerPath(store, req.params.objectId!, req.params.viewerPath!);
    if (!file) throw new WorkError("not_found", "No matching viewer mount");
    const info = await stat(file);
    if (req.query.paseo === "list" && info.isDirectory()) {
      const binding = JSON.stringify({
        projectId: req.params.projectId,
        objectId: req.params.objectId,
        path: req.params.viewerPath,
      });
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : null;
      const page = cursor
        ? directories.nextPage(cursor, binding)
        : await directories.firstPage(file, binding, limit);
      const base = req.originalUrl.split("?")[0]!.replace(/\/?$/, "/");
      res.json({
        ...page,
        entries: page.entries.map((entry) =>
          Object.assign({}, entry, {
            href: `${base}${encodeURIComponent(entry.name)}${entry.kind === "directory" ? "/" : ""}`,
          }),
        ),
      });
      return;
    }
    if (info.isDirectory() && !req.path.endsWith("/")) {
      const url = new URL(req.originalUrl, "http://viewer");
      res.redirect(308, `${url.pathname}/${url.search}`);
      return;
    }
    res.sendFile(info.isDirectory() ? path.join(file, "index.html") : file, { dotfiles: "allow" });
  });
  route(
    "/:projectId/:objectId/data/:source/artifacts/:artifactId/files/:viewerPath(*)",
    async (req, res, signal) => {
      const service = options.service();
      const snapshot = await service.data(
        req.params.projectId!,
        { objectId: req.params.objectId!, source: req.params.source! },
        signal,
      );
      const file = await service.wandb.artifactFile(
        snapshot,
        req.params.artifactId!,
        req.params.viewerPath!,
      );
      res.sendFile(file, { dotfiles: "allow" });
    },
  );
  route("/:projectId/:objectId/data/:source/:operation", async (req, res, signal) => {
    const service = options.service();
    const projectId = req.params.projectId!;
    const source = { objectId: req.params.objectId!, source: req.params.source! };
    const snapshot = await service.data(projectId, source, signal);
    res.setHeader("Cache-Control", "no-cache");
    switch (req.params.operation) {
      case "meta":
        res.json(service.wandb.meta(snapshot));
        return;
      case "artifacts":
        res.json({
          artifacts: await service.wandb.artifacts(snapshot, viewerDataPath(projectId, source)),
        });
        return;
      case "query": {
        const query = WorkDataQuerySchema.parse(
          JSON.parse(typeof req.query.q === "string" ? req.query.q : "{}"),
        );
        res.json(await queryWandb(snapshot, query, signal));
        return;
      }
      default:
        throw new WorkError("not_found", "Unknown viewer data endpoint");
    }
  });
  router.use((_req, res) =>
    res.status(404).json({ error: { code: "not_found", message: "Unknown Works viewer path" } }),
  );
  return router;
}
function sendError(res: express.Response, error: unknown): void {
  if (res.headersSent || res.destroyed) return;
  const code = error instanceof WorkError ? error.code : "viewer_error";
  res
    .status(code === "not_found" || code === "file_missing" ? 404 : 400)
    .json({ error: { code, message: errorMessage(error) } });
}
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
