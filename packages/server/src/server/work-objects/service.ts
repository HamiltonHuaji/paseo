import type {
  WorkObject,
  WorkView,
  WorkCreateCard,
  WorkCreateItem,
  WorkUpdateCard,
  WorkUpdateItem,
  WorkListCards,
  WorkListItems,
  WorkListResult,
  WorkObjectResult,
  WorkSelect,
  WorkBoard,
  WorkPlacement,
  WorkStorage,
  WorkViewerEntries,
  WorkSourceRef,
  WorkProgressRefreshResult,
} from "@getpaseo/protocol/work-objects";
import path from "node:path";
import type { ProjectRegistry } from "../workspace-registry.js";
import { WorkStore, WorkError } from "./store.js";
import {
  resolveViewerConfig,
  resolveViewerEntries,
  resolveWorkSource,
  errorMessage,
} from "./viewers.js";
import { WandbReader, type WandbSnapshot } from "./wandb/reader.js";
import { WorkProgressReader } from "./progress.js";

const COMPONENTS = ["sessions", "viewers", "progress", "metrics", "result", "config"] as const;
export const WORK_FULL_SELECT: WorkSelect = [
  "timestamps",
  "touches",
  "sessions",
  "viewers",
  "progress",
  "metrics",
  "result",
  "config",
  "storage",
  "viewerEntries",
];
export interface WorkChange {
  projectId: string;
  objectIds: string[];
  fields: string[];
}
interface GetCardInput {
  cardId: string;
  select?: WorkSelect;
  includeItems?: Omit<WorkListItems, "parentCardId">;
  allItems?: boolean;
}
interface GetItemInput {
  itemId: string;
  select?: WorkSelect;
}

export class WorkService {
  private readonly stores = new Map<string, Promise<WorkStore>>();
  private readonly listeners = new Map<string, Set<(change: WorkChange) => void>>();
  readonly wandb = new WandbReader();
  private readonly progressReader = new WorkProgressReader();

  constructor(
    private readonly projects: Pick<ProjectRegistry, "get">,
    private readonly serverId: string,
  ) {}

