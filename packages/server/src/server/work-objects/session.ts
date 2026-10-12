import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { WorkService } from "./service.js";
import type { OwnedSubscription, SessionDelivery } from "../session/owned-subscriptions/index.js";

export class WorkSession {
  private readonly subscriptions = new Map<object, Map<string, OwnedSubscription>>();
  constructor(
    private readonly service: WorkService,
    private readonly send: (message: SessionOutboundMessage) => void,
    private readonly delivery: SessionDelivery,
  ) {}

  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "work.progress.refresh.request":
        return this.refreshProgress(msg);
      case "work.card.list.request":
        return this.listCards(msg);
      case "work.card.get.request":
        return this.getCard(msg);
      case "work.card.create.request":
        return this.createCard(msg);
      case "work.card.update.request":
        return this.updateCard(msg);
      case "work.item.list.request":
        return this.listItems(msg);
      case "work.item.get.request":
        return this.getItem(msg);
      case "work.item.create.request":
        return this.createItem(msg);
      case "work.item.update.request":
        return this.updateItem(msg);
      case "work.board.get.request":
        return this.board(msg);
      case "work.board.update.request":
        return this.updateBoard(msg);
      case "work.storage.get.request":
        return this.storage(msg);
      case "work.viewers.resolve.request":
        return this.viewerEntries(msg);
      case "work.project.subscribe.request":
        return this.subscribe(msg);
      case "work.project.unsubscribe.request":
        return this.unsubscribe(msg);
      default:
        return undefined;
    }
  }
  close(): void {
    for (const byProject of this.subscriptions.values())
      for (const owner of byProject.values()) void owner.release();
    this.subscriptions.clear();
  }
  private async subscribe(
    msg: Extract<SessionInboundMessage, { type: "work.project.subscribe.request" }>,
  ): Promise<void> {
    const source = this.delivery.currentSource;
    if (!source) throw new Error("Works subscription has no source");
    await this.subscriptions.get(source)?.get(msg.projectId)?.release();
    let unsubscribe = () => {};
    const owner = this.delivery.begin(
      "work.project",
      undefined,
      () => {
        unsubscribe();
        const subscriptions = this.subscriptions.get(source);
        if (subscriptions?.get(msg.projectId) === owner) subscriptions.delete(msg.projectId);
        if (!subscriptions?.size) this.subscriptions.delete(source);
      },
      `work.project:${msg.projectId}`,
    );
    const byProject = this.subscriptions.get(source) ?? new Map<string, OwnedSubscription>();
    byProject.set(msg.projectId, owner);
    this.subscriptions.set(source, byProject);
    unsubscribe = this.service.subscribe(msg.projectId, (change) =>
      owner.emit({ type: "work.project.changed", payload: change }),
    );
    this.send({
      type: "work.project.subscribe.response",
      payload: {
        requestId: msg.requestId,
        projectId: msg.projectId,
        subscriptionId: owner.responseId,
      },
    });
  }
  private async unsubscribe(
    msg: Extract<SessionInboundMessage, { type: "work.project.unsubscribe.request" }>,
  ): Promise<void> {
    const source = this.delivery.currentSource;
    if (source) await this.subscriptions.get(source)?.get(msg.projectId)?.release();
    this.send({
      type: "work.project.unsubscribe.response",
      payload: { requestId: msg.requestId, projectId: msg.projectId },
    });
  }
  private async refreshProgress(
    msg: Extract<SessionInboundMessage, { type: "work.progress.refresh.request" }>,
  ): Promise<void> {
    const results = await this.service.refreshProgress(msg.projectId, msg.objectIds);
    this.send({
      type: "work.progress.refresh.response",
      payload: { requestId: msg.requestId, results },
    });
  }
  private async listCards(
    msg: Extract<SessionInboundMessage, { type: "work.card.list.request" }>,
  ): Promise<void> {
    this.send({
      type: "work.card.list.response",
      payload: { requestId: msg.requestId, ...(await this.service.listCards(msg.projectId, msg)) },
    });
  }
  private async getCard(
    msg: Extract<SessionInboundMessage, { type: "work.card.get.request" }>,
  ): Promise<void> {
    this.send({
      type: "work.card.get.response",
      payload: { requestId: msg.requestId, ...(await this.service.getCard(msg.projectId, msg)) },
    });
  }
  private async createCard(
    msg: Extract<SessionInboundMessage, { type: "work.card.create.request" }>,
  ): Promise<void> {
    this.send({
      type: "work.card.create.response",
      payload: {
        requestId: msg.requestId,
        ...(await this.service.createCard(msg.projectId, msg, msg.callerAgentId)),
      },
    });
  }
  private async updateCard(
    msg: Extract<SessionInboundMessage, { type: "work.card.update.request" }>,
  ): Promise<void> {
    this.send({
      type: "work.card.update.response",
      payload: {
        requestId: msg.requestId,
        ...(await this.service.updateCard(msg.projectId, msg, msg.callerAgentId)),
      },
    });
  }
  private async listItems(
    msg: Extract<SessionInboundMessage, { type: "work.item.list.request" }>,
  ): Promise<void> {
    this.send({
      type: "work.item.list.response",
      payload: { requestId: msg.requestId, ...(await this.service.listItems(msg.projectId, msg)) },
    });
  }
  private async getItem(
    msg: Extract<SessionInboundMessage, { type: "work.item.get.request" }>,
  ): Promise<void> {
    this.send({
      type: "work.item.get.response",
      payload: { requestId: msg.requestId, ...(await this.service.getItem(msg.projectId, msg)) },
    });
  }
  private async createItem(
    msg: Extract<SessionInboundMessage, { type: "work.item.create.request" }>,
  ): Promise<void> {
    this.send({
      type: "work.item.create.response",
      payload: {
        requestId: msg.requestId,
        ...(await this.service.createItem(msg.projectId, msg, msg.callerAgentId)),
      },
    });
  }
  private async updateItem(
    msg: Extract<SessionInboundMessage, { type: "work.item.update.request" }>,
  ): Promise<void> {
    this.send({
      type: "work.item.update.response",
      payload: {
        requestId: msg.requestId,
        ...(await this.service.updateItem(msg.projectId, msg, msg.callerAgentId)),
      },
    });
  }
  private async board(
    msg: Extract<SessionInboundMessage, { type: "work.board.get.request" }>,
  ): Promise<void> {
    this.send({
      type: "work.board.get.response",
      payload: {
        requestId: msg.requestId,
        ...(await this.service.board(msg.projectId, msg.archive)),
      },
    });
  }
  private async updateBoard(
    msg: Extract<SessionInboundMessage, { type: "work.board.update.request" }>,
  ): Promise<void> {
    this.send({
      type: "work.board.update.response",
      payload: {
        requestId: msg.requestId,
        placements: await this.service.updateBoard(msg.projectId, msg.placements),
      },
    });
  }
  private async storage(
    msg: Extract<SessionInboundMessage, { type: "work.storage.get.request" }>,
  ): Promise<void> {
    this.send({
      type: "work.storage.get.response",
      payload: {
        requestId: msg.requestId,
        storage: await this.service.storage(msg.projectId, msg.objectId),
      },
    });
  }
  private async viewerEntries(
    msg: Extract<SessionInboundMessage, { type: "work.viewers.resolve.request" }>,
  ): Promise<void> {
    this.send({
      type: "work.viewers.resolve.response",
      payload: {
        requestId: msg.requestId,
        ...(await this.service.viewerEntries(msg.projectId, msg.objectId)),
      },
    });
  }
}

export function createWorkSession(
  service: WorkService | undefined,
  send: (message: SessionOutboundMessage) => void,
  delivery: SessionDelivery,
): WorkSession | null {
  return service ? new WorkSession(service, send, delivery) : null;
}
