import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { WorkStore } from "./store.js";

const resources: Array<{ root: string; store: WorkStore }> = [];
afterEach(async () => {
  for (const { root, store } of resources.splice(0)) {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps creation cursors stable across edits and finds sessions linked only to archived children", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-works-pages-"));
  const store = await WorkStore.open(root, () => "2026-10-12T01:00:00.000Z");
  resources.push({ root, store });
  const created = Array.from(
    { length: 5 },
    (_, index) =>
      store.createCard({ preset: "topic", title: `模块 ${index}`, body: "complete body" }).card,
  );
  const first = store.listCards({ limit: 2 });
  store.updateCard({ cardId: first.objects[0]!.id, body: "Updated after reading page" });
  const second = store.listCards({ limit: 2, cursor: first.nextCursor! });
  const third = store.listCards({ limit: 2, cursor: second.nextCursor! });
  const ids = [...first.objects, ...second.objects, ...third.objects].map((object) => object.id);
  expect(ids).toEqual(
    created
      .map((object) => object.id)
      .sort()
      .toReversed(),
  );
  expect(third.nextCursor).toBeNull();
  const child = store.createItem({
    parentCardId: created[0]!.id,
    preset: "issue",
    title: "Child",
    body: "Work",
    sessions: { agentIds: ["standing"] },
  });
  store.updateItem({ itemId: child.id, archived: true });
  expect(
    store
      .listCards({ sessionId: "standing", sessionRelation: "linked" })
      .objects.map((object) => object.id),
  ).toEqual([created[0]!.id]);
  expect(store.listCards({ sessionId: "standing", sessionRelation: "touched" }).objects).toEqual(
    [],
  );
  expect(store.listItems({ parentCardId: created[1]!.id, archive: "all" }).objects).toEqual([]);
});

it("preserves explicit Result times and rolls back a combined create on an invalid child", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-works-atomic-"));
  const store = await WorkStore.open(root);
  resources.push({ root, store });
  expect(() =>
    store.createCard({
      preset: "experiment",
      title: "Atomic",
      body: "No partial record",
      items: [{ preset: "attempt", title: "Bad plan", body: "Invalid", progress: {} }],
    }),
  ).toThrow();
  expect(store.allCards()).toEqual([]);
  const object = store.createCard({
    preset: "topic",
    title: "Historical",
    body: "Recorded afterward",
    result: { completed: true },
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-02T00:00:00.000Z",
  }).card;
  const updated = store.updateCard({ cardId: object.id, result: { text: "Add evidence" } });
  expect(updated.startedAt).toBe(object.startedAt);
  expect(updated.endedAt).toBe(object.endedAt);
  expect(updated.result?.completed).toBe(true);
});

it("keeps development results, automatic execution times and participants separate from standing sessions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-works-"));
  let now = "2026-10-12T01:00:00.000Z";
  const store = await WorkStore.open(root, () => now);
  resources.push({ root, store });
  const created = store.createCard(
    {
      preset: "topic",
      title: "导出",
      body: "维护导出模块",
      sessions: { agentIds: ["standing"] },
      items: [
        { preset: "issue", title: "修复编码", body: "保留中文", result: { completed: false } },
      ],
    },
    "executor",
  );
  const issue = created.items[0]!;
  expect(issue.startedAt).toBe(now);
  expect(issue.endedAt).toBeNull();
  expect(issue.sessions).toBeNull();
  expect(issue.touches).toEqual([{ agentId: "executor", lastTouchedAt: now }]);
  now = "2026-10-12T02:00:00.000Z";
  const completed = store.updateItem(
    { itemId: issue.id, result: { completed: true, text: "验证通过" } },
    "executor",
  );
  expect(completed.startedAt).toBe("2026-10-12T01:00:00.000Z");
  expect(completed.endedAt).toBe(now);
  expect(store.getCard(created.card.id).updatedAt).toBe(now);
  expect(store.getCard(created.card.id).sessions).toEqual({ agentIds: ["standing"] });
  now = "2026-10-12T03:00:00.000Z";
  const reopened = store.updateItem({ itemId: issue.id, result: { completed: false } }, "followup");
  expect(reopened.result).toEqual({ completed: false, text: "验证通过" });
  expect(reopened.endedAt).toBeNull();
  expect(reopened.startedAt).toBe(completed.startedAt);
  expect(reopened.touches).toEqual([
    { agentId: "followup", lastTouchedAt: now },
    { agentId: "executor", lastTouchedAt: "2026-10-12T02:00:00.000Z" },
  ]);
});