  async store(projectId: string): Promise<WorkStore> {
    const existing = this.stores.get(projectId);
    if (existing) return existing;
    const opening = this.openStore(projectId).catch((error) => {
      this.stores.delete(projectId);
      throw error;
    });
    this.stores.set(projectId, opening);
    return opening;
  }
  private async openStore(projectId: string): Promise<WorkStore> {
    const project = await this.projects.get(projectId);
    if (!project) throw new WorkError("project_required", `Project ${projectId} not found`);
    return WorkStore.open(project.rootPath);
  }
  async close(): Promise<void> {
    const stores = await Promise.all(this.stores.values());
    for (const store of stores) store.close();
    this.stores.clear();
    this.listeners.clear();
    this.wandb.clear();
  }
  subscribe(projectId: string, listener: (change: WorkChange) => void): () => void {
    let subscribers = this.listeners.get(projectId);
    if (!subscribers) {
      subscribers = new Set();
      this.listeners.set(projectId, subscribers);
    }
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) this.listeners.delete(projectId);
    };
  }
  changed(change: WorkChange): void {
    for (const listener of this.listeners.get(change.projectId) ?? []) listener(change);
  }

  async listCards(projectId: string, input: WorkListCards): Promise<WorkListResult> {
    const store = await this.store(projectId);
    const page = store.listCards(input);
    const objects = page.objects.map((object) => this.listView(store, object, input.sessionId));
    return { objects, nextCursor: page.nextCursor };
  }
  async listItems(projectId: string, input: WorkListItems): Promise<WorkListResult> {
    const store = await this.store(projectId);
    const page = store.listItems(input);
    const objects = page.objects.map((object) => this.listView(store, object, input.sessionId));
    return { objects, nextCursor: page.nextCursor };
  }
  async getCard(projectId: string, input: GetCardInput): Promise<WorkObjectResult> {
    const store = await this.store(projectId);
    const object = await this.project(
      projectId,
      store,
      store.getCard(input.cardId),
      input.select,
      true,
    );
    if (input.allItems) {
      const items = await Promise.all(
        store
          .allItems(input.cardId)
          .map((item) => this.project(projectId, store, item, input.select, true)),
      );
      return { object, items, nextItemCursor: null };
    }
    if (!input.includeItems) return { object };
    const page = await this.listItems(projectId, {
      ...input.includeItems,
      parentCardId: input.cardId,
    });
    return { object, items: page.objects, nextItemCursor: page.nextCursor };
  }
  async getItem(projectId: string, input: GetItemInput): Promise<WorkObjectResult> {
    const store = await this.store(projectId);
    return {
      object: await this.project(projectId, store, store.getItem(input.itemId), input.select, true),
    };
  }

  async createCard(
    projectId: string,
    input: WorkCreateCard,
    caller?: string,
  ): Promise<WorkObjectResult> {
    const store = await this.store(projectId);
    const created = store.createCard(input, caller);
    this.changed({
      projectId,
      objectIds: [created.card.id, ...created.items.map((item) => item.id)],
      fields: ["created"],
    });
    const result = await this.createdView(projectId, store, created.card, input.returning);
    if (created.items.length) {
      const items = await Promise.all(
        created.items.map((item, index) =>
          this.createdView(projectId, store, item, input.items?.[index]?.returning),
        ),
      );
      result.items = items.map((item) => item.object);
      const errors = items.flatMap((item) => (item.storageError ? [item.storageError] : []));
      if (errors.length)
        result.storageError = [result.storageError, ...errors].filter(Boolean).join("; ");
    }
    return result;
  }
  async createItem(
    projectId: string,
    input: WorkCreateItem,
    caller?: string,
  ): Promise<WorkObjectResult> {
    const store = await this.store(projectId);
    const object = store.createItem(input, caller);
    this.objectChanged(projectId, object);
    return this.createdView(projectId, store, object, input.returning);
  }
  async updateCard(
    projectId: string,
    input: WorkUpdateCard,
    caller?: string,
  ): Promise<WorkObjectResult> {
    const store = await this.store(projectId);
    const object = store.updateCard(input, caller);
    this.objectChanged(projectId, object);
    return this.updatedView(projectId, store, object, input);
  }
  async updateItem(
    projectId: string,
    input: WorkUpdateItem,
    caller?: string,
  ): Promise<WorkObjectResult> {
    const store = await this.store(projectId);
    const object = store.updateItem(input, caller);
    this.objectChanged(projectId, object);
    return this.updatedView(projectId, store, object, input);
  }
  objectChanged(projectId: string, object: WorkObject): void {
    const ids = object.kind === "item" ? [object.id, object.parentCardId] : [object.id];
    this.changed({ projectId, objectIds: ids, fields: ["object"] });
  }
  async board(projectId: string, archive?: "active" | "archived" | "all"): Promise<WorkBoard> {
    const store = await this.store(projectId);
    return {
      cards: store.allCards(archive),
      itemCounts: store.itemCounts(),
      goals: store.goals(),
      placements: store.placements(),
    };
  }
  async updateBoard(projectId: string, placements: WorkPlacement[]): Promise<WorkPlacement[]> {
    const result = (await this.store(projectId)).updatePlacements(placements);
    this.changed({
      projectId,
      objectIds: placements.map((value) => value.cardId),
      fields: ["placements"],
    });
    return result;
  }
  async storage(projectId: string, objectId?: string): Promise<WorkStorage> {
    return (await this.store(projectId)).storage(objectId);
  }
  async viewerEntries(projectId: string, objectId: string): Promise<WorkViewerEntries> {
    const store = await this.store(projectId);
    return resolveViewerEntries(store, projectId, store.get(objectId), this.serverId);
  }
  async data(
    projectId: string,
    source: WorkSourceRef,
    signal?: AbortSignal,
  ): Promise<WandbSnapshot> {
    const store = await this.store(projectId);
    const snapshot = await this.wandb.read(
      await resolveWorkSource(store, source),
      signal,
      path.join(store.projectRoot, ".paseo", "v2", "cache", "wandb"),
    );
    const objects = [
      store.get(source.objectId),
      ...store.sourceConsumers(source.objectId, source.source),
    ];
    for (const object of objects) {
      if (!snapshot.activityAt || snapshot.activityAt <= object.updatedAt) continue;
      store.recordActivity(object.id, snapshot.activityAt);
      this.objectChanged(projectId, object);
    }
    return snapshot;
  }
  async refreshProgress(
    projectId: string,
    objectIds: string[],
  ): Promise<WorkProgressRefreshResult[]> {
    const store = await this.store(projectId);
    return Promise.all(
      objectIds.map(async (id) => {
        try {
          const result = await this.progressReader.refresh(store, id, (source) =>
            this.data(projectId, source),
          );
          this.objectChanged(projectId, store.get(id));
          return result;
        } catch (error) {
          return {
            objectId: id,
            observation: null,
            checkedAt: new Date().toISOString(),
            error: errorMessage(error),
            catchingUp: false,
            nextRefreshAfterMs: null,
          };
        }
      }),
    );
  }

  private listView(store: WorkStore, object: WorkObject, sessionId?: string): WorkView {
    const view = baseView(object);
    view.createdAt = object.createdAt;
    view.updatedAt = object.updatedAt;
    view.archivedAt = object.archivedAt;
    if (sessionId) view.sessionRelations = store.sessionRelations(object, sessionId);
    return view;
  }
  private async project(
    projectId: string,
    store: WorkStore,
    object: WorkObject,
    select: WorkSelect = [],
    includeNames = false,
  ): Promise<WorkView> {
    const view = baseView(object);
    if (includeNames) {
      if (object.kind === "card" && view.kind === "card") view.viewerSource = object.viewerSource;
      const resolved = resolveViewerConfig(store, object);
      view.componentNames = COMPONENTS.filter((name) =>
        name === "viewers" ? resolved.resolved !== null : object[name] !== null,
      );
    }
    for (const field of select) {
      switch (field) {
        case "timestamps":
          Object.assign(view, {
            createdAt: object.createdAt,
            updatedAt: object.updatedAt,
            startedAt: object.startedAt,
            endedAt: object.endedAt,
            archivedAt: object.archivedAt,
          });
          break;
        case "touches":
          view.touches = object.touches;
          break;
        case "viewers":
          view.viewers = resolveViewerConfig(store, object);
          break;
        case "progress":
          view.progress = object.progress
            ? { configured: object.progress, state: object.progressState }
            : null;
          break;
        case "storage":
          view.storage = await store.storage(object.id);
          break;
        case "viewerEntries":
          view.viewerEntries = await resolveViewerEntries(store, projectId, object, this.serverId);
          break;
        case "sessions":
          view.sessions = object.sessions;
          break;
        case "metrics":
          view.metrics = object.metrics;
          break;
        case "result":
          view.result = object.result;
          break;
        case "config":
          view.config = object.config;
          break;
      }
    }
    return view;
  }
  private async createdView(
    projectId: string,
    store: WorkStore,
    object: WorkObject,
    returning: WorkSelect = [],
  ): Promise<WorkObjectResult> {
    const fields: WorkSelect = [...new Set<WorkSelect[number]>([...returning, "viewerEntries"])];
    const result: WorkObjectResult = {
      object: await this.project(
        projectId,
        store,
        object,
        fields.filter((field) => field !== "storage"),
      ),
      committed: true,
    };
    try {
      result.object.storage = await store.storage(object.id);
    } catch (error) {
      result.storageError = errorMessage(error);
    }
    return result;
  }
  private async updatedView(
    projectId: string,
    store: WorkStore,
    object: WorkObject,
    input: WorkUpdateCard | WorkUpdateItem,
  ): Promise<WorkObjectResult> {
    const fields = new Set(input.returning ?? []);
    if (input.viewers !== undefined) fields.add("viewerEntries");
    return { object: await this.project(projectId, store, object, [...fields]), committed: true };
  }
}

function baseView(object: WorkObject): WorkView {
  const base = { id: object.id, title: object.title, body: object.body };
  if (object.kind === "card")
    return {
      ...base,
      kind: "card",
      label: object.label,
      goal: object.goal,
      basedOn: object.basedOn,
    };
  return { ...base, kind: "item", label: object.label, parentCardId: object.parentCardId };
}

export function resolveWorkService(
  projects: Pick<ProjectRegistry, "get">,
  serverId: string,
  service?: WorkService,
): WorkService {
  return service ?? new WorkService(projects, serverId);
}
